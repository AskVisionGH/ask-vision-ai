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
import { ReferralProvider } from "npm:@jup-ag/referral-sdk@0.3.0";
import bs58 from "https://esm.sh/bs58@5.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sweep-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REFERRAL_ACCOUNT_PUBKEY = "5c9b2oVVJBQgFQmikVxoYsaM5tVfrMZfhk86joSZwWxx";
const DUST_THRESHOLD_USD = 1.0;

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

async function runSweep(trigger: "cron" | "manual"): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const heliusKey = Deno.env.get("HELIUS_API_KEY");
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

    // 2. Discover referral token accounts via the SDK.
    //
    // The Jupiter referral.jup.ag/api/.../token-accounts REST endpoint was
    // disabled in late 2025. The accounts themselves are PDAs derived from
    // ["referral_ata", referralAccount, mint] and are owned by the
    // REFER4Zg... program (NOT by the referral account), so a plain
    // getTokenAccountsByOwner against the referral account returns nothing.
    //
    // The SDK's getReferralTokenAccountsWithStrategy queries the program's
    // accounts via getProgramAccounts + cross-references mints, so it gives
    // us back the same shape the disabled REST API used to return.
    const heliusRpc = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
    const connection = new Connection(heliusRpc, "confirmed");

    const provider = new ReferralProvider(connection);
    const discovered = await provider.getReferralTokenAccountsWithStrategy(
      REFERRAL_ACCOUNT_PUBKEY,
      { type: "token-list", tokenList: "strict" } as any,
    ).catch((e) => {
      console.warn("getReferralTokenAccountsWithStrategy failed, continuing without dust check:", e);
      return null;
    });

    type RawAcct = { pubkey: { toBase58: () => string } | string; account: { mint: any; amount: bigint | string } };
    const flat: RawAcct[] = discovered
      ? [...(discovered.tokenAccounts ?? []), ...(discovered.token2022Accounts ?? [])]
      : [];

    const balances = flat.map((a) => {
      const pubkeyStr = typeof a.pubkey === "string" ? a.pubkey : a.pubkey.toBase58();
      const mintStr = typeof a.account.mint === "string" ? a.account.mint : a.account.mint?.toBase58?.() ?? String(a.account.mint);
      const amountStr = String(a.account.amount ?? "0");
      return {
        ta: { pubkey: pubkeyStr, mint: mintStr },
        balance: { amount: amountStr, decimals: 0, uiAmountString: amountStr },
      };
    }).filter((b) => b.ta.mint && b.balance.amount !== "0");


    const accountInfos: TokenAccountInfo[] = [];
    const mintMetaCache = new Map<string, { decimals: number; symbol: string }>();

    // Resolve symbols via Jupiter lite API (cheap)
    for (const { ta, balance } of balances) {
      if (!balance || Number(balance.amount) === 0) continue;
      let meta = mintMetaCache.get(ta.mint);
      if (!meta) {
        try {
          const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${ta.mint}`);
          if (r.ok) {
            const arr = await r.json();
            const tok = Array.isArray(arr) ? arr.find((t: any) => t.id === ta.mint) ?? arr[0] : null;
            meta = { decimals: tok?.decimals ?? balance.decimals, symbol: tok?.symbol ?? "?" };
          } else {
            meta = { decimals: balance.decimals, symbol: "?" };
          }
        } catch {
          meta = { decimals: balance.decimals, symbol: "?" };
        }
        mintMetaCache.set(ta.mint, meta);
      }
      accountInfos.push({
        pubkey: ta.pubkey,
        mint: ta.mint,
        amountUi: Number(balance.uiAmountString ?? "0"),
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

    if (totalUsd < DUST_THRESHOLD_USD) {
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

    // 5. Build claim transactions via Jupiter SDK (reuse the provider from
    // the discovery step above).
    const claimTxs: VersionedTransaction[] = await provider.claimAllV2({
      payerPubKey: treasuryKp.publicKey,
      referralAccountPubKey: new PublicKey(REFERRAL_ACCOUNT_PUBKEY),
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
