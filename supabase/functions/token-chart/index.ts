import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// DexScreener doesn't have a public OHLCV endpoint, but their pairs endpoint
// returns transactions + price history aggregated into m5/h1/h6/h24 buckets.
// For an actual line chart we synthesise minute candles from their /candles
// endpoint (undocumented but stable across the website).
//
// Endpoint shape: https://io.dexscreener.com/dex/chart/amm/<dex>/bars/<pairAddr>?from=...&to=...&res=5
// Where res ∈ {1,5,15,60,240,1440}.
//
// We resolve the most-liquid Solana pair for the input token first via the
// public token endpoint, then pull bars.

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

// GeckoTerminal OHLCV endpoint shape:
// /networks/solana/pools/{pool}/ohlcv/{timeframe}?aggregate={n}&limit={l}
// timeframe ∈ {minute, hour, day}, aggregate is the bucket multiplier.
const INTERVAL_GT: Record<Interval, { timeframe: "minute" | "hour" | "day"; aggregate: number }> = {
  "5m": { timeframe: "minute", aggregate: 5 },
  "15m": { timeframe: "minute", aggregate: 15 },
  "1h": { timeframe: "hour", aggregate: 1 },
  "4h": { timeframe: "hour", aggregate: 4 },
  "1d": { timeframe: "day", aggregate: 1 },
};

// How many bars we want per interval. Tuned for a tidy chart.
const INTERVAL_BARS: Record<Interval, number> = {
  "5m": 144,   // 12 hours
  "15m": 192,  // 2 days
  "1h": 168,   // 7 days
  "4h": 180,   // 30 days
  "1d": 180,   // 6 months
};

interface Candle {
  t: number;       // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;       // base volume in USD
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
    const knownMint = KNOWN_MINTS[upper];

    // 1. Resolve to a Solana pair via DexScreener.
    let dexResp: Response;
    if (looksLikeMint || knownMint) {
      const mint = knownMint ?? cleaned;
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
    const pairs = (dexJson.pairs ?? []).filter((p: any) => p.chainId === "solana");
    if (pairs.length === 0) return json({ error: `No Solana token found for "${cleaned}"` }, 404);

    pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const top = pairs[0];

    // 2. Pull OHLCV bars from GeckoTerminal — proper open/high/low/close,
    // not synthesised. Falls back to a smoothed line if the call fails.
    const { timeframe, aggregate } = INTERVAL_GT[interval];
    const wanted = INTERVAL_BARS[interval];

    let candles: Candle[] = [];
    try {
      const gtUrl =
        `https://api.geckoterminal.com/api/v2/networks/solana/pools/${top.pairAddress}` +
        `/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${wanted}&currency=usd`;
      const gtResp = await fetch(gtUrl, {
        headers: {
          Accept: "application/json;version=20230302",
          "User-Agent": "VisionBot/1.0",
        },
      });
      if (gtResp.ok) {
        const gtJson = await gtResp.json();
        const arr = gtJson?.data?.attributes?.ohlcv_list ?? [];
        // GeckoTerminal returns newest-first as [t, o, h, l, c, v]. Reverse for chart.
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

    // Last-resort fallback: synthesise a flat-ish trace from the priceChange
    // buckets so the UI can still render something useful.
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
