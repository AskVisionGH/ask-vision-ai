// Wallet × Token historical scan.
//
// Answers questions the 30-day `wallet-pnl` window cannot:
//   - "When did wallet X first buy token Y?"
//   - "Show every buy/sell of token Y by wallet X."
//
// Strategy:
//   1. Look up cached scan in `wallet_token_history_cache` keyed on
//      (wallet, mint).
//   2. If `direction === "newer"` and we have a cached row, fetch only txs
//      newer than the cached `newest_scanned_signature` (cheap top-up).
//   3. Otherwise scan backwards from the cached `oldest_scanned_signature`
//      (or from now if no cache), paginating Helius enhanced txs until we
//      hit the requested cap. The cap is caller-provided so the user can
//      "keep digging" by re-invoking with a larger cap.
//   4. Filter every parsed tx for swaps / transfers that involve `mint`,
//      merge with cached events, recompute aggregates, and write back.
//
// The function is idempotent: a re-run with the same args is safe and will
// resume cleanly if it crashed mid-scan.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

const PER_PAGE = 100;

// Hard ceiling to protect the 90-second function timeout. The caller's
// `maxSignatures` is clamped to this.
const ABSOLUTE_MAX_SIGNATURES = 12000;

// Bail out of a scan if we approach the function timeout, even if the cap
// hasn't been reached. Lets us return a partial result + cached state instead
// of erroring.
const SOFT_TIMEOUT_MS = 75_000;

interface HistoryEvent {
  signature: string;
  timestamp: number; // unix seconds
  side: "buy" | "sell";
  /**
   * Differentiates real DEX activity from plain SPL/native transfers.
   *  - "swap": came from a Helius `events.swap` payload (real buy/sell against
   *    a counterparty token). Counts toward buys/sells.
   *  - "transfer": plain SPL or native transfer touching the wallet. Does
   *    NOT count as a buy/sell — the tokens were simply moved in/out.
   */
  kind: "swap" | "transfer";
  /** Amount of the *target* token moved on the wallet. Always positive. */
  tokenAmount: number;
  /** Counterparty token mint (what was paid / received in exchange). */
  pairMint: string | null;
  pairSymbol: string | null;
  pairAmount: number | null;
  /** Stable-equivalent USD value when one leg is USDC/USDT, else null. */
  valueUsd: number | null;
  source: string | null;
  /**
   * For `kind === "transfer"`: the wallet that sent us the tokens (when
   * `side === "buy"`) or that we sent to (when `side === "sell"`). Lets the
   * UI / LLM say "received from <addr>" instead of guessing.
   */
  counterparty: string | null;
}

interface CachedRow {
  id: string;
  wallet_address: string;
  token_mint: string;
  first_buy_at: string | null;
  first_buy_signature: string | null;
  first_buy_amount: number | null;
  first_buy_usd: number | null;
  total_buys: number;
  total_sells: number;
  net_amount: number;
  realized_usd: number;
  oldest_scanned_signature: string | null;
  oldest_scanned_at: string | null;
  newest_scanned_signature: string | null;
  newest_scanned_at: string | null;
  fully_scanned: boolean;
  signatures_scanned: number;
  events: HistoryEvent[];
  last_scanned_at: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();

  try {
    const body = await req.json();
    const wallet: string = String(body.wallet ?? "").trim();
    const mint: string = String(body.mint ?? "").trim();
    const direction: "older" | "newer" | "auto" = body.direction ?? "auto";
    const maxSignatures: number = clamp(
      Number(body.maxSignatures) || 3000,
      200,
      ABSOLUTE_MAX_SIGNATURES,
    );

    if (!wallet) return json({ error: "wallet required" }, 400);
    if (!mint) return json({ error: "mint required" }, 400);

    const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
    if (!HELIUS_API_KEY) return json({ error: "HELIUS_API_KEY missing" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // 1) Load cache (if any)
    const { data: cached } = await admin
      .from("wallet_token_history_cache")
      .select("*")
      .eq("wallet_address", wallet)
      .eq("token_mint", mint)
      .maybeSingle();

    const existingEvents: HistoryEvent[] = Array.isArray(cached?.events)
      ? (cached!.events as HistoryEvent[])
      : [];

    // Decide cursor.
    //  - "newer": top up from newest signature forward (no `before`, stop when we
    //    hit a known signature).
    //  - "older" or "auto" with cache that isn't fully scanned: continue digging
    //    backwards from oldest_scanned_signature.
    //  - "auto" with no cache or fully scanned: start fresh from now.
    let mode: "newer" | "older" = "older";
    let beforeSig: string | null = null;
    if (cached) {
      if (direction === "newer") {
        mode = "newer";
      } else if (cached.fully_scanned && direction === "auto") {
        // Cached + fully scanned: just freshen with newer txs.
        mode = "newer";
      } else {
        mode = "older";
        beforeSig = cached.oldest_scanned_signature;
      }
    }

    const knownSignatures = new Set(existingEvents.map((e) => e.signature));
    const newEvents: HistoryEvent[] = [];

    let scannedThisRun = 0;
    let pages = 0;
    let newestSeenSig: string | null = cached?.newest_scanned_signature ?? null;
    let newestSeenTs: number | null = cached?.newest_scanned_at
      ? Math.floor(new Date(cached.newest_scanned_at).getTime() / 1000)
      : null;
    let oldestSeenSig: string | null = cached?.oldest_scanned_signature ?? null;
    let oldestSeenTs: number | null = cached?.oldest_scanned_at
      ? Math.floor(new Date(cached.oldest_scanned_at).getTime() / 1000)
      : null;

    let reachedEnd = false;
    let stoppedReason: "cap" | "end" | "timeout" | "hit_known" = "end";

    while (scannedThisRun < maxSignatures) {
      if (Date.now() - startedAt > SOFT_TIMEOUT_MS) {
        stoppedReason = "timeout";
        break;
      }

      const url = new URL(
        `https://api.helius.xyz/v0/addresses/${wallet}/transactions`,
      );
      url.searchParams.set("api-key", HELIUS_API_KEY);
      url.searchParams.set("limit", String(PER_PAGE));
      if (mode === "older" && beforeSig) {
        url.searchParams.set("before", beforeSig);
      }
      if (mode === "newer" && newestSeenSig) {
        // Helius supports `until` to fetch txs newer than a signature.
        url.searchParams.set("until", newestSeenSig);
      }

      const resp = await fetch(url.toString());
      if (!resp.ok) {
        console.error(
          "[wallet-token-history] helius error",
          resp.status,
          await resp.text().catch(() => ""),
        );
        break;
      }
      const page = await resp.json();
      if (!Array.isArray(page) || page.length === 0) {
        reachedEnd = true;
        stoppedReason = "end";
        break;
      }
      pages += 1;
      scannedThisRun += page.length;

      let hitKnown = false;
      for (const tx of page) {
        const sig: string | undefined = tx?.signature;
        const ts: number | undefined = tx?.timestamp;
        if (!sig || !ts) continue;

        // Track newest signature — first item of first page in either mode.
        if (newestSeenTs === null || ts > newestSeenTs) {
          newestSeenTs = ts;
          newestSeenSig = sig;
        }

        // In "newer" mode, stop the moment we cross into known territory.
        if (mode === "newer" && knownSignatures.has(sig)) {
          hitKnown = true;
          break;
        }

        // Track oldest in the older sweep.
        if (mode === "older") {
          oldestSeenSig = sig;
          oldestSeenTs = ts;
        }

        if (knownSignatures.has(sig)) continue;
        const event = parseTxForToken(tx, wallet, mint);
        if (event) {
          newEvents.push(event);
          knownSignatures.add(sig);
        }
      }

      // Cursor for next page (older mode only).
      if (mode === "older") {
        const lastSig = page[page.length - 1]?.signature ?? null;
        if (!lastSig || lastSig === beforeSig) {
          reachedEnd = true;
          stoppedReason = "end";
          break;
        }
        beforeSig = lastSig;
      } else {
        // newer mode: no cursor pagination, one page is enough unless full.
        if (page.length < PER_PAGE || hitKnown) {
          stoppedReason = hitKnown ? "hit_known" : "end";
          break;
        }
      }
    }

    if (scannedThisRun >= maxSignatures && !reachedEnd) {
      stoppedReason = "cap";
    }

    // 2) Merge events, recompute aggregates.
    const allEvents = mergeEvents(existingEvents, newEvents);
    const aggregates = computeAggregates(allEvents);

    const totalScanned = (cached?.signatures_scanned ?? 0) + scannedThisRun;
    const fullyScanned =
      (cached?.fully_scanned ?? false) ||
      (mode === "older" && reachedEnd);

    const upsertRow = {
      wallet_address: wallet,
      token_mint: mint,
      first_buy_at: aggregates.firstBuy?.timestamp
        ? new Date(aggregates.firstBuy.timestamp * 1000).toISOString()
        : null,
      first_buy_signature: aggregates.firstBuy?.signature ?? null,
      first_buy_amount: aggregates.firstBuy?.tokenAmount ?? null,
      first_buy_usd: aggregates.firstBuy?.valueUsd ?? null,
      total_buys: aggregates.totalBuys,
      total_sells: aggregates.totalSells,
      net_amount: aggregates.netAmount,
      realized_usd: aggregates.realizedUsd,
      oldest_scanned_signature: oldestSeenSig,
      oldest_scanned_at: oldestSeenTs
        ? new Date(oldestSeenTs * 1000).toISOString()
        : null,
      newest_scanned_signature: newestSeenSig,
      newest_scanned_at: newestSeenTs
        ? new Date(newestSeenTs * 1000).toISOString()
        : null,
      fully_scanned: fullyScanned,
      signatures_scanned: totalScanned,
      events: allEvents,
      last_scanned_at: new Date().toISOString(),
    };

    const { error: upsertError } = await admin
      .from("wallet_token_history_cache")
      .upsert(upsertRow, { onConflict: "wallet_address,token_mint" });
    if (upsertError) {
      console.error("[wallet-token-history] upsert failed", upsertError);
    }

    const tokenSymbol = await fetchTokenSymbol(mint);

    return json({
      wallet,
      mint,
      tokenSymbol,
      firstBuy: aggregates.firstBuy,
      totalBuys: aggregates.totalBuys,
      totalSells: aggregates.totalSells,
      netAmount: aggregates.netAmount,
      realizedUsd: aggregates.realizedUsd,
      events: allEvents
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 50), // keep payload reasonable
      eventsTruncated: allEvents.length > 50,
      eventsTotal: allEvents.length,
      signaturesScannedThisRun: scannedThisRun,
      signaturesScannedTotal: totalScanned,
      pagesThisRun: pages,
      fullyScanned,
      stoppedReason,
      oldestScannedAt: upsertRow.oldest_scanned_at,
      newestScannedAt: upsertRow.newest_scanned_at,
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("wallet-token-history error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ------------------------------ Parsing ------------------------------

/**
 * Parse a Helius enhanced tx and return a `HistoryEvent` if it represents a
 * buy or sell of `mint` by `wallet`. Returns null otherwise.
 *
 * "Buy" = wallet's net position in `mint` increased.
 * "Sell" = wallet's net position in `mint` decreased.
 *
 * Handles three shapes:
 *  - `events.swap` (cleanest)
 *  - SPL `tokenTransfers` to/from the wallet
 *  - Native SOL transfers (only relevant if `mint === SOL_MINT`)
 */
function parseTxForToken(
  tx: Record<string, unknown> & {
    signature?: string;
    timestamp?: number;
    source?: string | null;
    events?: { swap?: SwapEvent };
    tokenTransfers?: TokenTransfer[];
    nativeTransfers?: NativeTransfer[];
  },
  wallet: string,
  mint: string,
): HistoryEvent | null {
  if (!tx?.signature || !tx?.timestamp) return null;

  const swap = tx.events?.swap;
  if (swap) {
    const inSide = pickSwapSide(swap.tokenInputs, swap.nativeInput, "in");
    const outSide = pickSwapSide(swap.tokenOutputs, swap.nativeOutput, "out");

    // Wallet RECEIVED the target mint => buy
    if (outSide && outSide.mint === mint && outSide.amount > 0) {
      return {
        signature: tx.signature,
        timestamp: tx.timestamp,
        side: "buy",
        kind: "swap",
        tokenAmount: outSide.amount,
        pairMint: inSide?.mint ?? null,
        pairSymbol: inSide ? shortMint(inSide.mint) : null,
        pairAmount: inSide?.amount ?? null,
        valueUsd: stableUsd(inSide, outSide),
        source: tx.source ?? null,
        counterparty: null,
      };
    }
    // Wallet SPENT the target mint => sell
    if (inSide && inSide.mint === mint && inSide.amount > 0) {
      return {
        signature: tx.signature,
        timestamp: tx.timestamp,
        side: "sell",
        kind: "swap",
        tokenAmount: inSide.amount,
        pairMint: outSide?.mint ?? null,
        pairSymbol: outSide ? shortMint(outSide.mint) : null,
        pairAmount: outSide?.amount ?? null,
        valueUsd: stableUsd(inSide, outSide),
        source: tx.source ?? null,
        counterparty: null,
      };
    }
  }

  // SPL token transfer touching the wallet — NOT a buy/sell, just a movement.
  // We tag with kind="transfer" so aggregates and the UI can distinguish
  // "first acquisition via transfer from X" from "first DEX buy".
  if (Array.isArray(tx.tokenTransfers)) {
    for (const tt of tx.tokenTransfers) {
      if (tt?.mint !== mint) continue;
      const amt = Number(tt.tokenAmount ?? 0);
      if (!amt) continue;
      if (tt.toUserAccount === wallet) {
        return {
          signature: tx.signature,
          timestamp: tx.timestamp,
          side: "buy",
          kind: "transfer",
          tokenAmount: amt,
          pairMint: null,
          pairSymbol: null,
          pairAmount: null,
          valueUsd: null,
          source: tx.source ?? null,
          counterparty: tt.fromUserAccount ?? null,
        };
      }
      if (tt.fromUserAccount === wallet) {
        return {
          signature: tx.signature,
          timestamp: tx.timestamp,
          side: "sell",
          kind: "transfer",
          tokenAmount: amt,
          pairMint: null,
          pairSymbol: null,
          pairAmount: null,
          valueUsd: null,
          source: tx.source ?? null,
          counterparty: tt.toUserAccount ?? null,
        };
      }
    }
  }

  // Native SOL flow only matters if the user asked about SOL
  if (mint === SOL_MINT && Array.isArray(tx.nativeTransfers)) {
    let net = 0;
    let counterparty: string | null = null;
    for (const nt of tx.nativeTransfers) {
      const amt = Number(nt.amount ?? 0) / 1e9;
      if (nt.toUserAccount === wallet) {
        net += amt;
        if (!counterparty && nt.fromUserAccount) counterparty = nt.fromUserAccount;
      } else if (nt.fromUserAccount === wallet) {
        net -= amt;
        if (!counterparty && nt.toUserAccount) counterparty = nt.toUserAccount;
      }
    }
    if (Math.abs(net) > 0.000001) {
      return {
        signature: tx.signature,
        timestamp: tx.timestamp,
        side: net > 0 ? "buy" : "sell",
        kind: "transfer",
        tokenAmount: Math.abs(net),
        pairMint: null,
        pairSymbol: null,
        pairAmount: null,
        valueUsd: null,
        source: tx.source ?? null,
        counterparty,
      };
    }
  }

  return null;
}

interface TokenLeg {
  mint: string;
  rawTokenAmount?: { tokenAmount?: string | number; decimals?: number };
}
interface NativeLeg { amount?: number }
interface SwapEvent {
  tokenInputs?: TokenLeg[];
  tokenOutputs?: TokenLeg[];
  nativeInput?: NativeLeg | number;
  nativeOutput?: NativeLeg | number;
}
interface TokenTransfer {
  mint?: string;
  tokenAmount?: number | string;
  toUserAccount?: string;
  fromUserAccount?: string;
}
interface NativeTransfer {
  amount?: number;
  toUserAccount?: string;
  fromUserAccount?: string;
}

function pickSwapSide(
  tokenSide: TokenLeg[] | undefined,
  nativeSide: NativeLeg | number | undefined,
  _direction: "in" | "out",
): { mint: string; amount: number } | undefined {
  if (Array.isArray(tokenSide)) {
    for (const t of tokenSide) {
      const raw = Number(t.rawTokenAmount?.tokenAmount ?? 0);
      const decimals = Number(t.rawTokenAmount?.decimals ?? 0);
      if (!raw || !t.mint) continue;
      return { mint: t.mint, amount: raw / Math.pow(10, decimals) };
    }
  }
  if (nativeSide) {
    const raw = typeof nativeSide === "number"
      ? nativeSide
      : Number(nativeSide.amount ?? 0);
    if (raw > 0) return { mint: SOL_MINT, amount: raw / 1e9 };
  }
  return undefined;
}

function stableUsd(
  inSide?: { mint: string; amount: number },
  outSide?: { mint: string; amount: number },
): number | null {
  if (inSide && STABLES.has(inSide.mint)) return inSide.amount;
  if (outSide && STABLES.has(outSide.mint)) return outSide.amount;
  return null;
}

// ------------------------------ Aggregation ------------------------------

function mergeEvents(a: HistoryEvent[], b: HistoryEvent[]): HistoryEvent[] {
  const seen = new Set<string>();
  const out: HistoryEvent[] = [];
  for (const list of [a, b]) {
    for (const e of list) {
      if (seen.has(e.signature)) continue;
      seen.add(e.signature);
      out.push(e);
    }
  }
  // Newest first
  out.sort((x, y) => y.timestamp - x.timestamp);
  return out;
}

function computeAggregates(events: HistoryEvent[]): {
  firstBuy: HistoryEvent | null;
  totalBuys: number;
  totalSells: number;
  netAmount: number;
  realizedUsd: number;
} {
  let totalBuys = 0;
  let totalSells = 0;
  let netAmount = 0;
  let realizedUsd = 0;
  let firstBuy: HistoryEvent | null = null;
  for (const e of events) {
    if (e.side === "buy") {
      totalBuys += 1;
      netAmount += e.tokenAmount;
      if (e.valueUsd) realizedUsd -= e.valueUsd;
      if (!firstBuy || e.timestamp < firstBuy.timestamp) firstBuy = e;
    } else {
      totalSells += 1;
      netAmount -= e.tokenAmount;
      if (e.valueUsd) realizedUsd += e.valueUsd;
    }
  }
  return { firstBuy, totalBuys, totalSells, netAmount, realizedUsd };
}

// ------------------------------ Misc ------------------------------

function shortMint(m: string | null | undefined): string {
  if (!m) return "?";
  if (m === SOL_MINT) return "SOL";
  if (m === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") return "USDC";
  if (m === "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB") return "USDT";
  return `${m.slice(0, 4)}…${m.slice(-4)}`;
}

async function fetchTokenSymbol(mint: string): Promise<string | null> {
  if (mint === SOL_MINT) return "SOL";
  if (mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") return "USDC";
  if (mint === "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB") return "USDT";
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const pair = Array.isArray(data?.pairs) ? data.pairs[0] : null;
    const sym = pair?.baseToken?.address === mint
      ? pair?.baseToken?.symbol
      : pair?.quoteToken?.symbol;
    return typeof sym === "string" && sym.length > 0 ? sym : null;
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
