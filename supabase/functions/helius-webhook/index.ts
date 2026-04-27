// helius-webhook — receives Helius enhanced-tx webhook payloads for any
// address that appears in users' tracked smart_wallets, normalises each tx,
// and inserts into public.tx_events. The alert-rules-evaluator cron then
// picks them up for wallet_activity rule matching.
//
// Auth: validates the Authorization header against helius_webhooks.auth_header.
// Idempotent: signature is unique within a single user's tx_events; we
// upsert-by-(user_id, signature) using insert + on-conflict.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

type EventKind = "swap" | "transfer" | "bridge";

interface HeliusTx {
  signature?: string;
  type?: string;
  source?: string;
  timestamp?: number;
  feePayer?: string;
  accountData?: Array<{ account: string; nativeBalanceChange?: number }>;
  events?: { swap?: unknown };
  tokenTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    mint?: string;
    tokenAmount?: number;
  }>;
  nativeTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    amount?: number;
  }>;
}

// Best-effort: determine the event kind from Helius's parsed shape.
function classify(tx: HeliusTx): EventKind {
  const t = (tx.type ?? "").toUpperCase();
  if (t === "SWAP" || tx.events?.swap) return "swap";
  if (t.includes("BRIDGE")) return "bridge";
  return "transfer";
}

// Find the wallet (from our tracked set) that this tx is "about".
// We just take the first tracked address that participated.
function findInvolvedAddress(tx: HeliusTx, tracked: Set<string>): string | null {
  const candidates = new Set<string>();
  if (tx.feePayer) candidates.add(tx.feePayer);
  for (const td of tx.tokenTransfers ?? []) {
    if (td.fromUserAccount) candidates.add(td.fromUserAccount);
    if (td.toUserAccount) candidates.add(td.toUserAccount);
  }
  for (const nt of tx.nativeTransfers ?? []) {
    if (nt.fromUserAccount) candidates.add(nt.fromUserAccount);
    if (nt.toUserAccount) candidates.add(nt.toUserAccount);
  }
  for (const a of candidates) {
    if (tracked.has(a)) return a;
  }
  return null;
}

// Rough USD value: pick the largest stable-coin transfer if any, otherwise
// fall back to net SOL movement × cached SOL price (~$200 placeholder).
async function estimateUsdValue(tx: HeliusTx, solUsd: number): Promise<number> {
  let stableMax = 0;
  for (const td of tx.tokenTransfers ?? []) {
    if (td.mint && STABLES.has(td.mint)) {
      stableMax = Math.max(stableMax, Number(td.tokenAmount ?? 0));
    }
  }
  if (stableMax > 0) return stableMax;
  let solMove = 0;
  for (const nt of tx.nativeTransfers ?? []) {
    solMove = Math.max(solMove, Math.abs(Number(nt.amount ?? 0))) ;
  }
  // amount is lamports
  const sol = solMove / 1_000_000_000;
  return sol * solUsd;
}

async function fetchSolPrice(): Promise<number> {
  try {
    const r = await fetch(
      "https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112",
    );
    if (!r.ok) return 200;
    const j = (await r.json()) as Record<string, { usdPrice?: number }>;
    const p = Number(j[SOL_MINT]?.usdPrice ?? 0);
    return Number.isFinite(p) && p > 0 ? p : 200;
  } catch {
    return 200;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Validate Helius authHeader.
  const incomingAuth = req.headers.get("Authorization") ?? "";
  const { data: hookRow } = await admin
    .from("helius_webhooks")
    .select("auth_header")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!hookRow?.auth_header || incomingAuth !== hookRow.auth_header) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse payload (Helius sends an array of enhanced txs).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const txs = Array.isArray(body) ? (body as HeliusTx[]) : [];
  if (txs.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Build a map: address → Set<user_id> who track it (so a single wallet
  // tracked by multiple users yields a tx_event row per user).
  const allAddrs = new Set<string>();
  for (const tx of txs) {
    if (tx.feePayer) allAddrs.add(tx.feePayer);
    for (const td of tx.tokenTransfers ?? []) {
      if (td.fromUserAccount) allAddrs.add(td.fromUserAccount);
      if (td.toUserAccount) allAddrs.add(td.toUserAccount);
    }
    for (const nt of tx.nativeTransfers ?? []) {
      if (nt.fromUserAccount) allAddrs.add(nt.fromUserAccount);
      if (nt.toUserAccount) allAddrs.add(nt.toUserAccount);
    }
  }
  const { data: trackerRows } = await admin
    .from("smart_wallets")
    .select("address, user_id")
    .in("address", [...allAddrs]);
  const trackers = new Map<string, string[]>();
  for (const r of trackerRows ?? []) {
    const a = String(r.address);
    const u = String(r.user_id);
    const cur = trackers.get(a) ?? [];
    if (!cur.includes(u)) cur.push(u);
    trackers.set(a, cur);
  }
  const tracked = new Set(trackers.keys());

  // Map (wallet → user_id) for OWN linked wallets — used to attribute the 1%
  // swap fee. Only true owners (wallet_links) get a treasury_fees row, never
  // observed smart-money wallets.
  const { data: ownLinks } = await admin
    .from("wallet_links")
    .select("wallet_address, user_id")
    .in("wallet_address", [...allAddrs]);
  const ownerByWallet = new Map<string, string>();
  for (const r of ownLinks ?? []) {
    ownerByWallet.set(String(r.wallet_address), String(r.user_id));
  }


  const solUsd = await fetchSolPrice();

  let inserted = 0;
  for (const tx of txs) {
    const sig = String(tx.signature ?? "");
    if (!sig) continue;
    const involved = findInvolvedAddress(tx, tracked);
    if (!involved) continue;
    const userIds = trackers.get(involved) ?? [];
    if (userIds.length === 0) continue;

    const kind = classify(tx);
    const valueUsd = await estimateUsdValue(tx, solUsd);

    // Pick first non-zero token transfer involving the wallet for input/output.
    const tts = tx.tokenTransfers ?? [];
    const outgoing = tts.find((t) => t.fromUserAccount === involved);
    const incoming = tts.find((t) => t.toUserAccount === involved);

    for (const userId of userIds) {
      const { data: txRow, error } = await admin
        .from("tx_events")
        .insert({
          user_id: userId,
          kind,
          signature: sig,
          wallet_address: involved,
          input_mint: outgoing?.mint ?? null,
          input_amount: outgoing?.tokenAmount ?? null,
          output_mint: incoming?.mint ?? null,
          output_amount: incoming?.tokenAmount ?? null,
          value_usd: Math.round(valueUsd * 100) / 100,
          recipient: incoming?.toUserAccount ?? outgoing?.toUserAccount ?? null,
          metadata: {
            source: tx.source ?? null,
            type: tx.type ?? null,
            timestamp: tx.timestamp ?? null,
            via: "helius_webhook",
          },
        })
        .select("id")
        .maybeSingle();
      if (error) {
        // Duplicate on (user_id, signature) is expected on retries — ignore.
        if (!String(error.message ?? "").toLowerCase().includes("duplicate")) {
          console.error("tx_events insert failed", { sig, userId, err: error.message });
        }
      } else {
        inserted++;
      }

      // ---- Treasury fee attribution (server-side fallback) ------------------
      // The chat-side `record-swap-fee` call only fires if the user keeps the
      // page open through confirmation polling. For high-value memecoin swaps
      // that take 30s+ to land, users often close the chat first — losing
      // attribution. This server-side path guarantees every own-wallet swap
      // generates a 1% treasury_fees row, deduped against the client call by
      // the unique (chain, signature, asset_address) index.
      const ownerUser = ownerByWallet.get(involved);
      const isOwnSwap =
        kind === "swap" &&
        ownerUser === userId &&
        tx.feePayer === involved &&
        valueUsd > 0;
      if (isOwnSwap) {
        const PLATFORM_FEE_BPS = 100;
        const SOL_TREASURY = "ASKVSe32esNeK7i84oGsL5F9cqh8ov3neXEF8jSc9i89";
        // Jupiter takes the fee from the OUTPUT mint. Map known mints to the
        // same shape `record-swap-fee` writes so the dedupe index matches.
        const outMint = incoming?.mint ?? null;
        const isSolOut = !outMint || outMint === SOL_MINT;
        const assetSymbol = isSolOut
          ? "SOL"
          : (outMint && STABLES.has(outMint) ? "USDC" : null);
        const assetAddress = isSolOut ? null : outMint;
        const feeUsd = Math.round(valueUsd * (PLATFORM_FEE_BPS / 10_000) * 1_000_000) / 1_000_000;

        const { error: feeErr } = await admin.from("treasury_fees").insert({
          chain: "solana",
          treasury_address: SOL_TREASURY,
          source_kind: "swap_fee",
          asset_symbol: assetSymbol,
          asset_address: assetAddress,
          amount: 0, // unknown without on-chain inspection — USD value is what matters
          amount_usd: feeUsd,
          signature: sig,
          from_address: involved,
          block_time: tx.timestamp
            ? new Date(tx.timestamp * 1000).toISOString()
            : new Date().toISOString(),
          related_user_id: userId,
          related_tx_event_id: txRow?.id ?? null,
          metadata: {
            bps: PLATFORM_FEE_BPS,
            valueUsd,
            inputMint: outgoing?.mint ?? null,
            outputMint: outMint,
            via: "helius_webhook",
          },
        });
        if (feeErr) {
          // 23505 = unique violation = client-side `record-swap-fee` already
          // recorded this fee. That's the success path — both ends raced and
          // the index protected us.
          const code = (feeErr as { code?: string }).code;
          if (code !== "23505" && !String(feeErr.message ?? "").toLowerCase().includes("duplicate")) {
            console.error("treasury_fees insert failed", { sig, userId, err: feeErr.message });
          }
        }
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, received: txs.length, inserted }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
