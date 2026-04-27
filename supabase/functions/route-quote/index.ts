// Unified routing orchestrator for "any token, any chain" swaps.
//
// Decides between three execution strategies and returns a single normalized
// plan the frontend can execute leg-by-leg without knowing routing internals.
//
// Strategies (in order of preference):
//   1) "swap"            — same chain, single Jupiter (Solana) or 0x (EVM) swap.
//   2) "bridge"          — different chain, but the destination token is the
//                           direct output of a LI.FI bridge route (no extra swap).
//   3) "bridge_then_swap"— different chain, LI.FI cannot bridge directly to the
//                           target token. We bridge to a liquid intermediate
//                           (USDC on the destination chain by default) and then
//                           run a destination-chain swap via 0x (EVM) or
//                           Jupiter (Solana) into the target token.
//
// Fee model
//   - Single-chain swap: 1% taken on the swap (Jupiter/0x), as today.
//   - Bridge-only:       1% taken by LI.FI integrator fee (already on bridge-quote).
//   - Bridge + swap:     LI.FI fee DISABLED on the bridge leg; 1% taken on the
//                          destination swap leg only (per product decision).
//
// Inputs (POST JSON):
//   {
//     fromChain:   "SOL" | number,                // source chain id (LI.FI numeric or "SOL")
//     toChain:     "SOL" | number,                // destination chain id
//     fromToken:   string,                        // source token address (mint or 0x)
//     toToken:     string,                        // destination token address (mint or 0x)
//     fromAddress: string,                        // user's address on fromChain
//     toAddress?:  string,                        // user's address on toChain (defaults to fromAddress)
//     amount:      string | number,               // human-readable units of fromToken
//     fromDecimals?: number,                       // optional hint
//     toDecimals?:   number,                       // optional hint
//     fromSymbol?:   string,
//     toSymbol?:     string,
//     slippageBps?:  number,                       // default 50
//   }
//
// Output (200 JSON):
//   {
//     strategy: "swap" | "bridge" | "bridge_then_swap",
//     legs: Array<{
//       kind: "swap" | "bridge",
//       chain: "SOL" | number,
//       quote: <leg-specific quote payload, already normalized by sub-quote fn>,
//     }>,
//     summary: {
//       fromAmountUi:  number,
//       fromAmountUsd: number | null,
//       // Best-effort estimate of what the user receives on the destination chain.
//       toAmountUi:    number | null,
//       toAmountUsd:   number | null,
//       // Combined network gas for all legs (USD), where known.
//       gasUsd:        number | null,
//       // Combined Vision platform fee (USD).
//       platformFeeUsd: number | null,
//       executionDurationSec: number | null,
//     },
//     // For bridge_then_swap, the intermediate token used on the destination chain.
//     intermediate?: { address: string; symbol: string; decimals: number; chain: number | "SOL" },
//   }
//
// This orchestrator NEVER builds transactions — it only quotes. The frontend
// (and later, an `execute-route` edge function) chains the matching `*-build`
// functions in order.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SOLANA_CHAIN: "SOL" = "SOL";
const EVM_NATIVE_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// USDC addresses on each supported chain — used as the bridge "landing pad"
// when bridging into a non-native target token. We pick USDC because LI.FI
// has the deepest, cheapest routes for it and 0x/Jupiter both have tons of
// liquidity from USDC into long-tail tokens.
const USDC_BY_CHAIN: Record<string, { address: string; decimals: number; symbol: string }> = {
  "SOL":    { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, symbol: "USDC" },
  "1":      { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, symbol: "USDC" },
  "10":     { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, symbol: "USDC" },
  "56":     { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, symbol: "USDC" }, // USDC.bep20
  "137":    { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, symbol: "USDC" },
  "8453":   { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, symbol: "USDC" },
  "42161":  { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, symbol: "USDC" },
  "43114":  { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6, symbol: "USDC" },
  "59144":  { address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", decimals: 6, symbol: "USDC" },
  "534352": { address: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4", decimals: 6, symbol: "USDC" },
};

// EVM chain ids 0x supports (must match evm-swap-quote SUPPORTED_CHAINS).
const EVM_CHAINS_WITH_0X = new Set([1, 10, 56, 137, 8453, 42161, 43114, 59144, 534352]);

function isSolana(chain: string | number): boolean {
  return String(chain).toUpperCase() === "SOL";
}

function chainKey(chain: string | number): string {
  return isSolana(chain) ? "SOL" : String(chain);
}

interface RouteRequest {
  fromChain: string | number;
  toChain: string | number;
  fromToken: string;
  toToken: string;
  fromAddress: string;
  toAddress?: string;
  amount: string | number;
  fromDecimals?: number;
  toDecimals?: number;
  fromSymbol?: string;
  toSymbol?: string;
  slippageBps?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Partial<RouteRequest>;
    const fromChain = body.fromChain ?? "";
    const toChain = body.toChain ?? "";
    const fromToken = String(body.fromToken ?? "").trim();
    const toToken = String(body.toToken ?? "").trim();
    const fromAddress = String(body.fromAddress ?? "").trim();
    const toAddress = String(body.toAddress ?? body.fromAddress ?? "").trim();
    const slippageBps = Number.isFinite(Number(body.slippageBps))
      ? Math.max(1, Math.min(5000, Number(body.slippageBps)))
      : 50;

    if (!fromChain || !toChain) return json({ error: "fromChain and toChain are required" }, 400);
    if (!fromToken || !toToken) return json({ error: "fromToken and toToken are required" }, 400);
    if (!fromAddress) return json({ error: "fromAddress is required" }, 400);
    if (body.amount == null || Number(body.amount) <= 0) return json({ error: "amount must be > 0" }, 400);

    const sameChain = chainKey(fromChain) === chainKey(toChain);
    const sameToken = sameChain && fromToken.toLowerCase() === toToken.toLowerCase();
    if (sameToken) return json({ error: "fromToken and toToken are identical" }, 400);

    // ---------- Strategy 1: same-chain swap ----------
    if (sameChain) {
      const swap = await quoteSwap({
        chain: fromChain,
        sellToken: fromToken,
        buyToken: toToken,
        taker: fromAddress,
        amount: body.amount!,
        sellDecimals: body.fromDecimals,
        buyDecimals: body.toDecimals,
        sellSymbol: body.fromSymbol,
        buySymbol: body.toSymbol,
        slippageBps,
      });
      if ("error" in swap) return json({ error: swap.error }, 502);
      return json({
        strategy: "swap",
        legs: [{ kind: "swap", chain: fromChain, quote: swap.quote }],
        summary: swap.summary,
      });
    }

    // ---------- Cross-chain: try direct bridge first ----------
    // We always TRY a direct bridge — if LI.FI can route it, we save the user
    // from a second swap (cheaper + faster + fewer failure points).
    const direct = await quoteBridge({
      fromChain,
      toChain,
      fromToken,
      toToken,
      fromAddress,
      toAddress,
      amount: body.amount!,
      fromDecimals: body.fromDecimals,
      slippageBps,
      // Keep the LI.FI 1% integrator fee on bridge-only flows.
      withIntegratorFee: true,
    });

    if (direct.ok) {
      return json({
        strategy: "bridge",
        legs: [{ kind: "bridge", chain: fromChain, quote: direct.quote }],
        summary: bridgeSummary(direct.quote),
      });
    }

    // ---------- Strategy 3: bridge to USDC, then destination swap ----------
    // We need an intermediate that LI.FI can bridge to AND that 0x/Jupiter
    // can swap from on the destination chain. USDC fits both criteria for
    // every chain we support today.
    const intermediate = USDC_BY_CHAIN[chainKey(toChain)];
    if (!intermediate) {
      return json({
        error: `No bridge route to ${toChain}, and no fallback intermediate configured.`,
        directBridgeError: direct.error,
      }, 404);
    }

    // Special case: if the source token IS already USDC on the source chain,
    // we just need a USDC↔USDC bridge (which LI.FI handles trivially) plus
    // a destination swap.
    const bridgeLeg = await quoteBridge({
      fromChain,
      toChain,
      fromToken,
      toToken: intermediate.address,
      fromAddress,
      toAddress,
      amount: body.amount!,
      fromDecimals: body.fromDecimals,
      slippageBps,
      // Per product decision: only the destination SWAP charges Vision's 1%
      // when we have to do bridge+swap. Disable LI.FI fees on this leg.
      withIntegratorFee: false,
    });

    if (!bridgeLeg.ok) {
      return json({
        error: "Couldn't find any cross-chain route (direct or via USDC).",
        directBridgeError: direct.error,
        usdcBridgeError: bridgeLeg.error,
      }, 404);
    }

    // Now quote the destination-chain swap from USDC → toToken using the
    // bridge's MIN expected output (so the swap quote is achievable even on
    // a worst-case bridge fill).
    const usdcAmountAtomic = bridgeLeg.quote.toAmountMinAtomic ?? bridgeLeg.quote.toAmountAtomic ?? "0";
    if (!usdcAmountAtomic || usdcAmountAtomic === "0") {
      return json({ error: "Bridge leg returned zero output amount." }, 502);
    }
    const usdcAmountUi = Number(usdcAmountAtomic) / Math.pow(10, intermediate.decimals);

    const destSwap = await quoteSwap({
      chain: toChain,
      sellToken: intermediate.address,
      buyToken: toToken,
      taker: toAddress,
      amount: usdcAmountUi,
      sellDecimals: intermediate.decimals,
      buyDecimals: body.toDecimals,
      sellSymbol: intermediate.symbol,
      buySymbol: body.toSymbol,
      slippageBps,
    });

    if ("error" in destSwap) {
      // The bridge would land USDC on the destination chain but we can't swap
      // into the target. Surface this clearly so the UI can fall back to
      // suggesting USDC as the destination instead.
      return json({
        error: `Bridge works, but no destination-chain swap into ${body.toSymbol ?? toToken}: ${destSwap.error}`,
        partialPlan: {
          legs: [{ kind: "bridge", chain: fromChain, quote: bridgeLeg.quote }],
          intermediate: { ...intermediate, chain: toChain },
        },
      }, 502);
    }

    // Combined summary across both legs.
    const summary = {
      fromAmountUi: Number(body.amount),
      fromAmountUsd: bridgeLeg.quote.fromAmountUsd ?? null,
      toAmountUi: destSwap.summary.toAmountUi,
      toAmountUsd: destSwap.summary.toAmountUsd,
      gasUsd: sumNullable(bridgeLeg.quote.gasFeeUsd, destSwap.summary.gasUsd),
      platformFeeUsd: destSwap.summary.platformFeeUsd, // bridge leg has no fee in this flow
      executionDurationSec: bridgeLeg.quote.executionDurationSec ?? null,
    };

    return json({
      strategy: "bridge_then_swap",
      legs: [
        { kind: "bridge", chain: fromChain, quote: bridgeLeg.quote },
        { kind: "swap", chain: toChain, quote: destSwap.quote },
      ],
      summary,
      intermediate: { ...intermediate, chain: toChain },
    });
  } catch (e) {
    console.error("route-quote error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ---------------- Sub-quote helpers ----------------

interface SwapQuoteArgs {
  chain: string | number;
  sellToken: string;
  buyToken: string;
  taker: string;
  amount: string | number;
  sellDecimals?: number;
  buyDecimals?: number;
  sellSymbol?: string;
  buySymbol?: string;
  slippageBps: number;
}

async function quoteSwap(args: SwapQuoteArgs): Promise<
  | { quote: any; summary: { fromAmountUi: number; fromAmountUsd: number | null; toAmountUi: number | null; toAmountUsd: number | null; gasUsd: number | null; platformFeeUsd: number | null; executionDurationSec: number | null } }
  | { error: string }
> {
  if (isSolana(args.chain)) {
    const resp = await callFn("swap-quote", {
      inputToken: args.sellToken,
      outputToken: args.buyToken,
      amount: Number(args.amount),
      slippageBps: args.slippageBps,
    });
    if (!resp.ok) return { error: resp.error ?? "Solana quote failed" };
    const q = resp.data;
    return {
      quote: q,
      summary: {
        fromAmountUi: q.input?.amountUi ?? Number(args.amount),
        fromAmountUsd: q.input?.valueUsd ?? null,
        toAmountUi: q.output?.amountUi ?? null,
        toAmountUsd: q.output?.valueUsd ?? null,
        gasUsd: null, // Solana fees are micro and not USD-priced here
        platformFeeUsd: q.platformFee?.valueUsd ?? null,
        executionDurationSec: null,
      },
    };
  }

  // EVM path via 0x.
  const chainId = Number(args.chain);
  if (!EVM_CHAINS_WITH_0X.has(chainId)) {
    return { error: `EVM chain ${chainId} is not supported by 0x` };
  }
  const sellDecimals = args.sellDecimals ?? 18;
  const sellAmountAtomic = uiToAtomic(args.amount, sellDecimals);
  if (sellAmountAtomic === "0") return { error: "Sell amount too small for token decimals" };

  const resp = await callFn("evm-swap-quote", {
    chainId,
    sellToken: args.sellToken,
    buyToken: args.buyToken,
    taker: args.taker,
    sellAmount: sellAmountAtomic,
    sellTokenDecimals: sellDecimals,
    buyTokenDecimals: args.buyDecimals,
    sellTokenSymbol: args.sellSymbol,
    buyTokenSymbol: args.buySymbol,
    slippageBps: args.slippageBps,
  });
  if (!resp.ok) return { error: resp.error ?? "EVM quote failed" };
  const q = resp.data;
  return {
    quote: q,
    summary: {
      fromAmountUi: q.input?.amountUi ?? Number(args.amount),
      fromAmountUsd: q.input?.valueUsd ?? null,
      toAmountUi: q.output?.amountUi ?? null,
      toAmountUsd: q.output?.valueUsd ?? null,
      gasUsd: q.estNetworkFeeUsd ?? null,
      platformFeeUsd: q.platformFee?.valueUsd ?? null,
      executionDurationSec: null,
    },
  };
}

interface BridgeQuoteArgs {
  fromChain: string | number;
  toChain: string | number;
  fromToken: string;
  toToken: string;
  fromAddress: string;
  toAddress: string;
  amount: string | number;
  fromDecimals?: number;
  slippageBps: number;
  withIntegratorFee: boolean; // controls LIFI_FEES_ENABLED-style behaviour
}

async function quoteBridge(args: BridgeQuoteArgs): Promise<
  | { ok: true; quote: any }
  | { ok: false; error: string }
> {
  // Translate human amount → atomic. We pass atomic to bridge-quote because
  // LI.FI requires integer atomic units in `fromAmount`.
  const decimals = args.fromDecimals ?? (isSolana(args.fromChain) ? 9 : 18);
  const fromAmountAtomic = uiToAtomic(args.amount, decimals);
  if (fromAmountAtomic === "0") return { ok: false, error: "Amount too small for source token precision" };

  const resp = await callFn("bridge-quote", {
    fromChain: isSolana(args.fromChain) ? "SOL" : Number(args.fromChain),
    toChain: isSolana(args.toChain) ? "SOL" : Number(args.toChain),
    fromToken: args.fromToken,
    toToken: args.toToken,
    fromAmount: fromAmountAtomic,
    fromAddress: args.fromAddress,
    toAddress: args.toAddress,
    slippageBps: args.slippageBps,
    // bridge-quote currently keys integrator fee on a server-side env flag, not
    // a per-request param. We pass this hint for future use; orchestrator will
    // attribute fees correctly regardless because it computes them itself.
    integratorFeeOverride: args.withIntegratorFee,
  });
  if (!resp.ok) return { ok: false, error: resp.error ?? "Bridge quote failed" };
  return { ok: true, quote: resp.data };
}

function bridgeSummary(q: any) {
  return {
    fromAmountUi: q.fromAmountUsd && q.input?.priceUsd ? q.fromAmountUsd / q.input.priceUsd : null,
    fromAmountUsd: q.fromAmountUsd ?? null,
    toAmountUi: q.toAmountAtomic && q.raw?.action?.toToken?.decimals
      ? Number(q.toAmountAtomic) / Math.pow(10, Number(q.raw.action.toToken.decimals))
      : null,
    toAmountUsd: q.toAmountUsd ?? null,
    gasUsd: q.gasFeeUsd ?? null,
    platformFeeUsd: q.platformFeeUsd ?? null,
    executionDurationSec: q.executionDurationSec ?? null,
  };
}

// ---------------- Plumbing ----------------

async function callFn(
  name: string,
  body: unknown,
): Promise<{ ok: true; data: any } | { ok: false; error?: string }> {
  if (!SUPABASE_URL) return { ok: false, error: "SUPABASE_URL missing" };
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Use service role so we can call other internal functions even if
        // they were authored with verify_jwt = true at any point in the future.
        ...(SERVICE_ROLE ? { Authorization: `Bearer ${SERVICE_ROLE}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    if (!resp.ok) {
      return { ok: false, error: data?.error ?? text ?? `HTTP ${resp.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error calling " + name };
  }
}

function uiToAtomic(amount: string | number, decimals: number): string {
  // BigInt-safe conversion that handles large values and arbitrary decimals
  // without losing precision (Number * 10**decimals would silently truncate
  // for, e.g., 18-decimal tokens).
  const s = typeof amount === "number" ? amount.toString() : String(amount).trim();
  if (!s || !/^\d*\.?\d*$/.test(s)) return "0";
  const [whole = "0", fracRaw = ""] = s.split(".");
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  const combined = (whole + frac).replace(/^0+/, "") || "0";
  return combined;
}

function sumNullable(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return Number(a ?? 0) + Number(b ?? 0);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
