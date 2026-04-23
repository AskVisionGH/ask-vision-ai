import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Common Solana tickers → mint shortcut
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

interface TokenMeta {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
}

const isMint = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

async function resolveToken(input: string): Promise<TokenMeta | null> {
  const cleaned = input.trim().replace(/^\$/, "");
  const upper = cleaned.toUpperCase();
  const mint = KNOWN_MINTS[upper] ?? (isMint(cleaned) ? cleaned : null);

  if (mint) {
    return await fetchMeta(mint);
  }

  // Free-text search via DexScreener; pick most liquid Solana base token
  const resp = await fetch(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(cleaned)}`,
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const pairs = ((data.pairs ?? []) as any[]).filter((p) => p.chainId === "solana");
  if (pairs.length === 0) return null;
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const top = pairs[0];
  const addr = top.baseToken?.address;
  if (!addr) return null;
  return await fetchMeta(addr, top);
}

async function fetchMeta(mint: string, dexPair?: any): Promise<TokenMeta | null> {
  // Get decimals from Jupiter token list (single-token endpoint)
  let decimals = 9;
  let symbol = "?";
  let name = "Unknown";
  let logo: string | null = null;

  try {
    const jupResp = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
    if (jupResp.ok) {
      const arr = await jupResp.json();
      const tok = Array.isArray(arr) ? arr.find((t: any) => t.id === mint) ?? arr[0] : null;
      if (tok) {
        decimals = tok.decimals ?? 9;
        symbol = tok.symbol ?? symbol;
        name = tok.name ?? name;
        logo = tok.icon ?? null;
      }
    }
  } catch (_) { /* ignore */ }

  // Enrich with DexScreener for price + logo fallback
  let priceUsd: number | null = null;
  try {
    const pair = dexPair ?? await (async () => {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      if (!r.ok) return null;
      const d = await r.json();
      const ps = ((d.pairs ?? []) as any[]).filter((p) => p.chainId === "solana");
      ps.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      return ps[0] ?? null;
    })();
    if (pair) {
      priceUsd = pair.priceUsd ? Number(pair.priceUsd) : null;
      if (!logo) logo = pair.info?.imageUrl ?? null;
      if (symbol === "?") symbol = pair.baseToken?.symbol ?? symbol;
      if (name === "Unknown") name = pair.baseToken?.name ?? name;
    }
  } catch (_) { /* ignore */ }

  return { symbol, name, address: mint, decimals, logo, priceUsd };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const inputToken: string = body.inputToken ?? body.inputMint ?? "";
    const outputToken: string = body.outputToken ?? body.outputMint ?? "";
    const amount = Number(body.amount);
    const slippageBps = Number.isFinite(Number(body.slippageBps))
      ? Math.max(1, Math.min(5000, Number(body.slippageBps)))
      : 50;

    if (!inputToken || !outputToken) {
      return json({ error: "inputToken and outputToken required" }, 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ error: "amount must be a positive number" }, 400);
    }

    const [inMeta, outMeta] = await Promise.all([
      resolveToken(inputToken),
      resolveToken(outputToken),
    ]);

    if (!inMeta) return json({ error: `Couldn't find token "${inputToken}"` }, 404);
    if (!outMeta) return json({ error: `Couldn't find token "${outputToken}"` }, 404);
    if (inMeta.address === outMeta.address) {
      return json({ error: "Input and output tokens are the same" }, 400);
    }

    // Convert UI amount → atomic
    const atomicIn = Math.floor(amount * Math.pow(10, inMeta.decimals));
    if (atomicIn <= 0) {
      return json({ error: "Amount too small for this token's precision" }, 400);
    }

    const quoteUrl = new URL("https://lite-api.jup.ag/swap/v1/quote");
    quoteUrl.searchParams.set("inputMint", inMeta.address);
    quoteUrl.searchParams.set("outputMint", outMeta.address);
    quoteUrl.searchParams.set("amount", String(atomicIn));
    quoteUrl.searchParams.set("slippageBps", String(slippageBps));
    quoteUrl.searchParams.set("restrictIntermediateTokens", "true");

    const qResp = await fetch(quoteUrl.toString());
    if (!qResp.ok) {
      const t = await qResp.text();
      console.error("Jupiter quote error:", qResp.status, t);
      return json({ error: "No route found for that swap" }, 502);
    }
    const quote = await qResp.json();

    const atomicOut = Number(quote.outAmount ?? 0);
    const outUi = atomicOut / Math.pow(10, outMeta.decimals);
    const inUi = atomicIn / Math.pow(10, inMeta.decimals);

    const inValueUsd = inMeta.priceUsd != null ? inUi * inMeta.priceUsd : null;
    const outValueUsd = outMeta.priceUsd != null ? outUi * outMeta.priceUsd : null;

    const priceImpactPct = quote.priceImpactPct != null
      ? Number(quote.priceImpactPct) * 100
      : null;

    // Route hops with AMM names
    const route = (quote.routePlan ?? []).map((step: any) => ({
      ammKey: step.swapInfo?.ammKey ?? null,
      label: step.swapInfo?.label ?? "Unknown",
      inputMint: step.swapInfo?.inputMint ?? null,
      outputMint: step.swapInfo?.outputMint ?? null,
    }));

    return json({
      input: { ...inMeta, amountUi: inUi, amountAtomic: atomicIn, valueUsd: inValueUsd },
      output: { ...outMeta, amountUi: outUi, amountAtomic: atomicOut, valueUsd: outValueUsd },
      rate: outUi / inUi,
      priceImpactPct,
      slippageBps,
      route,
      // Typical Solana network fee for a swap (rough estimate, in SOL)
      estNetworkFeeSol: 0.000075,
      quotedAt: Date.now(),
    });
  } catch (e) {
    console.error("swap-quote error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
