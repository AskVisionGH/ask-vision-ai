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
  isToken2022?: boolean;
}

const isMint = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

async function resolveToken(input: string): Promise<TokenMeta | null> {
  const cleaned = input.trim().replace(/^\$/, "");
  const upper = cleaned.toUpperCase();
  const mint = KNOWN_MINTS[upper] ?? (isMint(cleaned) ? cleaned : null);

  if (mint) {
    return await fetchMeta(mint);
  }

  // Ticker search — Jupiter v2 has the broadest Solana coverage (incl.
  // memecoins like BOME) and exposes liquidity/volume + an `isVerified`
  // flag we can rank by. Same approach as the /trade Token Picker.
  try {
    const jupResp = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(cleaned)}`,
    );
    if (jupResp.ok) {
      const arr = await jupResp.json();
      const list = Array.isArray(arr) ? arr : [];
      // Prefer exact symbol match first, then verified, then liquidity/volume.
      const scored = list
        .filter((t: any) => t && t.id)
        .map((t: any) => {
          const sym = String(t.symbol ?? "").toUpperCase();
          const exact = sym === upper ? 1 : 0;
          const verified = t.isVerified || t.tags?.includes?.("verified") ? 1 : 0;
          const liq = Number(t.liquidity ?? 0);
          const vol = Number(t.stats24h?.buyVolume ?? 0) + Number(t.stats24h?.sellVolume ?? 0);
          const mc = Number(t.mcap ?? t.fdv ?? 0);
          return { t, exact, verified, score: liq * 2 + vol + mc * 0.1 };
        })
        .sort((a, b) => {
          if (b.exact !== a.exact) return b.exact - a.exact;
          if (b.verified !== a.verified) return b.verified - a.verified;
          return b.score - a.score;
        });
      const top = scored[0]?.t;
      if (top?.id) return await fetchMeta(top.id);
    }
  } catch (_) { /* fall through to DexScreener */ }

  // DexScreener fallback for anything Jupiter doesn't index.
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

// Stablecoins (USDC, USDT, plus a couple of common Solana variants).
// DexScreener's `priceUsd` field on a stable's most-liquid pair is sometimes
// the price of the QUOTE token, not USD — pinning these to $1 prevents the
// swap card from showing nonsense like "858 USDC ≈ $2,548".
const STABLE_MINTS = new Set<string>([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX", // USDH
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", // USDS
]);

async function fetchMeta(mint: string, dexPair?: any): Promise<TokenMeta | null> {
  let decimals = 9;
  let symbol = "?";
  let name = "Unknown";
  let logo: string | null = null;
  let priceUsd: number | null = null;
  const isToken2022 = await detectToken2022Mint(mint);

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
        if (tok.usdPrice != null && Number.isFinite(Number(tok.usdPrice))) {
          priceUsd = Number(tok.usdPrice);
        }
      }
    }
  } catch (_) { /* ignore */ }

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
      if (priceUsd == null && pair.priceUsd && pair.baseToken?.address === mint) {
        priceUsd = Number(pair.priceUsd);
      }
      if (!logo) logo = pair.info?.imageUrl ?? null;
      if (symbol === "?") symbol = pair.baseToken?.symbol ?? symbol;
      if (name === "Unknown") name = pair.baseToken?.name ?? name;
    }
  } catch (_) { /* ignore */ }

  if (STABLE_MINTS.has(mint)) priceUsd = 1;

  return { symbol, name, address: mint, decimals, logo, priceUsd, isToken2022 };
}

async function detectToken2022Mint(mint: string): Promise<boolean> {
  const heliusKey = Deno.env.get("HELIUS_API_KEY");
  const rpcUrl = heliusKey
    ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
    : "https://api.mainnet-beta.solana.com";
  try {
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mint-owner",
        method: "getAccountInfo",
        params: [mint, { encoding: "jsonParsed", commitment: "confirmed" }],
      }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data?.result?.value?.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const inputToken: string = body.inputToken ?? body.inputMint ?? "";
    const outputToken: string = body.outputToken ?? body.outputMint ?? "";
    const amount = Number(body.amount);
    // When dynamic slippage is on (default), we let Jupiter pick the
    // optimal per-route tolerance at swap-build time. We still pass a
    // generous ceiling here so the quote itself doesn't get rejected on
    // volatile routes.
    const dynamicSlippage = body.dynamicSlippage !== false;
    const userSlippageBps = Number.isFinite(Number(body.slippageBps))
      ? Math.max(1, Math.min(5000, Number(body.slippageBps)))
      : 50;
    const dynamicSlippageCeilingBps = 1500;
    const slippageBps = dynamicSlippage
      ? Math.max(userSlippageBps, dynamicSlippageCeilingBps)
      : userSlippageBps;

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

    // Platform fee — use Jupiter's output-fee path for normal SPL outputs,
    // but fall back to an upfront input-token fee for Token-2022 outputs,
    // since some routes fail on-chain when the output mint carries the fee.
    const PLATFORM_FEE_BPS = 100; // 1%
    const referralAccount = Deno.env.get("JUPITER_REFERRAL_ACCOUNT") ?? "";
    const collectPlatformFeeUpfront = Boolean(referralAccount) && outMeta.isToken2022 === true;
    if (referralAccount && !collectPlatformFeeUpfront) {
      quoteUrl.searchParams.set("platformFeeBps", String(PLATFORM_FEE_BPS));
    }

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

    const route = (quote.routePlan ?? []).map((step: any) => ({
      ammKey: step.swapInfo?.ammKey ?? null,
      label: step.swapInfo?.label ?? "Unknown",
      inputMint: step.swapInfo?.inputMint ?? null,
      outputMint: step.swapInfo?.outputMint ?? null,
    }));

    const platformFeeBps = referralAccount ? PLATFORM_FEE_BPS : 0;
    const platformFeeUi = collectPlatformFeeUpfront
      ? inUi * (platformFeeBps / 10_000)
      : quote.platformFee?.amount
        ? Number(quote.platformFee.amount) / Math.pow(10, outMeta.decimals)
        : (platformFeeBps > 0 ? outUi * (platformFeeBps / 10_000) : 0);
    const platformFeeUsd = collectPlatformFeeUpfront
      ? (inMeta.priceUsd != null ? platformFeeUi * inMeta.priceUsd : null)
      : (outMeta.priceUsd != null ? platformFeeUi * outMeta.priceUsd : null);

    return json({
      input: { ...inMeta, amountUi: inUi, amountAtomic: atomicIn, valueUsd: inValueUsd },
      output: { ...outMeta, amountUi: outUi, amountAtomic: atomicOut, valueUsd: outValueUsd },
      rate: outUi / inUi,
      priceImpactPct,
      slippageBps,
      dynamicSlippage,
      route,
      estNetworkFeeSol: 0.000075,
      platformFee: {
        bps: platformFeeBps,
        amountUi: platformFeeUi,
        symbol: collectPlatformFeeUpfront ? inMeta.symbol : outMeta.symbol,
        valueUsd: platformFeeUsd,
        collectUpfront: collectPlatformFeeUpfront,
      },
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
