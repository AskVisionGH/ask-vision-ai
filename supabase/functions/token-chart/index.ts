import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchCgCandles, resolveCgCoin } from "../_shared/coingecko.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Solana-native tickers we always want to chart from DexScreener/GeckoTerminal
// (proper intraday candles from the most-liquid Solana pool). Anything outside
// this list AND in CoinGecko's top-250 (or our priority list of blue chips)
// goes through CoinGecko for proper aggregated cross-exchange pricing.
const KNOWN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  WSOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  ORCA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
};

type Interval = "5m" | "15m" | "1h" | "4h" | "1d";

const INTERVAL_GT: Record<Interval, { timeframe: "minute" | "hour" | "day"; aggregate: number }> = {
  "5m": { timeframe: "minute", aggregate: 5 },
  "15m": { timeframe: "minute", aggregate: 15 },
  "1h": { timeframe: "hour", aggregate: 1 },
  "4h": { timeframe: "hour", aggregate: 4 },
  "1d": { timeframe: "day", aggregate: 1 },
};

const INTERVAL_BARS: Record<Interval, number> = {
  "5m": 144, "15m": 192, "1h": 168, "4h": 180, "1d": 180,
};

interface Candle {
  t: number; o: number; h: number; l: number; c: number; v: number;
}

interface ChartResponse {
  symbol: string;
  name: string;
  address: string;
  logo: string | null;
  pairAddress: string;
  pairUrl: string | null;
  interval: Interval;
  candles: Candle[];
  priceUsd: number | null;
  priceChangePct: number | null;
  high: number | null;
  low: number | null;
  /** "coingecko" for major caps, "solana-dex" for SPL tokens. */
  source?: "coingecko" | "solana-dex";
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const queryRaw = typeof body.query === "string" ? body.query : "";
    const intervalRaw = typeof body.interval === "string" ? body.interval : "15m";
    const interval: Interval = (["5m", "15m", "1h", "4h", "1d"] as Interval[]).includes(
      intervalRaw as Interval,
    )
      ? (intervalRaw as Interval)
      : "15m";

    if (!queryRaw) return json({ error: "query required" }, 400);

    const cleaned = queryRaw.trim().replace(/^\$/, "");
    const upper = cleaned.toUpperCase();
    const looksLikeMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleaned);
    const knownSolanaMint = KNOWN_MINTS[upper];

    // 1. Try CoinGecko first for major-cap coins. Skip when the query is
    // clearly a Solana mint or an explicitly Solana-native ticker.
    if (!looksLikeMint && !knownSolanaMint) {
      const cg = await resolveCgCoin(cleaned);
      if (cg) {
        const candles = await fetchCgCandles(cg, interval);
        if (candles.length > 0) {
          const first = candles[0]?.c ?? null;
          const last = candles[candles.length - 1]?.c ?? null;
          const priceChangePct =
            first && last && first !== 0 ? ((last - first) / first) * 100 : null;
          const high = Math.max(...candles.map((c) => c.h));
          const low = Math.min(...candles.map((c) => c.l));

          const out: ChartResponse = {
            symbol: cg.symbol.toUpperCase(),
            name: cg.name,
            address: cg.id,
            logo: `https://assets.coingecko.com/coins/images/_/large/${cg.id}.png`,
            pairAddress: "",
            pairUrl: `https://www.coingecko.com/en/coins/${cg.id}`,
            interval,
            candles,
            priceUsd: last,
            priceChangePct,
            high,
            low,
            source: "coingecko",
          };
          return json(out);
        }
      }
    }

    // 2. Solana DEX path (DexScreener + GeckoTerminal).
    let dexResp: Response;
    if (looksLikeMint || knownSolanaMint) {
      const mint = knownSolanaMint ?? cleaned;
      dexResp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    } else {
      dexResp = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(cleaned)}`,
      );
    }

    if (!dexResp.ok) {
      return json({ error: "Couldn't reach market data" }, 502);
    }

    const dexJson = await dexResp.json();
    let pairs = (dexJson.pairs ?? []).filter((p: any) => p.chainId === "solana");

    if (looksLikeMint || knownSolanaMint) {
      const expected = (knownSolanaMint ?? cleaned).toLowerCase();
      pairs = pairs.filter((p: any) => String(p.baseToken?.address ?? "").toLowerCase() === expected);
    }

    if (pairs.length === 0) return json({ error: `No token found for "${cleaned}"` }, 404);

    pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const top = pairs[0];

    const { timeframe, aggregate } = INTERVAL_GT[interval];
    const wanted = INTERVAL_BARS[interval];

    let candles: Candle[] = [];
    try {
      const gtUrl =
        `https://api.geckoterminal.com/api/v2/networks/solana/pools/${top.pairAddress}` +
        `/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${wanted}&currency=usd`;
      const gtResp = await fetch(gtUrl, {
        headers: { Accept: "application/json;version=20230302", "User-Agent": "VisionBot/1.0" },
      });
      if (gtResp.ok) {
        const gtJson = await gtResp.json();
        const arr = gtJson?.data?.attributes?.ohlcv_list ?? [];
        candles = arr
          .map((row: number[]) => ({
            t: Number(row[0]),
            o: Number(row[1]),
            h: Number(row[2]),
            l: Number(row[3]),
            c: Number(row[4]),
            v: Number(row[5] ?? 0),
          }))
          .filter((c: Candle) => c.t > 0 && c.c > 0)
          .sort((a: Candle, b: Candle) => a.t - b.t);
      } else {
        console.error("GeckoTerminal returned non-OK:", gtResp.status, await gtResp.text());
      }
    } catch (e) {
      console.error("GeckoTerminal fetch failed:", e);
    }

    const now = Math.floor(Date.now() / 1000);
    if (candles.length === 0) {
      const price = top.priceUsd ? Number(top.priceUsd) : 0;
      const chgPct = top.priceChange?.h24 ?? 0;
      const start = price / (1 + chgPct / 100);
      const points = 24;
      const stepSecs = (24 * 60 * 60) / points;
      candles = Array.from({ length: points }, (_, i) => {
        const t = now - (points - 1 - i) * stepSecs;
        const p = start + ((price - start) * i) / (points - 1);
        return { t, o: p, h: p, l: p, c: p, v: 0 };
      });
    }

    const first = candles[0]?.c ?? null;
    const last = candles[candles.length - 1]?.c ?? null;
    const priceChangePct = first && last ? ((last - first) / first) * 100 : null;
    const high = candles.length ? Math.max(...candles.map((c) => c.h)) : null;
    const low = candles.length ? Math.min(...candles.map((c) => c.l)) : null;

    const out: ChartResponse = {
      symbol: top.baseToken?.symbol ?? "?",
      name: top.baseToken?.name ?? "Unknown",
      address: top.baseToken?.address ?? "",
      logo: top.info?.imageUrl ?? null,
      pairAddress: top.pairAddress ?? "",
      pairUrl: top.url ?? null,
      interval,
      candles,
      priceUsd: top.priceUsd ? Number(top.priceUsd) : last,
      priceChangePct,
      high,
      low,
      source: "solana-dex",
    };

    return json(out);
  } catch (e) {
    console.error("token-chart error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
