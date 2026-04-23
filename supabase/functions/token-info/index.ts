import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Common Solana tickers → mint address shortcut
// (DexScreener search works on tickers too, but this avoids ambiguity for the big ones)
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

    let dexResp: Response;

    // If it looks like a Solana mint (32-44 base58 chars), or matches a known ticker,
    // use the tokens endpoint (returns all pairs for that mint).
    const looksLikeMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleaned);
    const knownMint = KNOWN_MINTS[upper];

    if (looksLikeMint || knownMint) {
      const mint = knownMint ?? cleaned;
      dexResp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    } else {
      // Free-text search; we'll filter to Solana below.
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
      return json({ error: `No Solana token found for "${cleaned}"` }, 404);
    }

    // Pick the most liquid pair (best price source)
    solanaPairs.sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    );
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
