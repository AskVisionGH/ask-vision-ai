// EVM wallet PnL & recent activity, modelled on `wallet-pnl` (Solana).
//
// Strategy:
//   1. Pull token-transfer history from Etherscan v2 (single API key,
//      `chainid` param picks the chain) for ERC-20 + native ETH/MATIC/etc.
//   2. Group transfers by transaction hash to reconstruct each "swap" —
//      one tx hash with both an outgoing token and an incoming token to
//      the same wallet is a swap. Pure transfers in/out are recorded too.
//   3. Use LI.FI's verified token list for symbol/decimals/USD price
//      enrichment (matches what evm-wallet-balance and the picker use).
//   4. Compute per-token PnL using the SAME quote-asset rule as Solana:
//      buy = received non-quote token, paid in a quote token (USDC/USDT/
//      DAI/ETH/WETH/native). Sell is the inverse. Native tokens get a
//      live price backfill so e.g. "bought $PEPE with ETH" still books
//      cost basis. Without the backfill every native-paired trade would
//      silently drop to "No data" — same bug we just fixed on Solana.
//
// Window: last 30 days, capped to the 1000 most-recent transfers per
// (wallet × chain) call to keep latency reasonable. Mirrors wallet-pnl's
// `MAX_PAGES * PER_PAGE` cap.
//
// Returns:
//   slice="recent_txs"  → recent parsed activity
//   slice="token_pnl"   → single-token PnL + recent fills for that token
//   slice="wallet_pnl"  → totals + top tokens + recent activity (default)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- Chain configuration ---------------------------------------------------

interface ChainCfg {
  id: number;
  key: string;          // short label (matches evm-wallet-balance / LI.FI keys)
  nativeSymbol: string;
  nativeName: string;
  nativeCgId: string;   // CoinGecko id for fallback price lookup
  nativeLogo: string;
}

const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";
const ETH_LOGO =
  "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png";

const CHAINS: Record<number, ChainCfg> = {
  1: { id: 1, key: "ethereum", nativeSymbol: "ETH", nativeName: "Ether", nativeCgId: "ethereum", nativeLogo: ETH_LOGO },
  10: { id: 10, key: "optimism", nativeSymbol: "ETH", nativeName: "Ether", nativeCgId: "ethereum", nativeLogo: ETH_LOGO },
  56: { id: 56, key: "bsc", nativeSymbol: "BNB", nativeName: "BNB", nativeCgId: "binancecoin", nativeLogo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png" },
  137: { id: 137, key: "polygon", nativeSymbol: "MATIC", nativeName: "Polygon", nativeCgId: "matic-network", nativeLogo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png" },
  324: { id: 324, key: "zksync", nativeSymbol: "ETH", nativeName: "Ether", nativeCgId: "ethereum", nativeLogo: ETH_LOGO },
  8453: { id: 8453, key: "base", nativeSymbol: "ETH", nativeName: "Ether", nativeCgId: "ethereum", nativeLogo: ETH_LOGO },
  42161: { id: 42161, key: "arbitrum", nativeSymbol: "ETH", nativeName: "Ether", nativeCgId: "ethereum", nativeLogo: ETH_LOGO },
  43114: { id: 43114, key: "avalanche", nativeSymbol: "AVAX", nativeName: "Avalanche", nativeCgId: "avalanche-2", nativeLogo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png" },
  59144: { id: 59144, key: "linea", nativeSymbol: "ETH", nativeName: "Ether", nativeCgId: "ethereum", nativeLogo: ETH_LOGO },
  534352: { id: 534352, key: "scroll", nativeSymbol: "ETH", nativeName: "Ether", nativeCgId: "ethereum", nativeLogo: ETH_LOGO },
};

// Common quote assets across EVM. Anything in here counts as the "money side"
// of a buy/sell. Stablecoin addresses are deliberately overlapping per chain
// (USDC has different addresses on each chain), so we identify by symbol AND
// the native sentinel — much more reliable than a hardcoded address list
// across 10 chains.
const STABLE_SYMBOLS = new Set([
  "USDC", "USDC.E", "USDT", "USDT.E", "DAI", "DAI.E",
  "BUSD", "FDUSD", "PYUSD", "USDP", "TUSD", "GUSD", "LUSD", "FRAX",
  "EURC", "EURS",
]);

// "Native + canonical wrapped" symbols — paired with chain context for
// correctness. We treat WETH as a quote on every EVM chain; on BSC/AVAX
// we also treat WBNB/WAVAX as quotes.
const NATIVE_QUOTE_SYMBOLS = new Set([
  "ETH", "WETH",
  "BNB", "WBNB",
  "MATIC", "WMATIC",
  "AVAX", "WAVAX",
]);

const WINDOW_DAYS = 30;
const MAX_TRANSFERS = 1000; // per category per chain — Etherscan caps page size at 10k but we rarely need more
const PAGE_SIZE = 1000;

// --- Types -----------------------------------------------------------------

interface TokenLeg {
  address: string;          // lowercase contract address, or NATIVE_ADDRESS for native
  symbol: string;
  decimals: number;
  amount: number;           // human units
}

interface ParsedEvmTx {
  hash: string;
  timestamp: number;
  type: "swap" | "transfer_in" | "transfer_out" | "other";
  fee: number;              // in native token units
  inToken?: TokenLeg;       // wallet RECEIVED
  outToken?: TokenLeg;      // wallet SENT
  counterparty?: string | null;
  valueUsd: number | null;
}

interface TokenPnL {
  address: string;
  symbol: string;
  name: string;
  logo: string | null;
  buys: number;
  sells: number;
  costUsd: number;
  proceedsUsd: number;
  unitsBought: number;
  unitsSold: number;
  realizedUsd: number;
  // Holdings + unrealised intentionally omitted for now — wired in once we
  // ship balance integration. Keeps the surface honest.
}

interface LifiToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string | null;
  priceUSD?: string | null;
}

// --- LI.FI cache (per chain), short TTL ------------------------------------

const tokenCache = new Map<string, { ts: number; tokens: Map<string, LifiToken> }>();
const TOKEN_TTL_MS = 5 * 60 * 1000;

async function loadLifiTokenMap(chainId: number): Promise<Map<string, LifiToken>> {
  const key = String(chainId);
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.ts < TOKEN_TTL_MS) return hit.tokens;

  const apiKey = Deno.env.get("LIFI_API_KEY");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-lifi-api-key"] = apiKey;

  const map = new Map<string, LifiToken>();
  try {
    const resp = await fetch(
      `https://li.quest/v1/tokens?chains=${encodeURIComponent(key)}`,
      { headers },
    );
    if (resp.ok) {
      const data = await resp.json();
      const list: LifiToken[] = data.tokens?.[key] ?? [];
      for (const t of list) {
        if (!t?.address) continue;
        map.set(t.address.toLowerCase(), t);
      }
    } else {
      console.error("LI.FI tokens fetch failed:", resp.status);
    }
  } catch (e) {
    console.error("LI.FI tokens error:", e);
  }
  tokenCache.set(key, { ts: Date.now(), tokens: map });
  return map;
}

// --- Etherscan v2 helpers --------------------------------------------------

interface EtherscanTransfer {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  contractAddress?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  gasUsed?: string;
  gasPrice?: string;
}

async function etherscan<T = any>(
  chainId: number,
  module: string,
  action: string,
  params: Record<string, string>,
): Promise<T[]> {
  const apiKey = Deno.env.get("ETHERSCAN_API_KEY");
  if (!apiKey) throw new Error("ETHERSCAN_API_KEY missing");

  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", module);
  url.searchParams.set("action", action);
  url.searchParams.set("apikey", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    console.error("Etherscan v2 error:", chainId, action, resp.status);
    return [];
  }
  const data = await resp.json();
  // Etherscan returns { status: "1", result: [...] } or status "0" with
  // "No transactions found". Treat both as "empty list, no error".
  if (Array.isArray(data?.result)) return data.result as T[];
  return [];
}

async function fetchTransfers(
  chainId: number,
  address: string,
  startTs: number,
): Promise<EtherscanTransfer[]> {
  // Run native + ERC-20 in parallel. We bound by `MAX_TRANSFERS` per category.
  const baseParams = {
    address,
    startblock: "0",
    endblock: "99999999",
    page: "1",
    offset: String(Math.min(MAX_TRANSFERS, PAGE_SIZE)),
    sort: "desc",
  };
  const [native, erc20] = await Promise.all([
    etherscan<EtherscanTransfer>(chainId, "account", "txlist", baseParams),
    etherscan<EtherscanTransfer>(chainId, "account", "tokentx", baseParams),
  ]);
  // Filter to the 30-day window. Etherscan returns desc, so we can break early.
  const out: EtherscanTransfer[] = [];
  for (const t of [...native, ...erc20]) {
    const ts = Number(t.timeStamp);
    if (Number.isFinite(ts) && ts >= startTs) out.push(t);
  }
  return out;
}

// --- Parse + group ---------------------------------------------------------

const ZERO_BIG = 0n;

function asBigInt(s: string | undefined): bigint {
  if (!s) return ZERO_BIG;
  try { return BigInt(s); } catch { return ZERO_BIG; }
}

function legFromTransfer(
  t: EtherscanTransfer,
  chain: ChainCfg,
  lifi: Map<string, LifiToken>,
  isNative: boolean,
): TokenLeg | null {
  const raw = asBigInt(t.value);
  if (raw === ZERO_BIG) return null;

  if (isNative) {
    const amount = Number(raw) / 1e18;
    return {
      address: NATIVE_ADDRESS,
      symbol: chain.nativeSymbol,
      decimals: 18,
      amount,
    };
  }

  const contract = (t.contractAddress ?? "").toLowerCase();
  if (!contract) return null;
  const meta = lifi.get(contract);
  const decimals = Number(t.tokenDecimal ?? meta?.decimals ?? 18);
  const symbol = (t.tokenSymbol ?? meta?.symbol ?? "?").toUpperCase();
  const amount = Number(raw) / Math.pow(10, decimals);
  return { address: contract, symbol, decimals, amount };
}

/**
 * Group raw Etherscan rows by transaction hash, then reduce each group into
 * a single ParsedEvmTx with at most one inbound + one outbound leg from the
 * wallet's perspective. This is the EVM equivalent of how `wallet-pnl` reads
 * Helius's `events.swap`.
 */
function buildParsed(
  transfers: EtherscanTransfer[],
  ownerLower: string,
  chain: ChainCfg,
  lifi: Map<string, LifiToken>,
): ParsedEvmTx[] {
  // Bucket by hash, tag native vs erc20 by presence of `tokenSymbol`/`contractAddress`.
  type Row = { t: EtherscanTransfer; isNative: boolean };
  const byHash = new Map<string, Row[]>();
  for (const t of transfers) {
    const isNative = !t.contractAddress; // txlist rows have no contractAddress
    const arr = byHash.get(t.hash) ?? [];
    arr.push({ t, isNative });
    byHash.set(t.hash, arr);
  }

  const out: ParsedEvmTx[] = [];
  for (const [hash, rows] of byHash.entries()) {
    let timestamp = 0;
    let fee = 0;
    // Aggregate by mint+direction so e.g. multi-hop routers that move the
    // same token in two steps still net out cleanly.
    const inLegs = new Map<string, TokenLeg>();
    const outLegs = new Map<string, TokenLeg>();
    let counterparty: string | null = null;

    for (const { t, isNative } of rows) {
      const ts = Number(t.timeStamp);
      if (Number.isFinite(ts) && ts > timestamp) timestamp = ts;
      // Fee is only on the native txlist row (not on the ERC-20 mirror).
      if (isNative && t.gasUsed && t.gasPrice) {
        fee = Number(asBigInt(t.gasUsed) * asBigInt(t.gasPrice)) / 1e18;
      }

      const leg = legFromTransfer(t, chain, lifi, isNative);
      if (!leg) continue;

      const from = (t.from ?? "").toLowerCase();
      const to = (t.to ?? "").toLowerCase();
      if (to === ownerLower && from !== ownerLower) {
        const prev = inLegs.get(leg.address);
        if (prev) prev.amount += leg.amount;
        else inLegs.set(leg.address, { ...leg });
        if (!counterparty) counterparty = from;
      } else if (from === ownerLower && to !== ownerLower) {
        const prev = outLegs.get(leg.address);
        if (prev) prev.amount += leg.amount;
        else outLegs.set(leg.address, { ...leg });
        if (!counterparty) counterparty = to;
      }
      // Self-transfers (from === to) and unrelated rows are ignored.
    }

    if (inLegs.size === 0 && outLegs.size === 0) continue;

    // Reduce to at most one in + one out leg by picking the largest USD
    // (or, if no price yet, largest amount). Multi-hop swaps almost always
    // collapse to one in + one out at the wallet level.
    const inLeg = pickLargest(inLegs, lifi);
    const outLeg = pickLargest(outLegs, lifi);

    const tx: ParsedEvmTx = {
      hash,
      timestamp,
      type: "other",
      fee,
      counterparty,
      valueUsd: null,
    };
    if (inLeg) tx.inToken = inLeg;
    if (outLeg) tx.outToken = outLeg;

    if (inLeg && outLeg) tx.type = "swap";
    else if (inLeg) tx.type = "transfer_in";
    else if (outLeg) tx.type = "transfer_out";

    tx.valueUsd = computeUsd(inLeg, outLeg, lifi);
    out.push(tx);
  }

  // Sort newest first — matches wallet-pnl's slice/limit conventions.
  out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
}

function pickLargest(
  legs: Map<string, TokenLeg>,
  lifi: Map<string, LifiToken>,
): TokenLeg | undefined {
  let best: TokenLeg | undefined;
  let bestScore = -Infinity;
  for (const leg of legs.values()) {
    const meta = lifi.get(leg.address);
    const price = meta?.priceUSD ? Number(meta.priceUSD) : 0;
    const score = price > 0 ? leg.amount * price : leg.amount;
    if (score > bestScore) {
      bestScore = score;
      best = leg;
    }
  }
  return best;
}

function isQuote(leg: TokenLeg | undefined): boolean {
  if (!leg) return false;
  const sym = leg.symbol.toUpperCase();
  return STABLE_SYMBOLS.has(sym) || NATIVE_QUOTE_SYMBOLS.has(sym);
}

function computeUsd(
  inLeg: TokenLeg | undefined,
  outLeg: TokenLeg | undefined,
  lifi: Map<string, LifiToken>,
): number | null {
  // Stable side wins — it IS the USD value (modulo de-pegs we don't care about here).
  for (const leg of [inLeg, outLeg]) {
    if (leg && STABLE_SYMBOLS.has(leg.symbol.toUpperCase())) return leg.amount;
  }
  // Native/wrapped quote with a known LI.FI price.
  for (const leg of [inLeg, outLeg]) {
    if (!leg) continue;
    if (!NATIVE_QUOTE_SYMBOLS.has(leg.symbol.toUpperCase())) continue;
    const price = priceOf(leg, lifi);
    if (price != null) return leg.amount * price;
  }
  return null;
}

function priceOf(leg: TokenLeg, lifi: Map<string, LifiToken>): number | null {
  const meta = lifi.get(leg.address);
  const p = meta?.priceUSD ? Number(meta.priceUSD) : NaN;
  return Number.isFinite(p) && p > 0 ? p : null;
}

/**
 * For chains where the native token isn't in LI.FI's price list (rare but
 * happens on long-tail chains), fetch a CoinGecko spot price and patch
 * valueUsd retroactively. Mirrors the SOL backfill we just added on Solana.
 */
async function backfillNativeUsd(parsed: ParsedEvmTx[], chain: ChainCfg, lifi: Map<string, LifiToken>) {
  const needs = parsed.some(
    (tx) =>
      tx.valueUsd == null &&
      tx.type === "swap" &&
      ((tx.inToken?.symbol === chain.nativeSymbol && tx.outToken && !isQuote(tx.outToken)) ||
        (tx.outToken?.symbol === chain.nativeSymbol && tx.inToken && !isQuote(tx.inToken))),
  );
  if (!needs) return;

  // First try LI.FI's native sentinel (address 0x000…000 keyed under chain).
  const nativeMeta = lifi.get(NATIVE_ADDRESS);
  let price = nativeMeta?.priceUSD ? Number(nativeMeta.priceUSD) : NaN;

  if (!Number.isFinite(price) || price <= 0) {
    try {
      const r = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${chain.nativeCgId}&vs_currencies=usd`,
      );
      if (r.ok) {
        const d = await r.json();
        const p = Number(d?.[chain.nativeCgId]?.usd);
        if (Number.isFinite(p) && p > 0) price = p;
      }
    } catch (e) {
      console.error("Native price fetch failed:", chain.key, e);
    }
  }
  if (!Number.isFinite(price) || price <= 0) return;

  for (const tx of parsed) {
    if (tx.valueUsd != null || tx.type !== "swap") continue;
    if (tx.inToken?.symbol === chain.nativeSymbol) tx.valueUsd = tx.inToken.amount * price;
    else if (tx.outToken?.symbol === chain.nativeSymbol) tx.valueUsd = tx.outToken.amount * price;
  }
}

// --- PnL math --------------------------------------------------------------

function computeTokenPnL(parsed: ParsedEvmTx[], lifi: Map<string, LifiToken>): TokenPnL[] {
  const map = new Map<string, TokenPnL>();
  const ensure = (leg: TokenLeg): TokenPnL => {
    let row = map.get(leg.address);
    if (row) return row;
    const meta = lifi.get(leg.address);
    row = {
      address: leg.address,
      symbol: meta?.symbol ?? leg.symbol,
      name: meta?.name ?? leg.symbol,
      logo: meta?.logoURI ?? null,
      buys: 0,
      sells: 0,
      costUsd: 0,
      proceedsUsd: 0,
      unitsBought: 0,
      unitsSold: 0,
      realizedUsd: 0,
    };
    map.set(leg.address, row);
    return row;
  };

  for (const tx of parsed) {
    if (tx.type !== "swap" || tx.valueUsd == null) continue;
    // BUY: received non-quote, paid in quote.
    if (tx.inToken && isQuote(tx.inToken) && tx.outToken && !isQuote(tx.outToken)) {
      const row = ensure(tx.outToken);
      row.buys += 1;
      row.costUsd += tx.valueUsd;
      row.unitsBought += tx.outToken.amount;
    }
    // SELL: sent non-quote, received quote.
    if (tx.outToken && isQuote(tx.outToken) && tx.inToken && !isQuote(tx.inToken)) {
      const row = ensure(tx.inToken);
      row.sells += 1;
      row.proceedsUsd += tx.valueUsd;
      row.unitsSold += tx.inToken.amount;
    }
  }

  for (const row of map.values()) {
    const avgCost = row.unitsBought > 0 ? row.costUsd / row.unitsBought : 0;
    row.realizedUsd = row.proceedsUsd - avgCost * row.unitsSold;
  }

  return [...map.values()];
}

// --- Handler ---------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const address: string = String(body.address ?? "").trim();
    const chainId: number = Number(body.chainId ?? 1);
    const slice: "recent_txs" | "token_pnl" | "wallet_pnl" = body.slice ?? "wallet_pnl";
    const tokenFilter: string | null = body.tokenFilter ?? null;
    const limit: number = Math.min(Math.max(Number(body.limit ?? 25), 5), 50);

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return json({ error: "Invalid EVM address" }, 400);
    }
    const chain = CHAINS[chainId];
    if (!chain) return json({ error: `Unsupported chainId: ${chainId}` }, 400);

    const cutoff = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;
    const ownerLower = address.toLowerCase();

    const [transfers, lifi] = await Promise.all([
      fetchTransfers(chainId, address, cutoff),
      loadLifiTokenMap(chainId),
    ]);

    const parsed = buildParsed(transfers, ownerLower, chain, lifi);
    await backfillNativeUsd(parsed, chain, lifi);

    const tokenPnL = computeTokenPnL(parsed, lifi);

    const totals = {
      totalRealizedUsd: tokenPnL.reduce((s, t) => s + t.realizedUsd, 0),
      totalCostUsd: tokenPnL.reduce((s, t) => s + t.costUsd, 0),
      totalProceedsUsd: tokenPnL.reduce((s, t) => s + t.proceedsUsd, 0),
      txCount: parsed.length,
    };

    if (slice === "recent_txs") {
      return json({
        address,
        chainId,
        chain: chain.key,
        windowDays: WINDOW_DAYS,
        txs: parsed.slice(0, limit),
        totalCount: parsed.length,
      });
    }

    if (slice === "token_pnl" && tokenFilter) {
      const target = tokenFilter.toLowerCase().replace(/^$/, "");
      const match = tokenPnL.find(
        (t) => t.address.toLowerCase() === target || t.symbol.toLowerCase() === target,
      );
      const matchAddr = match?.address.toLowerCase() ?? "";
      return json({
        address,
        chainId,
        chain: chain.key,
        windowDays: WINDOW_DAYS,
        token: match ?? null,
        recentTxs: parsed
          .filter(
            (p) =>
              (p.inToken && p.inToken.address.toLowerCase() === matchAddr) ||
              (p.outToken && p.outToken.address.toLowerCase() === matchAddr),
          )
          .slice(0, 10),
      });
    }

    return json({
      address,
      chainId,
      chain: chain.key,
      windowDays: WINDOW_DAYS,
      totals,
      tokens: tokenPnL
        .filter((t) => Math.abs(t.realizedUsd) + t.costUsd + t.proceedsUsd > 0.5)
        .sort((a, b) => Math.abs(b.realizedUsd) - Math.abs(a.realizedUsd))
        .slice(0, 12),
      recentTxs: parsed.slice(0, 10),
    });
  } catch (e) {
    console.error("evm-wallet-pnl error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
