// Wallet PnL & recent activity using Helius Enhanced Transactions API.
//
// Window: last 30 days, capped to ~500 most recent transactions per call.
// Returns:
//   - recent txs (parsed: swap | transfer_in | transfer_out | other)
//   - per-token PnL summary (cost, proceeds, realized, holdings + unrealized)
//   - overall totals
//
// The chat function picks one of three slices to send back to the client
// (recent_txs / token_pnl / wallet_pnl) but the heavy work is shared here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
// "Quote" assets we can derive USD value from. Stables are 1:1; SOL gets a
// historical price lookup. Anything in here counts as the "money side" of a
// buy/sell — without this, SOL-funded buys are silently dropped from PnL.
const QUOTES = new Set<string>([...STABLES, SOL_MINT]);

const WINDOW_DAYS = 30;
const MAX_PAGES = 5;            // Helius caps at 100 per page
const PER_PAGE = 100;

interface ParsedTx {
  signature: string;
  timestamp: number;
  type: "swap" | "transfer_in" | "transfer_out" | "other";
  description: string | null;
  source: string | null;
  fee: number;
  /** Net token-level changes for the wallet, parsed for swap math. */
  inToken?: { mint: string; symbol: string; amount: number };
  outToken?: { mint: string; symbol: string; amount: number };
  /** SOL flowed for native transfers, signed (positive = received). */
  solChange?: number;
  /** Counterparty (best-effort) for transfers. */
  counterparty?: string | null;
  /** Stable-equivalent USD value if we can derive it from the swap pair. */
  valueUsd: number | null;
}

interface TokenPnL {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  buys: number;          // count
  sells: number;         // count
  costUsd: number;       // total stable-USD spent buying this token
  proceedsUsd: number;   // total stable-USD received selling
  unitsBought: number;
  unitsSold: number;
  currentUnits: number;  // from balance snapshot
  currentPriceUsd: number | null;
  currentValueUsd: number | null;
  realizedUsd: number;   // proceeds - cost basis of sold units (FIFO-ish via avg cost)
  unrealizedUsd: number; // currentValue - cost basis of held units
  pairUrl: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const address: string = (body.address ?? "").trim();
    const slice: "recent_txs" | "token_pnl" | "wallet_pnl" = body.slice ?? "wallet_pnl";
    const tokenFilter: string | null = body.tokenFilter ?? null;
    const limit: number = Math.min(Math.max(body.limit ?? 25, 5), 50);

    if (!address) return json({ error: "address required" }, 400);

    const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
    if (!HELIUS_API_KEY) return json({ error: "HELIUS_API_KEY missing" }, 500);

    const cutoff = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;

    // 1) Pull enhanced parsed txs (paginated, newest -> oldest until cutoff)
    const txs = await fetchEnhancedTxs(address, HELIUS_API_KEY, cutoff);

    // 2) Parse each tx into a normalised shape
    const parsed: ParsedTx[] = txs
      .map((t) => parseTx(t, address))
      .filter((p): p is ParsedTx => !!p);

    // 3) Snapshot current holdings (for unrealized + symbol/logo enrichment)
    const balance = await fetchBalanceSnapshot(address, HELIUS_API_KEY);

    // 3b) Backfill USD value for SOL-paired swaps using historical SOL price
    //     (so e.g. "bought $HENRY with SOL" still produces cost basis).
    await backfillSolValueUsd(parsed, balance);

    // 3c) Enrich tx legs with the real ticker from the balance snapshot when
    //     available — so a recently bought $HENRY in `recentTxs` shows
    //     "HENRY" instead of "CJUr…pump".
    enrichTxSymbols(parsed, balance);

    // 4) Compute per-token PnL
    const tokenPnL = computeTokenPnL(parsed, balance);

    // 5) Build totals
    const totals = {
      totalRealizedUsd: tokenPnL.reduce((s, t) => s + t.realizedUsd, 0),
      totalUnrealizedUsd: tokenPnL.reduce((s, t) => s + t.unrealizedUsd, 0),
      totalCostUsd: tokenPnL.reduce((s, t) => s + t.costUsd, 0),
      totalProceedsUsd: tokenPnL.reduce((s, t) => s + t.proceedsUsd, 0),
      currentPortfolioUsd: balance.totalUsd,
      txCount: parsed.length,
    };

    if (slice === "recent_txs") {
      return json({
        address,
        windowDays: WINDOW_DAYS,
        txs: parsed.slice(0, limit),
        totalCount: parsed.length,
      });
    }

    if (slice === "token_pnl" && tokenFilter) {
      const target = tokenFilter.toLowerCase();
      let match = tokenPnL.find(
        (t) =>
          t.mint.toLowerCase() === target ||
          t.symbol.toLowerCase() === target.replace(/^\$/, ""),
      );

      // If we matched by mint but Helius gave us a placeholder symbol (e.g.
      // "CJUr…pump"), fetch the real ticker/logo via DAS so the PnL card
      // doesn't render with a truncated mint as the headline.
      if (match && (match.symbol === "?" || match.symbol.includes("…"))) {
        const meta = await fetchAssetMetadata(match.mint, HELIUS_API_KEY);
        if (meta) {
          match = { ...match, symbol: meta.symbol, name: meta.name, logo: meta.logo };
          if (match.currentPriceUsd == null) match.currentPriceUsd = meta.priceUsd;
        }
      }

      return json({
        address,
        windowDays: WINDOW_DAYS,
        token: match ?? null,
        recentTxs: parsed
          .filter(
            (p) =>
              (p.inToken && p.inToken.mint.toLowerCase() === (match?.mint.toLowerCase() ?? "")) ||
              (p.outToken && p.outToken.mint.toLowerCase() === (match?.mint.toLowerCase() ?? "")),
          )
          .slice(0, 10),
      });
    }

    // Default: wallet_pnl dashboard
    return json({
      address,
      windowDays: WINDOW_DAYS,
      totals,
      tokens: tokenPnL
        .filter((t) => Math.abs(t.realizedUsd) + Math.abs(t.unrealizedUsd) + (t.currentValueUsd ?? 0) > 0.5)
        .sort(
          (a, b) =>
            Math.abs(b.realizedUsd + b.unrealizedUsd) - Math.abs(a.realizedUsd + a.unrealizedUsd),
        )
        .slice(0, 12),
      recentTxs: parsed.slice(0, 10),
    });
  } catch (e) {
    console.error("wallet-pnl error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ------------------------------ Helpers ------------------------------

async function fetchEnhancedTxs(
  address: string,
  apiKey: string,
  cutoff: number,
): Promise<any[]> {
  const out: any[] = [];
  let before: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`https://api.helius.xyz/v0/addresses/${address}/transactions`);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("limit", String(PER_PAGE));
    if (before) url.searchParams.set("before", before);

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("Helius enhanced txs error:", resp.status, await resp.text().catch(() => ""));
      break;
    }
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) break;

    out.push(...data);
    before = data[data.length - 1]?.signature ?? null;

    const oldestTs = data[data.length - 1]?.timestamp ?? 0;
    if (!before || oldestTs < cutoff) break;
  }
  // Filter to window strictly
  return out.filter((t) => (t.timestamp ?? 0) >= cutoff);
}

interface BalanceSnapshot {
  totalUsd: number;
  byMint: Map<
    string,
    { units: number; symbol: string; name: string; logo: string | null; priceUsd: number | null }
  >;
}

async function fetchBalanceSnapshot(address: string, apiKey: string): Promise<BalanceSnapshot> {
  const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const out: BalanceSnapshot = { totalUsd: 0, byMint: new Map() };

  try {
    const resp = await fetch(heliusUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "vision-pnl",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: address,
          page: 1,
          limit: 1000,
          displayOptions: { showFungible: true, showNativeBalance: true },
        },
      }),
    });
    if (!resp.ok) return out;
    const data = await resp.json();
    const items = data.result?.items ?? [];
    const native = data.result?.nativeBalance;

    if (native && native.lamports > 0) {
      const units = native.lamports / 1e9;
      const price = native.price_per_sol ?? null;
      out.byMint.set(SOL_MINT, {
        units,
        symbol: "SOL",
        name: "Solana",
        logo:
          "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
        priceUsd: price,
      });
      if (native.total_price) out.totalUsd += native.total_price;
    }

    for (const item of items) {
      if (item.interface !== "FungibleToken" && item.interface !== "FungibleAsset") continue;
      const info = item.token_info;
      if (!info?.balance || info.balance === 0) continue;
      const decimals = info.decimals ?? 0;
      const units = Number(info.balance) / Math.pow(10, decimals);
      const priceUsd = info.price_info?.price_per_token ?? null;
      out.byMint.set(item.id, {
        units,
        symbol: info.symbol ?? "?",
        name: item.content?.metadata?.name ?? info.symbol ?? "Unknown",
        logo: item.content?.links?.image ?? null,
        priceUsd,
      });
      if (info.price_info?.total_price) out.totalUsd += info.price_info.total_price;
    }
  } catch (e) {
    console.error("balance snapshot error:", e);
  }
  return out;
}

function parseTx(t: any, owner: string): ParsedTx | null {
  if (!t?.signature || !t?.timestamp) return null;

  const base: ParsedTx = {
    signature: t.signature,
    timestamp: t.timestamp,
    type: "other",
    description: typeof t.description === "string" ? t.description : null,
    source: t.source ?? null,
    fee: typeof t.fee === "number" ? t.fee / 1e9 : 0,
    valueUsd: null,
  };

  // Compute the owner's net balance change for every mint touched in this tx.
  // This is the single source of truth for what the wallet *actually* received
  // and spent — we use it for swap classification AND for SOL/SPL transfers.
  // For Pump/Raydium/Meteora swaps Helius leaves `events.swap` empty, and the
  // raw `tokenTransfers` array contains many internal hops where neither side
  // is the owner. Owner-net sidesteps both pitfalls.
  const ownerDeltas = computeOwnerDeltas(t, owner);

  // Treat a tx as a swap if Helius classified it that way OR if the owner has
  // both a positive and a negative net balance change. Either way, we always
  // pick the legs from the owner-net deltas — never from the first array slot.
  const heliusSaysSwap =
    t.type === "SWAP" || (t.events?.swap && (t.events.swap.tokenInputs?.length || t.events.swap.nativeInput || t.events.swap.tokenOutputs?.length || t.events.swap.nativeOutput));
  const positives = ownerDeltas.filter((d) => d.amount > 0);
  const negatives = ownerDeltas.filter((d) => d.amount < 0);

  if (heliusSaysSwap || (positives.length && negatives.length)) {
    base.type = "swap";
    // Pick the largest-magnitude leg in each direction (covers multi-token
    // exits like "swap into SOL+USDC" — the dominant leg is what matters).
    const inLeg = negatives.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
    const outLeg = positives.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
    if (inLeg) base.inToken = { mint: inLeg.mint, symbol: shortMint(inLeg.mint), amount: Math.abs(inLeg.amount) };
    if (outLeg) base.outToken = { mint: outLeg.mint, symbol: shortMint(outLeg.mint), amount: outLeg.amount };
    base.valueUsd = computeSwapUsd(base.inToken, base.outToken);
    return base;
  }

  // Plain transfer: exactly one side moved (positive = received, negative = sent).
  // Use the owner-net delta with the largest magnitude for the headline label.
  const dominant = ownerDeltas.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
  if (dominant && Math.abs(dominant.amount) > 1e-9) {
    if (dominant.amount > 0) {
      base.type = "transfer_in";
      base.inToken = { mint: dominant.mint, symbol: shortMint(dominant.mint), amount: dominant.amount };
      base.counterparty = findCounterparty(t, dominant.mint, owner, "in");
    } else {
      base.type = "transfer_out";
      base.outToken = { mint: dominant.mint, symbol: shortMint(dominant.mint), amount: Math.abs(dominant.amount) };
      base.counterparty = findCounterparty(t, dominant.mint, owner, "out");
    }
    if (dominant.mint === SOL_MINT) base.solChange = dominant.amount;
    return base;
  }

  return base; // other
}

/**
 * Sum every balance movement for `owner` across native + SPL legs of the tx.
 * Returns one entry per mint touched, with positive `amount` for received
 * and negative for spent. Internal routing hops (where neither side is the
 * owner) are correctly ignored.
 */
function computeOwnerDeltas(
  t: any,
  owner: string,
): Array<{ mint: string; amount: number }> {
  const deltas = new Map<string, number>();

  // Native SOL — sum nativeTransfers in/out of the owner.
  if (Array.isArray(t.nativeTransfers)) {
    let solNet = 0;
    for (const nt of t.nativeTransfers) {
      const amt = (nt.amount ?? 0) / 1e9;
      if (nt.toUserAccount === owner) solNet += amt;
      else if (nt.fromUserAccount === owner) solNet -= amt;
    }
    // Subtract the owner's tx fee so a "send 1 SOL" tx doesn't look like
    // -1.000005 SOL. Fee is only paid by feePayer.
    if (t.feePayer === owner && typeof t.fee === "number") {
      solNet += t.fee / 1e9; // add back so net reflects intent, not gas
    }
    if (Math.abs(solNet) > 1e-9) deltas.set(SOL_MINT, solNet);
  }

  // SPL tokens — prefer `accountData.tokenBalanceChanges` (signed, per owner)
  // because Helius emits a clean per-owner delta. Fall back to summing
  // `tokenTransfers` if accountData is absent.
  let usedAccountData = false;
  if (Array.isArray(t.accountData)) {
    for (const ad of t.accountData) {
      const tbc = ad?.tokenBalanceChanges;
      if (!Array.isArray(tbc) || tbc.length === 0) continue;
      for (const ch of tbc) {
        if (ch.userAccount !== owner) continue;
        const raw = Number(ch.rawTokenAmount?.tokenAmount ?? 0);
        const dec = Number(ch.rawTokenAmount?.decimals ?? 0);
        if (!raw) continue;
        const amt = raw / Math.pow(10, dec);
        // Skip wSOL — already counted in nativeTransfers above. Helius
        // double-records WSOL wraps as both native and token movements.
        if (ch.mint === SOL_MINT) continue;
        const prev = deltas.get(ch.mint) ?? 0;
        deltas.set(ch.mint, prev + amt);
        usedAccountData = true;
      }
    }
  }

  if (!usedAccountData && Array.isArray(t.tokenTransfers)) {
    for (const tt of t.tokenTransfers) {
      const amt = Number(tt.tokenAmount ?? 0);
      if (!amt) continue;
      if (tt.mint === SOL_MINT) continue; // wSOL — handled via nativeTransfers
      if (tt.toUserAccount === owner) {
        deltas.set(tt.mint, (deltas.get(tt.mint) ?? 0) + amt);
      } else if (tt.fromUserAccount === owner) {
        deltas.set(tt.mint, (deltas.get(tt.mint) ?? 0) - amt);
      }
    }
  }

  // Drop dust deltas that are effectively zero (rounding noise).
  const out: Array<{ mint: string; amount: number }> = [];
  for (const [mint, amount] of deltas.entries()) {
    if (Math.abs(amount) > 1e-9) out.push({ mint, amount });
  }
  return out;
}

function findCounterparty(
  t: any,
  mint: string,
  owner: string,
  direction: "in" | "out",
): string | null {
  if (mint === SOL_MINT && Array.isArray(t.nativeTransfers)) {
    for (const nt of t.nativeTransfers) {
      if (direction === "in" && nt.toUserAccount === owner && nt.fromUserAccount && nt.fromUserAccount !== owner) {
        return nt.fromUserAccount;
      }
      if (direction === "out" && nt.fromUserAccount === owner && nt.toUserAccount && nt.toUserAccount !== owner) {
        return nt.toUserAccount;
      }
    }
  }
  if (Array.isArray(t.tokenTransfers)) {
    for (const tt of t.tokenTransfers) {
      if (tt.mint !== mint) continue;
      if (direction === "in" && tt.toUserAccount === owner && tt.fromUserAccount && tt.fromUserAccount !== owner) {
        return tt.fromUserAccount;
      }
      if (direction === "out" && tt.fromUserAccount === owner && tt.toUserAccount && tt.toUserAccount !== owner) {
        return tt.toUserAccount;
      }
    }
  }
  return null;
}

function computeSwapUsd(
  inSide: { mint: string; amount: number } | undefined,
  outSide: { mint: string; amount: number } | undefined,
): number | null {
  // If one side is a stable, use it directly as the USD value
  if (inSide && STABLES.has(inSide.mint)) return inSide.amount;
  if (outSide && STABLES.has(outSide.mint)) return outSide.amount;
  return null; // unknown until we cross-reference price (kept null for honesty)
}

function computeTokenPnL(parsed: ParsedTx[], balance: BalanceSnapshot): TokenPnL[] {
  const map = new Map<string, TokenPnL>();

  const ensure = (mint: string, symbol: string): TokenPnL => {
    let row = map.get(mint);
    if (row) return row;
    const meta = balance.byMint.get(mint);
    row = {
      mint,
      symbol: meta?.symbol ?? symbol,
      name: meta?.name ?? symbol,
      logo: meta?.logo ?? null,
      buys: 0,
      sells: 0,
      costUsd: 0,
      proceedsUsd: 0,
      unitsBought: 0,
      unitsSold: 0,
      currentUnits: meta?.units ?? 0,
      currentPriceUsd: meta?.priceUsd ?? null,
      currentValueUsd: meta && meta.priceUsd != null ? meta.units * meta.priceUsd : null,
      realizedUsd: 0,
      unrealizedUsd: 0,
      pairUrl: null,
    };
    map.set(mint, row);
    return row;
  };

  // First pass: aggregate buys/sells from swaps with known USD value.
  // We treat anything in QUOTES (USDC/USDT/SOL) as the "money side". This
  // keeps SOL-funded buys (the most common path on Solana) from being
  // silently dropped — backfillSolValueUsd() has already filled valueUsd.
  for (const tx of parsed) {
    if (tx.type !== "swap" || tx.valueUsd == null) continue;

    // BUY: wallet RECEIVED a non-quote token, paid in a quote (stable or SOL)
    if (tx.outToken && !QUOTES.has(tx.outToken.mint) && tx.inToken && QUOTES.has(tx.inToken.mint)) {
      const row = ensure(tx.outToken.mint, tx.outToken.symbol);
      row.buys += 1;
      row.costUsd += tx.valueUsd;
      row.unitsBought += tx.outToken.amount;
    }
    // SELL: wallet SENT a non-quote token, received a quote (stable or SOL)
    if (tx.inToken && !QUOTES.has(tx.inToken.mint) && tx.outToken && QUOTES.has(tx.outToken.mint)) {
      const row = ensure(tx.inToken.mint, tx.inToken.symbol);
      row.sells += 1;
      row.proceedsUsd += tx.valueUsd;
      row.unitsSold += tx.inToken.amount;
    }
  }

  // Add current holdings that had no recorded activity (still want them visible)
  for (const [mint, meta] of balance.byMint.entries()) {
    if (!map.has(mint) && (meta.priceUsd ?? 0) * meta.units > 1) {
      ensure(mint, meta.symbol);
    }
  }

  // Compute realized/unrealized using average cost basis
  for (const row of map.values()) {
    const avgCost = row.unitsBought > 0 ? row.costUsd / row.unitsBought : 0;
    const costOfSold = avgCost * row.unitsSold;
    row.realizedUsd = row.proceedsUsd - costOfSold;
    const heldCostBasis = avgCost * Math.max(row.currentUnits, 0);
    row.unrealizedUsd = (row.currentValueUsd ?? 0) - heldCostBasis;
    row.pairUrl = `https://dexscreener.com/solana/${row.mint}`;
  }

  return [...map.values()];
}

// Best-effort symbol for a mint when we have nothing better than the address.
// We special-case the well-known quote assets so swap rows don't show
// "So11…1112" or "EPjF…Dt1v" in the chat — even before the balance snapshot
// has been merged in.
const KNOWN_SYMBOLS: Record<string, string> = {
  [SOL_MINT]: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};
function shortMint(m: string): string {
  if (!m) return "?";
  if (KNOWN_SYMBOLS[m]) return KNOWN_SYMBOLS[m];
  return m.length > 8 ? `${m.slice(0, 4)}…${m.slice(-4)}` : m;
}

// Replace placeholder symbols (e.g. "CJUr…pump") on parsed tx legs with the
// real ticker pulled from the holdings snapshot — purely cosmetic, but the
// difference between "swap → CJUr…pump" and "swap → HENRY" is huge in chat.
function enrichTxSymbols(parsed: ParsedTx[], balance: BalanceSnapshot) {
  const lookup = (mint: string): string | null => {
    if (KNOWN_SYMBOLS[mint]) return KNOWN_SYMBOLS[mint];
    const meta = balance.byMint.get(mint);
    if (meta?.symbol && meta.symbol !== "?") return meta.symbol;
    return null;
  };
  for (const tx of parsed) {
    if (tx.inToken) {
      const s = lookup(tx.inToken.mint);
      if (s) tx.inToken.symbol = s;
    }
    if (tx.outToken) {
      const s = lookup(tx.outToken.mint);
      if (s) tx.outToken.symbol = s;
    }
  }
}

/** Fetch metadata for a single mint via Helius DAS (used when the wallet no
 *  longer holds the token, so it's not in the balance snapshot). Returns the
 *  symbol, name, and logo so per-token PnL cards stay readable post-exit. */
async function fetchAssetMetadata(
  mint: string,
  apiKey: string,
): Promise<{ symbol: string; name: string; logo: string | null; priceUsd: number | null } | null> {
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "vision-meta",
        method: "getAsset",
        params: { id: mint, displayOptions: { showFungible: true } },
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const item = d?.result;
    if (!item) return null;
    const info = item.token_info ?? {};
    return {
      symbol: info.symbol ?? "?",
      name: item.content?.metadata?.name ?? info.symbol ?? "Unknown",
      logo: item.content?.links?.image ?? null,
      priceUsd: info.price_info?.price_per_token ?? null,
    };
  } catch {
    return null;
  }
}

// Fill in valueUsd for swaps where the quote leg is SOL (and therefore not
// already 1:1 with USD). We try the snapshot's current SOL price first
// (cheap, already in memory) and fall back to CoinGecko's spot price. This
// is intentionally an approximation — close enough for "did I make/lose
// money on this trade today" but not tax-grade. Without it, every SOL-paired
// swap shows "No data" in the PnL card.
async function backfillSolValueUsd(parsed: ParsedTx[], balance: BalanceSnapshot) {
  // Quick exit if nothing needs backfilling
  const needsSolPrice = parsed.some(
    (tx) =>
      tx.type === "swap" &&
      tx.valueUsd == null &&
      ((tx.inToken?.mint === SOL_MINT && tx.outToken && !QUOTES.has(tx.outToken.mint)) ||
        (tx.outToken?.mint === SOL_MINT && tx.inToken && !QUOTES.has(tx.inToken.mint))),
  );
  if (!needsSolPrice) return;

  let solPrice = balance.byMint.get(SOL_MINT)?.priceUsd ?? null;
  if (solPrice == null || solPrice <= 0) {
    try {
      const r = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      );
      if (r.ok) {
        const d = await r.json();
        const p = Number(d?.solana?.usd);
        if (Number.isFinite(p) && p > 0) solPrice = p;
      }
    } catch (e) {
      console.error("SOL price fetch failed:", e);
    }
  }
  if (solPrice == null || solPrice <= 0) return; // give up silently

  for (const tx of parsed) {
    if (tx.type !== "swap" || tx.valueUsd != null) continue;
    if (tx.inToken?.mint === SOL_MINT) tx.valueUsd = tx.inToken.amount * solPrice;
    else if (tx.outToken?.mint === SOL_MINT) tx.valueUsd = tx.outToken.amount * solPrice;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
