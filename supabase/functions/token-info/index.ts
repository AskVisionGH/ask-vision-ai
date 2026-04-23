import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchCgSnapshot, resolveCgCoin } from "../_shared/coingecko.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

interface TokenSnapshot {
  symbol: string;
  name: string;
  address: string;
  logo: string | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  priceChange1h: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  pairUrl: string | null;
  source?: "coingecko" | "solana-dex";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return json({ error: "query required (symbol or mint address)" }, 400);
    }

    const cleaned = query.trim().replace(/^\$/, "");
    const upper = cleaned.toUpperCase();
    const looksLikeMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleaned);
    const knownSolanaMint = KNOWN_MINTS[upper];

    // 1. Major-cap coins → CoinGecko (BTC, ETH, XRP, etc).
    if (!looksLikeMint && !knownSolanaMint) {
      const cg = await resolveCgCoin(cleaned);
      if (cg) {
        const snap = await fetchCgSnapshot(cg);
        if (snap) {
          const out: TokenSnapshot = {
            symbol: snap.symbol,
            name: snap.name,
            address: snap.id,
            logo: snap.logo,
            priceUsd: snap.priceUsd,
            priceChange24h: snap.priceChange24h,
            priceChange1h: snap.priceChange1h,
            marketCapUsd: snap.marketCapUsd,
            fdvUsd: snap.fdvUsd,
            volume24hUsd: snap.volume24hUsd,
            // CoinGecko doesn't expose pool liquidity for cross-exchange listings.
            liquidityUsd: null,
            pairUrl: `https://www.coingecko.com/en/coins/${snap.id}`,
            source: "coingecko",
          };
          return json(out);
        }
      }
    }

    // 2. Solana DEX path.
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
      console.error("DexScreener error:", dexResp.status);
      return json({ error: "Couldn't reach market data right now" }, 502);
    }

    const data = await dexResp.json();
    const allPairs = (data.pairs ?? []) as any[];
    const solanaPairs = allPairs.filter((p) => p.chainId === "solana");

    if (solanaPairs.length === 0) {
      return json({ error: `No token found for "${cleaned}"` }, 404);
    }

    solanaPairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const top = solanaPairs[0];

    const snapshot: TokenSnapshot = {
      symbol: top.baseToken?.symbol ?? "?",
      name: top.baseToken?.name ?? "Unknown",
      address: top.baseToken?.address ?? "",
      logo: top.info?.imageUrl ?? null,
      priceUsd: top.priceUsd ? Number(top.priceUsd) : null,
      priceChange24h: top.priceChange?.h24 ?? null,
      priceChange1h: top.priceChange?.h1 ?? null,
      marketCapUsd: top.marketCap ?? null,
      fdvUsd: top.fdv ?? null,
      volume24hUsd: top.volume?.h24 ?? null,
      liquidityUsd: top.liquidity?.usd ?? null,
      pairUrl: top.url ?? null,
      source: "solana-dex",
    };

    return json(snapshot);
  } catch (e) {
    console.error("token-info error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
