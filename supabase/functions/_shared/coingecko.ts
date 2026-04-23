// Shared CoinGecko lookup used by token-info and token-chart. Lets us serve
// proper aggregated cross-exchange charts for major-cap coins (BTC, ETH, XRP, etc)
// instead of a single low-liquidity Solana DEX pool.
//
// CoinGecko's free public API has rate limits (~10-30 req/min) but is fine for
// our usage given the in-memory cache below.

export interface CgCoin {
  id: string;          // e.g. "bitcoin"
  symbol: string;      // e.g. "btc"
  name: string;        // e.g. "Bitcoin"
  marketCapRank?: number | null;
}

const CG_BASE = "https://api.coingecko.com/api/v3";

// Top-N coins we always want CoinGecko to win for, regardless of any DEX
// shadow tokens with the same ticker (e.g. "ETH" should never resolve to a
// random Solana token). Lowercase symbol → coingecko id.
//
// This is intentionally conservative — only blue chips. Anything outside this
// list still goes through the dynamic top-list lookup.
const PRIORITY_SYMBOLS: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  xrp: "ripple",
  bnb: "binancecoin",
  ada: "cardano",
  doge: "dogecoin",
  trx: "tron",
  ton: "the-open-network",
  avax: "avalanche-2",
  shib: "shiba-inu",
  link: "chainlink",
  dot: "polkadot",
  matic: "matic-network",
  pol: "polygon-ecosystem-token",
  ltc: "litecoin",
  bch: "bitcoin-cash",
  near: "near",
  uni: "uniswap",
  atom: "cosmos",
  apt: "aptos",
  arb: "arbitrum",
  op: "optimism",
  fil: "filecoin",
  hbar: "hedera-hashgraph",
  icp: "internet-computer",
  cro: "crypto-com-chain",
  vet: "vechain",
  algo: "algorand",
  xlm: "stellar",
  sui: "sui",
  sei: "sei-network",
  inj: "injective-protocol",
  tia: "celestia",
  pepe: "pepe",
  rndr: "render-token",
  render: "render-token",
  fet: "fetch-ai",
  imx: "immutable-x",
  mkr: "maker",
  aave: "aave",
  ldo: "lido-dao",
  // Stables — CoinGecko is the canonical price source.
  usdt: "tether",
  dai: "dai",
  wbtc: "wrapped-bitcoin",
  weth: "weth",
};

// Keys to keep SOL-native tokens on the Solana DEX path even though CoinGecko
// also tracks them — DEX gives us tighter intraday candles.
const KEEP_ON_SOLANA = new Set([
  "sol", "wsol", "usdc", "jup", "bonk", "wif", "jto", "pyth",
  "ray", "orca", "msol", "jitosol",
]);

interface TopListCacheEntry {
  fetchedAt: number;
  bySymbol: Map<string, CgCoin>;  // lower-cased symbol → coin
  byId: Map<string, CgCoin>;
  byName: Map<string, CgCoin>;    // lower-cased name → coin
}

let topListCache: TopListCacheEntry | null = null;
const TOP_LIST_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Fetch CoinGecko's top-250 by market cap and index by symbol/name/id.
 * Cached in memory for an hour. Safe to call from many requests — multiple
 * concurrent calls will all share the same in-flight promise.
 */
let inFlightTopList: Promise<TopListCacheEntry | null> | null = null;
async function getTopList(): Promise<TopListCacheEntry | null> {
  const now = Date.now();
  if (topListCache && now - topListCache.fetchedAt < TOP_LIST_TTL_MS) return topListCache;
  if (inFlightTopList) return inFlightTopList;

  inFlightTopList = (async () => {
    try {
      const resp = await fetch(
        `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false`,
        { headers: { Accept: "application/json", "User-Agent": "VisionBot/1.0" } },
      );
      if (!resp.ok) {
        console.error("CoinGecko top-list fetch failed:", resp.status);
        return null;
      }
      const data = (await resp.json()) as Array<{
        id: string;
        symbol: string;
        name: string;
        market_cap_rank: number | null;
      }>;
      const bySymbol = new Map<string, CgCoin>();
      const byId = new Map<string, CgCoin>();
      const byName = new Map<string, CgCoin>();
      for (const row of data) {
        const coin: CgCoin = {
          id: row.id,
          symbol: row.symbol,
          name: row.name,
          marketCapRank: row.market_cap_rank,
        };
        const sym = row.symbol.toLowerCase();
        // Don't overwrite a higher-ranked coin with a lower-ranked one when
        // they share a symbol (e.g. multiple "uni" entries).
        if (!bySymbol.has(sym)) bySymbol.set(sym, coin);
        byId.set(row.id, coin);
        byName.set(row.name.toLowerCase(), coin);
      }
      const entry: TopListCacheEntry = { fetchedAt: Date.now(), bySymbol, byId, byName };
      topListCache = entry;
      return entry;
    } catch (e) {
      console.error("CoinGecko top-list fetch error:", e);
      return null;
    } finally {
      inFlightTopList = null;
    }
  })();
  return inFlightTopList;
}

/**
 * Resolve a free-text query to a CoinGecko coin, but ONLY if it's a major-cap
 * coin we want CoinGecko to handle (i.e. in PRIORITY_SYMBOLS or the dynamic
 * top-250). Returns null for anything else so callers can fall through to the
 * Solana DEX path.
 */
export async function resolveCgCoin(query: string): Promise<CgCoin | null> {
  const cleaned = query.trim().replace(/^$/, "").toLowerCase();
  if (!cleaned) return null;

  // Solana-native tickers we explicitly keep on the DEX path.
  if (KEEP_ON_SOLANA.has(cleaned)) return null;

  // Hard-coded blue chips first (avoids depending on the network call for the
  // most common queries).
  const priorityId = PRIORITY_SYMBOLS[cleaned];
  if (priorityId) {
    return { id: priorityId, symbol: cleaned, name: cleaned.toUpperCase() };
  }

  const top = await getTopList();
  if (!top) return null;

  // Try direct id, symbol, then name match.
  return (
    top.byId.get(cleaned) ??
    top.bySymbol.get(cleaned) ??
    top.byName.get(cleaned) ??
    null
  );
}

export interface CgSnapshot {
  id: string;
  symbol: string;
  name: string;
  logo: string | null;
  priceUsd: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  homepage: string | null;
}

/**
 * Pull the full coin snapshot needed by token-info. Uses /coins/{id} which
 * includes 1h/24h price changes and market data.
 */
export async function fetchCgSnapshot(coin: CgCoin): Promise<CgSnapshot | null> {
  try {
    const url =
      `${CG_BASE}/coins/${coin.id}?localization=false&tickers=false` +
      `&market_data=true&community_data=false&developer_data=false&sparkline=false`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "VisionBot/1.0" },
    });
    if (!resp.ok) {
      console.error(`CoinGecko snapshot ${coin.id} failed:`, resp.status);
      return null;
    }
    const data = await resp.json();
    const md = data?.market_data ?? {};
    return {
      id: coin.id,
      symbol: (data?.symbol ?? coin.symbol ?? "").toUpperCase(),
      name: data?.name ?? coin.name,
      logo: data?.image?.large ?? data?.image?.small ?? null,
      priceUsd: md?.current_price?.usd ?? null,
      priceChange1h: md?.price_change_percentage_1h_in_currency?.usd ?? null,
      priceChange24h: md?.price_change_percentage_24h ?? null,
      marketCapUsd: md?.market_cap?.usd ?? null,
      fdvUsd: md?.fully_diluted_valuation?.usd ?? null,
      volume24hUsd: md?.total_volume?.usd ?? null,
      homepage: data?.links?.homepage?.[0] ?? null,
    };
  } catch (e) {
    console.error("CoinGecko snapshot error:", e);
    return null;
  }
}

export interface CgCandle {
  t: number; o: number; h: number; l: number; c: number; v: number;
}

/**
 * Fetch OHLC candles from CoinGecko. Their /coins/{id}/ohlc endpoint accepts
 * `days` (1, 7, 14, 30, 90, 180, 365, max) and bucket size is fixed by `days`:
 *   1   → 30-min buckets
 *   7   → 4-hour buckets
 *   14+ → 4-day buckets (too coarse for our shorter intervals)
 *
 * For finer/intraday intervals we fall back to /market_chart which gives us
 * minute-level price points; we re-bucket those ourselves into OHLCV.
 */
export async function fetchCgCandles(
  coin: CgCoin,
  interval: "5m" | "15m" | "1h" | "4h" | "1d",
): Promise<CgCandle[]> {
  // Map our interval → coingecko params + target bucket size in seconds.
  const cfg: Record<typeof interval, { days: number; bucketSecs: number }> = {
    "5m":  { days: 1,   bucketSecs: 5 * 60 },
    "15m": { days: 1,   bucketSecs: 15 * 60 },
    "1h":  { days: 7,   bucketSecs: 60 * 60 },
    "4h":  { days: 30,  bucketSecs: 4 * 60 * 60 },
    "1d":  { days: 180, bucketSecs: 24 * 60 * 60 },
  };
  const { days, bucketSecs } = cfg[interval];

  // For 1h, 4h, 1d we use the /ohlc endpoint (real OHLC, no synth).
  // For 5m/15m we have to re-bucket /market_chart minute data.
  if (interval === "1h" || interval === "4h" || interval === "1d") {
    try {
      const resp = await fetch(
        `${CG_BASE}/coins/${coin.id}/ohlc?vs_currency=usd&days=${days}`,
        { headers: { Accept: "application/json", "User-Agent": "VisionBot/1.0" } },
      );
      if (resp.ok) {
        const arr = (await resp.json()) as number[][];
        const ohlc = arr.map((row) => ({
          t: Math.floor(row[0] / 1000),
          o: row[1], h: row[2], l: row[3], c: row[4], v: 0,
        }));
        // Re-bucket to our target interval if CoinGecko's native is finer.
        const rebucketed = rebucket(ohlc, bucketSecs);
        // Pull volumes from /market_chart and stitch them in.
        const vols = await fetchCgVolumes(coin.id, days);
        attachVolumes(rebucketed, vols);
        return rebucketed;
      }
      console.error(`CoinGecko ohlc ${coin.id} failed:`, resp.status);
    } catch (e) {
      console.error("CoinGecko ohlc error:", e);
    }
  }

  // 5m/15m path (or fallback): synthesise OHLCV from /market_chart prices+volumes.
  try {
    const resp = await fetch(
      `${CG_BASE}/coins/${coin.id}/market_chart?vs_currency=usd&days=${days}`,
      { headers: { Accept: "application/json", "User-Agent": "VisionBot/1.0" } },
    );
    if (!resp.ok) {
      console.error(`CoinGecko market_chart ${coin.id} failed:`, resp.status);
      return [];
    }
    const data = await resp.json();
    const prices = (data?.prices ?? []) as [number, number][];
    const vols = (data?.total_volumes ?? []) as [number, number][];
    return synthCandles(prices, vols, bucketSecs);
  } catch (e) {
    console.error("CoinGecko market_chart error:", e);
    return [];
  }
}

async function fetchCgVolumes(id: string, days: number): Promise<[number, number][]> {
  try {
    const resp = await fetch(
      `${CG_BASE}/coins/${id}/market_chart?vs_currency=usd&days=${days}`,
      { headers: { Accept: "application/json", "User-Agent": "VisionBot/1.0" } },
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data?.total_volumes ?? []) as [number, number][];
  } catch {
    return [];
  }
}

function attachVolumes(candles: CgCandle[], vols: [number, number][]) {
  if (!vols.length || !candles.length) return;
  // Match each volume sample to the closest candle by timestamp.
  let vi = 0;
  for (const c of candles) {
    while (vi + 1 < vols.length && vols[vi + 1][0] / 1000 <= c.t) vi++;
    c.v = vols[vi]?.[1] ?? 0;
  }
}

/** Coalesce finer OHLC bars into wider buckets. */
function rebucket(bars: CgCandle[], bucketSecs: number): CgCandle[] {
  if (!bars.length) return [];
  const out: CgCandle[] = [];
  let bucketStart = Math.floor(bars[0].t / bucketSecs) * bucketSecs;
  let cur: CgCandle | null = null;
  for (const b of bars) {
    const start = Math.floor(b.t / bucketSecs) * bucketSecs;
    if (cur === null || start !== bucketStart) {
      if (cur) out.push(cur);
      bucketStart = start;
      cur = { t: start, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Build OHLCV candles from time-series price + volume points. */
function synthCandles(
  prices: [number, number][],
  vols: [number, number][],
  bucketSecs: number,
): CgCandle[] {
  if (!prices.length) return [];
  const buckets = new Map<number, CgCandle>();
  for (const [ms, p] of prices) {
    const t = Math.floor(ms / 1000 / bucketSecs) * bucketSecs;
    const b = buckets.get(t);
    if (!b) {
      buckets.set(t, { t, o: p, h: p, l: p, c: p, v: 0 });
    } else {
      b.h = Math.max(b.h, p);
      b.l = Math.min(b.l, p);
      b.c = p;
    }
  }
  for (const [ms, v] of vols) {
    const t = Math.floor(ms / 1000 / bucketSecs) * bucketSecs;
    const b = buckets.get(t);
    if (b) b.v += v;
  }
  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
}
