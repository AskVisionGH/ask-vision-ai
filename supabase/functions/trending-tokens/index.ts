import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Stable / wrapped tokens we want to filter out of "trending"
const BORING_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // jitoSOL
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // wETH
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", // wBTC
]);

interface TrendingToken {
  symbol: string;
  name: string;
  address: string;
  logo: string | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  pairUrl: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // DexScreener "token-boosts/top" returns currently boosted/promoted tokens.
    // We then enrich each with full pair data and rank by 24h volume.
    const boostsResp = await fetch("https://api.dexscreener.com/token-boosts/top/v1");
    if (!boostsResp.ok) {
      console.error("Boosts error:", boostsResp.status);
      return json({ error: "Couldn't reach trending data right now" }, 502);
    }
    const boosts = (await boostsResp.json()) as any[];
    const solanaBoosts = boosts.filter((b) => b.chainId === "solana").slice(0, 25);

    if (solanaBoosts.length === 0) {
      return json({ tokens: [] });
    }

    // Batch enrich (DexScreener tokens endpoint accepts up to 30 comma-separated mints)
    const mints = solanaBoosts.map((b) => b.tokenAddress).join(",");
    const enrichResp = await fetch(
      `https://api.dexscreener.com/tokens/v1/solana/${mints}`,
    );

    let pairs: any[] = [];
    if (enrichResp.ok) {
      pairs = (await enrichResp.json()) as any[];
    }

    // Group pairs by base token, pick most liquid pair per token
    const byToken = new Map<string, any>();
    for (const p of pairs) {
      const addr = p.baseToken?.address;
      if (!addr || BORING_MINTS.has(addr)) continue;
      const existing = byToken.get(addr);
      if (!existing || (p.liquidity?.usd ?? 0) > (existing.liquidity?.usd ?? 0)) {
        byToken.set(addr, p);
      }
    }

    const tokens: TrendingToken[] = [...byToken.values()]
      .filter((p) => (p.volume?.h24 ?? 0) > 1000) // ignore dead pairs
      .map((p) => ({
        symbol: p.baseToken?.symbol ?? "?",
        name: p.baseToken?.name ?? "Unknown",
        address: p.baseToken?.address ?? "",
        logo: p.info?.imageUrl ?? null,
        priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
        priceChange24h: p.priceChange?.h24 ?? null,
        volume24hUsd: p.volume?.h24 ?? null,
        liquidityUsd: p.liquidity?.usd ?? null,
        marketCapUsd: p.marketCap ?? null,
        pairUrl: p.url ?? null,
      }))
      .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
      .slice(0, 10);

    return json({ tokens });
  } catch (e) {
    console.error("trending-tokens error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
