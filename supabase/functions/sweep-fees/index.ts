// Sweep Jupiter referral fees from the Referral PDA's token accounts into
// the treasury wallet (which is the Referral Account's `partner` — fees land
// there directly when claimed).
//
// Triggered by:
//   - inngest-sweep-cron (hourly), with header X-Sweep-Secret
//   - admin "Sweep now" button in the UI, with header X-Sweep-Secret
//
// Auth model: this function is deployed with verify_jwt=false so Inngest can
// reach it without a Supabase session, but it requires INNGEST_EVENT_TRIGGER_SECRET
// in the X-Sweep-Secret header. Without it, requests are rejected.
//
// Dust threshold: if total accrued USD value across all token accounts is
// under $1, the run is skipped (claim transactions cost ~0.001 SOL — not
// worth burning that on dust).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

// Verify whether the request bearer token belongs to a super_admin / admin
// user. Lets the admin-panel "Sweep now" button trigger sweeps from the
// browser without leaking the cron's shared secret.
async function isAdminCaller(req: Request, supabaseUrl: string, anonKey: string, serviceKey: string): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return false;
    const admin = createClient(supabaseUrl, serviceKey);
    const { data } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "super_admin"])
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}
import { Connection, Keypair, PublicKey, VersionedTransaction } from "npm:@solana/web3.js@1.95.3";
import { AccountLayout, MintLayout } from "npm:@solana/spl-token@0.4.8";
import { ReferralProvider } from "npm:@jup-ag/referral-sdk@0.3.0";
import bs58 from "https://esm.sh/bs58@5.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sweep-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_REFERRAL_ACCOUNT_PUBKEY = "5c9b2oVVJBQgFQmikVxoYsaM5tVfrMZfhk86joSZwWxx";
const DUST_THRESHOLD_USD = 1.0;

const KNOWN_TOKEN_META: Record<string, { decimals: number; symbol: string }> = {
  So11111111111111111111111111111111111111112: { decimals: 9, symbol: "SOL" },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { decimals: 6, symbol: "USDC" },
};

const TARGET_SWEEP_MINTS = Object.keys(KNOWN_TOKEN_META);

interface TokenAccountInfo {
  pubkey: string;
  mint: string;
  amountUi: number;
  decimals: number;
  symbol: string;
  priceUsd: number | null;
  valueUsd: number | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Lazy DexScreener price lookup — we only need rough USD value to enforce
// the dust threshold, so a single batched call is enough.
async function fetchPricesUsd(mints: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (mints.length === 0) return prices;
  // DexScreener allows up to 30 mints per request via the comma-separated path.
  const chunks: string[][] = [];
  for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));

  for (const chunk of chunks) {
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);
      if (!r.ok) continue;
      const d = await r.json();
      for (const pair of (d.pairs ?? []) as any[]) {
        if (pair.chainId !== "solana") continue;
        const mint = pair.baseToken?.address;
        const price = pair.priceUsd ? Number(pair.priceUsd) : null;
        if (!mint || price == null) continue;
        // Keep highest-liquidity price per mint
        const existing = prices.get(mint);
        if (existing == null || (pair.liquidity?.usd ?? 0) > 0) prices.set(mint, price);
      }
    } catch (_) { /* ignore — missing price = $0 = treated as dust */ }
  }
  return prices;
}

async function fetchMintMeta(
  connection: Connection,
  mints: string[],
): Promise<Map<string, { decimals: number; symbol: string }>> {
  const unique = Array.from(new Set(mints));
  const meta = new Map<string, { decimals: number; symbol: string }>();

  for (const mint of unique) {
    const known = KNOWN_TOKEN_META[mint];
    if (known) meta.set(mint, known);
  }

  const unknown = unique.filter((mint) => !meta.has(mint));
  if (unknown.length === 0) return meta;

  for (let i = 0; i < unknown.length; i += 100) {
    const chunk = unknown.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(
      chunk.map((mint) => new PublicKey(mint)),
      "confirmed",
    );

    infos.forEach((info, idx) => {
      const mint = chunk[idx];
      const fallback = { decimals: 0, symbol: `${mint.slice(0, 4)}…${mint.slice(-4)}` };
      if (!info) {
        meta.set(mint, fallback);
        return;
      }

      try {
        const decoded = MintLayout.decode(new Uint8Array(info.data));
        meta.set(mint, {
          decimals: decoded.decimals,
          symbol: fallback.symbol,
        });
      } catch {
        meta.set(mint, fallback);
      }
    });
  }

  return meta;
}

async function fetchTargetReferralBalances(
  connection: Connection,
  provider: ReferralProvider,
  referralAccountPubKey: PublicKey,
  mints: string[],
): Promise<Array<{ pubkey: string; mint: string; amountRaw: bigint }>> {
  const targets = mints.map((mint) => ({
    mint,
    pubkey: provider.getReferralTokenAccountPubKey({
      referralAccountPubKey,
      mint: new PublicKey(mint),
    }),
  }));

  const infos = await connection.getMultipleAccountsInfo(
    targets.map((target) => target.pubkey),
    "confirmed",
  );

  return targets.flatMap((target, idx) => {
    const info = infos[idx];
    if (!info) return [];

    try {
      const decoded = AccountLayout.decode(new Uint8Array(info.data));
      const amountRaw = BigInt(String(decoded.amount));
      if (amountRaw === 0n) return [];

      return [{
        pubkey: target.pubkey.toBase58(),
        mint: target.mint,
        amountRaw,
      }];
    } catch (error) {
      console.warn("Failed to decode referral token account", target.mint, error);
      return [];
    }
  });
}

async function runSweep(trigger: "cron" | "manual"): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const heliusKey = Deno.env.get("HELIUS_API_KEY");
  const referralAccountPubkey = Deno.env.get("JUPITER_REFERRAL_ACCOUNT") ?? DEFAULT_REFERRAL_ACCOUNT_PUBKEY;
  const treasuryPrivateKey = Deno.env.get("TREASURY_PRIVATE_KEY");
  const treasuryPublicKey = Deno.env.get("TREASURY_PUBLIC_KEY");

  if (!treasuryPrivateKey) return json({ error: "TREASURY_PRIVATE_KEY not configured" }, 500);
  if (!treasuryPublicKey) return json({ error: "TREASURY_PUBLIC_KEY not configured" }, 500);
  if (!heliusKey) return json({ error: "HELIUS_API_KEY not configured" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  // Insert a "running" row so we can attribute logs even if the function crashes.
  const { data: runRow, error: runErr } = await supabase
    .from("sweep_runs")
    .insert({ status: "running", trigger })
    .select("id")
    .single();
  if (runErr || !runRow) {
    console.error("Failed to insert sweep_runs row:", runErr);
    return json({ error: "DB insert failed" }, 500);
  }
  const runId = runRow.id as string;

  const finalize = async (patch: Record<string, unknown>) => {
    await supabase
      .from("sweep_runs")
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq("id", runId);
  };

  try {
    // 1. Decode treasury keypair (supports base58 OR JSON byte array)
    let treasuryKp: Keypair;
    try {
      const trimmed = treasuryPrivateKey.trim();
      if (trimmed.startsWith("[")) {
        const bytes = new Uint8Array(JSON.parse(trimmed));
        treasuryKp = Keypair.fromSecretKey(bytes);
      } else {
        treasuryKp = Keypair.fromSecretKey(bs58.decode(trimmed));
      }
    } catch (e) {
      throw new Error(`Invalid TREASURY_PRIVATE_KEY format: ${(e as Error).message}`);
    }

    if (treasuryKp.publicKey.toBase58() !== treasuryPublicKey) {
      throw new Error(
        `Treasury keypair mismatch: derived ${treasuryKp.publicKey.toBase58()} but TREASURY_PUBLIC_KEY=${treasuryPublicKey}`,
      );
    }

    // 2. Look up the specific referral token accounts we actually care about.
    // Vision only configures SOL + USDC fee collection today, so we can derive
    // those PDA addresses directly and avoid the SDK's broad account scans,
    // which have been overloading the RPC account indexer.
    const heliusRpc = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
    const connection = new Connection(heliusRpc, "confirmed");

    const provider = new ReferralProvider(connection);
    const referralAccount = new PublicKey(referralAccountPubkey);
    const balances = await fetchTargetReferralBalances(
      connection,
      provider,
      referralAccount,
      TARGET_SWEEP_MINTS,
    );


    const accountInfos: TokenAccountInfo[] = [];
    const mintMeta = await fetchMintMeta(connection, balances.map((balance) => balance.mint));

    for (const balance of balances) {
      const meta = mintMeta.get(balance.mint) ?? { decimals: 0, symbol: `${balance.mint.slice(0, 4)}…${balance.mint.slice(-4)}` };
      const amountRaw = Number(balance.amountRaw);
      accountInfos.push({
        pubkey: balance.pubkey,
        mint: balance.mint,
        amountUi: amountRaw / Math.pow(10, meta.decimals),
        decimals: meta.decimals,
        symbol: meta.symbol,
        priceUsd: null,
        valueUsd: null,
      });
    }

    // 4. Price lookup + dust filter
    const prices = await fetchPricesUsd(accountInfos.map((a) => a.mint));
    let totalUsd = 0;
    for (const a of accountInfos) {
      a.priceUsd = prices.get(a.mint) ?? null;
      a.valueUsd = a.priceUsd != null ? a.amountUi * a.priceUsd : null;
      if (a.valueUsd != null) totalUsd += a.valueUsd;
    }

    const perToken = accountInfos.map((a) => ({
      symbol: a.symbol,
      mint: a.mint,
      amount: a.amountUi,
      valueUsd: a.valueUsd,
    }));

    // Only enforce the dust threshold when we have priced data to compare
    // against. If discovery returned nothing or every mint lacked a price,
    // fall through and let claimAllV2 decide (it'll return zero txs if
    // nothing is actually claimable, which we handle below).
    const havePricedData = accountInfos.length > 0 && totalUsd > 0;
    if (havePricedData && totalUsd < DUST_THRESHOLD_USD) {
      await finalize({
        status: "skipped_dust",
        accounts_scanned: accountInfos.length,
        total_value_usd: totalUsd,
        per_token: perToken,
      });
      return json({
        ok: true,
        status: "skipped_dust",
        totalValueUsd: totalUsd,
        threshold: DUST_THRESHOLD_USD,
        perToken,
      });
    }

    // 5. Build claim transactions only for mints that actually have non-zero
    // balances instead of asking the SDK to scan every referral token account.
    const claimTxs = (await Promise.all(
      balances.map((balance) => provider.claim({
        payerPubKey: treasuryKp.publicKey,
        referralAccountPubKey: referralAccount,
        mint: new PublicKey(balance.mint),
      })),
    )) as VersionedTransaction[];

    console.log("sweep-fees targeted-balances", {
      referralAccountPubkey,
      balances: balances.map((balance) => ({ mint: balance.mint, amountRaw: balance.amountRaw.toString() })),
      claimTxs: claimTxs.length,
    });

    if (claimTxs.length === 0) {
      // Edge case: balances are reported but SDK returns nothing claimable
      // (e.g. accounts still warming up). Treat as skip, not error.
      await finalize({
        status: "skipped_dust",
        accounts_scanned: accountInfos.length,
        total_value_usd: totalUsd,
        per_token: perToken,
      });
      return json({ ok: true, status: "skipped_dust", reason: "No claim txs from SDK", perToken });
    }

    // 6. Sign + send each batch (claimAllV2 batches up to 5 claims per tx)
    const signatures: string[] = [];
    const errors: string[] = [];
    for (const tx of claimTxs) {
      try {
        tx.sign([treasuryKp]);
        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        // Wait for confirmation so we have a definitive outcome
        const latest = await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction(
          { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
          "confirmed",
        );
        signatures.push(sig);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Claim tx failed:", msg);
        errors.push(msg);
      }
    }

    const status = errors.length === 0
      ? "success"
      : signatures.length > 0
        ? "partial"
        : "failed";

    await finalize({
      status,
      accounts_scanned: accountInfos.length,
      accounts_claimed: signatures.length > 0 ? accountInfos.length : 0,
      total_value_usd: totalUsd,
      signatures,
      per_token: perToken,
      error_message: errors.length > 0 ? errors.join(" | ") : null,
    });

    return json({
      ok: errors.length === 0,
      status,
      totalValueUsd: totalUsd,
      signatures,
      errors,
      perToken,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("sweep-fees fatal error:", msg);
    await finalize({ status: "failed", error_message: msg });
    return json({ ok: false, status: "failed", error: msg }, 500);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Auth: either the shared cron secret OR a signed-in admin/super_admin JWT.
  const expectedSecret = Deno.env.get("INNGEST_EVENT_TRIGGER_SECRET");
  const providedSecret = req.headers.get("x-sweep-secret");
  const secretOk = !!expectedSecret && providedSecret === expectedSecret;

  let adminOk = false;
  if (!secretOk) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    adminOk = await isAdminCaller(req, supabaseUrl, anonKey, serviceKey);
  }

  if (!secretOk && !adminOk) {
    return json({ error: "Unauthorized" }, 401);
  }

  let trigger: "cron" | "manual" = "cron";
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.trigger === "manual") trigger = "manual";
  } catch (_) { /* default to cron */ }

  return await runSweep(trigger);
});
