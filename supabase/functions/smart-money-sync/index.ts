// Background sync that walks the smart-money roster (curated seed +
// Birdeye live leaders + every user-added wallet) and writes their recent
// trades into `smart_money_trades`. Triggered by Inngest on a 5-minute
// cron. Designed to spread load: hits Helius sequentially with a small
// delay so we never blow rate limits.
//
// The chat-facing `smart-money-activity` function reads from the table
// instead of calling Helius live, so user requests are fast and never
// blocked by upstream throttling.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",
]);
const NOISE_ADDRESSES = new Set<string>([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
]);
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Sync window — pull 7 days of trades so the chat can answer 1h/6h/24h/7d
// off the same table.
const LOOKBACK_HOURS = 24 * 7;
// Skip wallets we synced in the last N minutes (saves Helius calls).
const PER_WALLET_SKIP_MINUTES = 8;
// Sleep between Helius calls — keeps us well under the rate limit.
const SLEEP_BETWEEN_WALLETS_MS = 350;
const HELIUS_RETRY_DELAYS_MS = [400, 1000, 2000];
// Rolling table size cap (drop trades older than this on each run).
const RETENTION_HOURS = 24 * 14;
// Limit per cron tick. With ~350ms/wallet a single 5-minute tick can
// realistically process ~80 wallets; keep headroom for retries.
const MAX_WALLETS_PER_RUN = 60;

interface WalletMeta {
  address: string;
  label: string;
  twitterHandle: string | null;
  category: string | null;
  notes: string | null;
  isCurated: boolean;
}

interface TradeRow {
  wallet_address: string;
  wallet_label: string;
  wallet_twitter_handle: string | null;
  wallet_category: string | null;
  wallet_notes: string | null;
  wallet_is_curated: boolean;
  side: "buy" | "sell";
  token_mint: string;
  token_amount: number;
  value_usd: number | null;
  signature: string;
  block_time: string;
  source: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!HELIUS_API_KEY) return json({ error: "HELIUS_API_KEY missing" }, 500);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Backend misconfigured" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = Date.now();
  const cutoffSec = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;

  try {
    // 1. Build roster: curated seed + every user-added wallet (no per-user
    //    filtering — we sync all wallets the system knows about).
    const wallets = await loadAllWallets(supabase);

    // 2. Skip wallets synced very recently. Cron is on 5-min cadence; using
    //    8-min skip means each wallet gets a refresh every other tick at
    //    worst, but we don't pile up requests.
    const skipBefore = new Date(Date.now() - PER_WALLET_SKIP_MINUTES * 60_000).toISOString();
    const { data: skipRows } = await supabase
      .from("smart_money_sync_state")
      .select("wallet_address, last_synced_at")
      .gte("last_synced_at", skipBefore);
    const skipSet = new Set((skipRows ?? []).map((r) => r.wallet_address));

    const due = wallets
      .filter((w) => BASE58_RE.test(w.address))
      .filter((w) => !NOISE_ADDRESSES.has(w.address))
      .filter((w) => !skipSet.has(w.address))
      .slice(0, MAX_WALLETS_PER_RUN);

    let totalTrades = 0;
    let walletsProcessed = 0;
    let walletsErrored = 0;

    for (const wallet of due) {
      try {
        const trades = await fetchWalletTrades(wallet, HELIUS_API_KEY, cutoffSec);
        // A single tx can show up twice in the swap events (e.g. multi-leg
        // routes). Dedupe by the same key as the unique index so the
        // upsert can't collide with itself.
        const dedupedMap = new Map<string, TradeRow>();
        for (const t of trades) {
          const k = `${t.wallet_address}|${t.signature}|${t.token_mint}|${t.side}`;
          const existing = dedupedMap.get(k);
          if (!existing) {
            dedupedMap.set(k, t);
          } else {
            // Merge: sum amounts, keep the larger USD value if either is null.
            existing.token_amount = Number(existing.token_amount) + Number(t.token_amount);
            if (existing.value_usd == null) existing.value_usd = t.value_usd;
            else if (t.value_usd != null) existing.value_usd += t.value_usd;
          }
        }
        const deduped = [...dedupedMap.values()];
        if (deduped.length > 0) {
          const { error } = await supabase
            .from("smart_money_trades")
            .upsert(deduped, { onConflict: "wallet_address,signature,token_mint,side" });
          if (error) {
            console.error(`[smart-money-sync] upsert error for ${wallet.address}`, error);
            walletsErrored++;
            await touchState(supabase, wallet.address, error.message, 0);
            continue;
          }
        }
        totalTrades += deduped.length;
        walletsProcessed++;
        await touchState(supabase, wallet.address, null, deduped.length);
      } catch (e) {
        walletsErrored++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[smart-money-sync] wallet ${wallet.address} failed:`, msg);
        await touchState(supabase, wallet.address, msg, 0);
      }
      await sleep(SLEEP_BETWEEN_WALLETS_MS);
    }

    // 3. Trim old trades to keep the table small.
    const retentionCutoff = new Date(Date.now() - RETENTION_HOURS * 3600 * 1000).toISOString();
    await supabase.from("smart_money_trades").delete().lt("block_time", retentionCutoff);

    const elapsedMs = Date.now() - startedAt;
    return json({
      ok: true,
      walletsTotal: wallets.length,
      walletsDue: due.length,
      walletsProcessed,
      walletsErrored,
      tradesUpserted: totalTrades,
      elapsedMs,
    });
  } catch (e) {
    console.error("[smart-money-sync] fatal", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Wallet roster (no user-specific filter — sync everything the system knows)
// ─────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function loadAllWallets(supabase: any): Promise<WalletMeta[]> {
  const out = new Map<string, WalletMeta>();

  const { data: curated } = await supabase
    .from("smart_wallets_global_seed")
    .select("address, label, twitter_handle, category, notes");
  for (const row of curated ?? []) {
    out.set(row.address, {
      address: row.address,
      label: row.label,
      twitterHandle: row.twitter_handle,
      category: row.category,
      notes: row.notes,
      isCurated: true,
    });
  }

  const { data: userWallets } = await supabase
    .from("smart_wallets")
    .select("address, label, twitter_handle");
  for (const row of userWallets ?? []) {
    if (out.has(row.address)) continue;
    out.set(row.address, {
      address: row.address,
      label: row.label,
      twitterHandle: row.twitter_handle,
      category: "user",
      notes: null,
      isCurated: false,
    });
  }

  return [...out.values()];
}

async function touchState(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  address: string,
  error: string | null,
  tradesCount: number,
) {
  await supabase.from("smart_money_sync_state").upsert(
    {
      wallet_address: address,
      last_synced_at: new Date().toISOString(),
      last_error: error,
      consecutive_failures: 0,
      trades_last_sync: tradesCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet_address" },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helius trade extraction (mirrors smart-money-activity)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchWalletTrades(
  meta: WalletMeta,
  apiKey: string,
  cutoffSec: number,
): Promise<TradeRow[]> {
  const out: TradeRow[] = [];
  let before: string | null = null;
  const PER_PAGE = 100;
  const MAX_PAGES = 3; // up to 300 txs back; usually plenty for 7d

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`https://api.helius.xyz/v0/addresses/${meta.address}/transactions`);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("limit", String(PER_PAGE));
    if (before) url.searchParams.set("before", before);

    const resp = await fetchWithRetry(url.toString());
    if (!resp.ok) {
      console.error(`[smart-money-sync] Helius ${resp.status} for ${meta.address}`);
      break;
    }
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const tx of data) {
      const ts = typeof tx?.timestamp === "number" ? tx.timestamp : 0;
      if (ts < cutoffSec) continue;
      const trade = extractTrade(tx, meta);
      if (trade) out.push(trade);
    }

    before = data[data.length - 1]?.signature ?? null;
    const oldestTs = data[data.length - 1]?.timestamp ?? 0;
    if (!before || oldestTs < cutoffSec) break;
  }

  return out;
}

function extractTrade(tx: any, meta: WalletMeta): TradeRow | null {
  if (!tx?.signature || !tx?.timestamp) return null;

  let side: "buy" | "sell" | null = null;
  let tokenSide: { mint: string; amount: number } | undefined;
  let inSide: { mint: string; amount: number } | undefined;
  let outSide: { mint: string; amount: number } | undefined;

  // 1. Preferred: Helius-decoded swap event. Most reliable when present.
  const swap = tx?.events?.swap;
  if (swap) {
    outSide = pickSwapSide(swap.tokenOutputs, swap.nativeOutput, meta.address);
    inSide = pickSwapSide(swap.tokenInputs, swap.nativeInput, meta.address);
  }

  // 2. Fallback: Helius didn't decode the swap (common for Photon, Bonkbot,
  //    Pump.fun-style routers, and many memecoin-launch programs). For
  //    txs Helius classifies as SWAP, derive sides from tokenTransfers +
  //    nativeTransfers from the wallet's perspective.
  if ((!inSide || !outSide) && tx?.type === "SWAP") {
    const derived = deriveSwapFromTransfers(tx, meta.address);
    if (derived) {
      inSide = inSide ?? derived.inSide;
      outSide = outSide ?? derived.outSide;
    }
  }

  if (outSide && outSide.mint !== SOL_MINT && !STABLE_MINTS.has(outSide.mint)) {
    side = "buy";
    tokenSide = outSide;
  } else if (inSide && inSide.mint !== SOL_MINT && !STABLE_MINTS.has(inSide.mint)) {
    side = "sell";
    tokenSide = inSide;
  }
  if (!side || !tokenSide) return null;
  if (NOISE_ADDRESSES.has(tokenSide.mint)) return null;

  return {
    wallet_address: meta.address,
    wallet_label: meta.label,
    wallet_twitter_handle: meta.twitterHandle,
    wallet_category: meta.category,
    wallet_notes: meta.notes,
    wallet_is_curated: meta.isCurated,
    side,
    token_mint: tokenSide.mint,
    token_amount: tokenSide.amount,
    value_usd: computeSwapUsd(inSide, outSide),
    signature: tx.signature,
    block_time: new Date(tx.timestamp * 1000).toISOString(),
    source: typeof tx?.source === "string" ? tx.source : null,
  };
}

/**
 * Derive a swap's in/out sides from raw token + native transfers when the
 * Helius enhanced-events decoder doesn't fire. We sum every token movement
 * by mint from the wallet's perspective: positive = received (out side of
 * the swap), negative = sent (in side). Picks the largest send + largest
 * receive as the swap legs.
 */
function deriveSwapFromTransfers(
  tx: any,
  owner: string,
): { inSide?: { mint: string; amount: number }; outSide?: { mint: string; amount: number } } | null {
  const balances = new Map<string, number>(); // mint -> signed delta

  // SPL token movements
  const tokenTransfers = Array.isArray(tx?.tokenTransfers) ? tx.tokenTransfers : [];
  for (const t of tokenTransfers) {
    if (!t?.mint) continue;
    const amount = Number(t?.tokenAmount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (t?.toUserAccount === owner) {
      balances.set(t.mint, (balances.get(t.mint) ?? 0) + amount);
    } else if (t?.fromUserAccount === owner) {
      balances.set(t.mint, (balances.get(t.mint) ?? 0) - amount);
    }
  }

  // Native SOL movements (in lamports)
  const nativeTransfers = Array.isArray(tx?.nativeTransfers) ? tx.nativeTransfers : [];
  let solDelta = 0;
  for (const n of nativeTransfers) {
    const amount = Number(n?.amount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (n?.toUserAccount === owner) solDelta += amount;
    else if (n?.fromUserAccount === owner) solDelta -= amount;
  }
  if (solDelta !== 0) balances.set(SOL_MINT, (balances.get(SOL_MINT) ?? 0) + solDelta / 1e9);

  // Pick largest negative (sent) and largest positive (received).
  let largestSent: { mint: string; amount: number } | undefined;
  let largestReceived: { mint: string; amount: number } | undefined;
  for (const [mint, delta] of balances) {
    if (delta < 0) {
      if (!largestSent || Math.abs(delta) > largestSent.amount) {
        largestSent = { mint, amount: Math.abs(delta) };
      }
    } else if (delta > 0) {
      if (!largestReceived || delta > largestReceived.amount) {
        largestReceived = { mint, amount: delta };
      }
    }
  }
  if (!largestSent && !largestReceived) return null;
  return { inSide: largestSent, outSide: largestReceived };
}


function pickSwapSide(
  tokenSide: any[] | undefined,
  nativeSide: any,
  owner: string,
): { mint: string; amount: number } | undefined {
  if (Array.isArray(tokenSide) && tokenSide.length > 0) {
    const involvingOwner = tokenSide.filter((t) =>
      t?.userAccount === owner || t?.fromUserAccount === owner || t?.toUserAccount === owner,
    );
    const candidates = involvingOwner.length > 0 ? involvingOwner : tokenSide;
    for (const t of candidates) {
      const raw = Number(t?.rawTokenAmount?.tokenAmount ?? 0);
      const decimals = Number(t?.rawTokenAmount?.decimals ?? 0);
      const uiAmount = Number(t?.tokenAmount?.uiAmount ?? t?.tokenAmount ?? 0);
      const amount = raw > 0 ? raw / Math.pow(10, decimals) : uiAmount;
      if (!Number.isFinite(amount) || amount <= 0 || !t?.mint) continue;
      return { mint: t.mint, amount };
    }
  }
  const nativeRaw = Number(nativeSide?.amount ?? nativeSide ?? 0);
  if (Number.isFinite(nativeRaw) && nativeRaw > 0) {
    return { mint: SOL_MINT, amount: nativeRaw / 1e9 };
  }
  return undefined;
}

function computeSwapUsd(
  inSide: { mint: string; amount: number } | undefined,
  outSide: { mint: string; amount: number } | undefined,
): number | null {
  if (inSide && STABLE_MINTS.has(inSide.mint)) return inSide.amount;
  if (outSide && STABLE_MINTS.has(outSide.mint)) return outSide.amount;
  if (inSide?.mint === SOL_MINT) return inSide.amount * 150;
  if (outSide?.mint === SOL_MINT) return outSide.amount * 150;
  return null;
}

async function fetchWithRetry(url: string) {
  let last: Response | null = null;
  for (let attempt = 0; attempt <= HELIUS_RETRY_DELAYS_MS.length; attempt++) {
    const resp = await fetch(url);
    if (resp.status !== 429 && resp.status !== 503) return resp;
    last = resp;
    const delay = HELIUS_RETRY_DELAYS_MS[attempt];
    if (delay == null) break;
    await sleep(delay);
  }
  return last ?? fetch(url);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
