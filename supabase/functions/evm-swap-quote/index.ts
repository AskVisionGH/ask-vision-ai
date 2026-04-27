// Single-chain EVM swap quote via 0x Swap API v2 (Allowance Holder).
//
// Mirrors the contract of `swap-quote` so the unified router and the
// frontend can treat both quotes uniformly: same Vision 1% fee model
// (taken from the OUTPUT token, identical to Jupiter), same shape for
// `input` / `output` / `route` / `platformFee`.
//
// Why Allowance Holder and not Permit2?
//   AH is a single contract that holds approvals — works for ANY EOA/SCW
//   without per-app permit signatures. Permit2 needs a separate signed
//   typed-data step before the swap, which is fine for browser wallets
//   but adds friction for our Vision Wallet (Privy server-wallet) flow.
//
// Why fee in OUTPUT token?
//   - Matches Jupiter/swap-quote behaviour (Vision charges in the buy-side asset).
//   - Avoids needing the user to hold extra of the input token to cover fee.
//
// Why we ALSO set tradeSurplusRecipient?
//   0x's settler can produce positive slippage (better fill than quoted).
//   By default that surplus goes to the taker; we route it to the same
//   treasury so it shows up alongside the explicit fee in our admin
//   accounting.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ZEROEX_BASE = "https://api.0x.org";
const PLATFORM_FEE_BPS = 100; // 1% — matches Jupiter swap-quote
const EVM_NATIVE_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// Chains we currently expose. Aligned with our wagmi/EvmWalletProvider list.
// Keys MUST match 0x's chainId support (https://0x.org/docs/introduction/0x-cheat-sheet).
const SUPPORTED_CHAINS: Record<number, { symbol: string; decimals: number; name: string }> = {
  1: { symbol: "ETH", decimals: 18, name: "Ethereum" },
  10: { symbol: "ETH", decimals: 18, name: "Optimism" },
  56: { symbol: "BNB", decimals: 18, name: "BNB Chain" },
  137: { symbol: "MATIC", decimals: 18, name: "Polygon" },
  8453: { symbol: "ETH", decimals: 18, name: "Base" },
  42161: { symbol: "ETH", decimals: 18, name: "Arbitrum" },
  43114: { symbol: "AVAX", decimals: 18, name: "Avalanche" },
  59144: { symbol: "ETH", decimals: 18, name: "Linea" },
  534352: { symbol: "ETH", decimals: 18, name: "Scroll" },
};

// EVM treasury — matches treasury-fees-sync's ETH_TREASURY so the existing
// reconciliation job picks up 0x fees with no schema changes.
const EVM_TREASURY = "0xd62427353491907D6A0606DC8be4a8Be05bBaF58";

interface QuoteRequest {
  chainId: number;
  sellToken: string;     // ERC-20 address or EVM_NATIVE_PLACEHOLDER for native
  buyToken: string;      // ERC-20 address or EVM_NATIVE_PLACEHOLDER for native
  taker: string;         // wallet address that will sign+send
  sellAmount: string;    // atomic units, decimal string (BigInt-safe)
  slippageBps?: number;  // default 50
  buyTokenDecimals?: number; // hint for fee math; if missing we still proceed
  sellTokenDecimals?: number;
  buyTokenSymbol?: string;
  sellTokenSymbol?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ZEROEX_API_KEY");
    if (!apiKey) {
      return json({ error: "ZEROEX_API_KEY not configured" }, 500);
    }

    const body = (await req.json()) as Partial<QuoteRequest>;
    const chainId = Number(body.chainId);
    const sellToken = String(body.sellToken ?? "").trim();
    const buyToken = String(body.buyToken ?? "").trim();
    const taker = String(body.taker ?? "").trim();
    const sellAmount = String(body.sellAmount ?? "").trim();
    const slippageBps = Number.isFinite(Number(body.slippageBps))
      ? Math.max(1, Math.min(5000, Number(body.slippageBps)))
      : 50;

    if (!SUPPORTED_CHAINS[chainId]) {
      return json({ error: `Unsupported chainId: ${chainId}` }, 400);
    }
    if (!isAddress(sellToken) || !isAddress(buyToken)) {
      return json({ error: "sellToken/buyToken must be valid EVM addresses" }, 400);
    }
    if (!isAddress(taker)) {
      return json({ error: "taker must be a valid EVM address" }, 400);
    }
    if (sellToken.toLowerCase() === buyToken.toLowerCase()) {
      return json({ error: "sellToken and buyToken must differ" }, 400);
    }
    let sellAmountBig: bigint;
    try {
      sellAmountBig = BigInt(sellAmount);
      if (sellAmountBig <= 0n) throw new Error("non-positive");
    } catch {
      return json({ error: "sellAmount must be a positive integer (atomic)" }, 400);
    }

    const url = new URL(`${ZEROEX_BASE}/swap/allowance-holder/quote`);
    url.searchParams.set("chainId", String(chainId));
    url.searchParams.set("sellToken", sellToken);
    url.searchParams.set("buyToken", buyToken);
    url.searchParams.set("sellAmount", sellAmountBig.toString());
    url.searchParams.set("taker", taker);
    url.searchParams.set("slippageBps", String(slippageBps));
    // Vision platform fee — taken from the OUTPUT (buy) token, mirrors Jupiter.
    url.searchParams.set("swapFeeBps", String(PLATFORM_FEE_BPS));
    url.searchParams.set("swapFeeRecipient", EVM_TREASURY);
    url.searchParams.set("swapFeeToken", buyToken);
    // Capture positive slippage as additional treasury revenue.
    url.searchParams.set("tradeSurplusRecipient", EVM_TREASURY);

    const resp = await fetch(url.toString(), {
      headers: {
        "0x-api-key": apiKey,
        "0x-version": "v2",
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("0x quote error", resp.status, text);
      // Surface 0x's "no liquidity"-style errors as user-friendly messages.
      let userMsg = "No route found for this trade.";
      try {
        const parsed = JSON.parse(text);
        const reason = parsed?.name ?? parsed?.reason ?? parsed?.code;
        if (reason === "INPUT_INVALID") userMsg = "Invalid trade parameters.";
        else if (reason === "INSUFFICIENT_LIQUIDITY") userMsg = "Not enough on-chain liquidity for this size.";
      } catch { /* keep default */ }
      return json({ error: userMsg }, 502);
    }

    const data = await resp.json();

    // 0x v2 returns:
    //   buyAmount         — net amount user receives AFTER our fee
    //   minBuyAmount      — slippage-protected minimum
    //   sellAmount        — what user actually pays (input)
    //   route             — { fills: [{ source, proportionBps, ... }] }
    //   transaction       — { to, data, value, gas, gasPrice }
    //   issues.allowance  — null if no approval needed, else { spender, actual }
    //   fees.integratorFee — { amount, token, type } if our fee applied

    const buyAmountAtomic = String(data.buyAmount ?? "0");
    const minBuyAmountAtomic = String(data.minBuyAmount ?? data.buyAmount ?? "0");
    const sellAmountActual = String(data.sellAmount ?? sellAmountBig.toString());

    const buyDecimals = Number(body.buyTokenDecimals ?? data.buyToken?.decimals ?? 18);
    const sellDecimals = Number(body.sellTokenDecimals ?? data.sellToken?.decimals ?? 18);

    const buyAmountUi = atomicToUi(buyAmountAtomic, buyDecimals);
    const sellAmountUi = atomicToUi(sellAmountActual, sellDecimals);
    const rate = sellAmountUi > 0 ? buyAmountUi / sellAmountUi : 0;

    // 0x returns USD prices when available — we use them as-is. If absent,
    // the orchestrator can fill from its own price source.
    const buyAmountUsd = data.totalNetworkFee?.buyAmountUsd
      ?? data.buyAmountUsd
      ?? null;
    const sellAmountUsd = data.sellAmountUsd ?? null;

    // Aggregate the AMM route hops into the same shape `swap-quote` uses.
    const fills = Array.isArray(data.route?.fills) ? data.route.fills : [];
    const route = fills.map((f: any) => ({
      ammKey: f.source ?? null,
      label: String(f.source ?? "unknown"),
      proportionBps: Number(f.proportionBps ?? 0),
      from: f.from ?? null,
      to: f.to ?? null,
    }));

    // Network fee estimate — 0x returns gas + gasPrice on `transaction`,
    // and a USD estimate in `totalNetworkFee` when liquidity sources allow.
    const gasUnits = data.transaction?.gas ? BigInt(data.transaction.gas) : null;
    const gasPriceWei = data.transaction?.gasPrice ? BigInt(data.transaction.gasPrice) : null;
    const estNetworkFeeNative = gasUnits && gasPriceWei
      ? Number(gasUnits * gasPriceWei) / 1e18
      : null;
    const estNetworkFeeUsd = data.totalNetworkFeeUsd
      ?? (typeof data.totalNetworkFee === "object" ? data.totalNetworkFee?.amountUsd : null)
      ?? null;

    // Platform fee echoed from 0x's response so frontend can render the
    // exact amount that will land in treasury.
    const integratorFee = data.fees?.integratorFee ?? null;
    const platformFee = integratorFee
      ? {
          bps: PLATFORM_FEE_BPS,
          amountAtomic: String(integratorFee.amount ?? "0"),
          amountUi: atomicToUi(integratorFee.amount ?? "0", buyDecimals),
          symbol: body.buyTokenSymbol ?? data.buyToken?.symbol ?? "TOKEN",
          token: integratorFee.token ?? buyToken,
          // Best-effort USD value via per-unit price from the quote.
          valueUsd: buyAmountUsd && Number(buyAmountAtomic) > 0
            ? (Number(integratorFee.amount ?? 0) / Number(buyAmountAtomic)) * Number(buyAmountUsd)
            : null,
        }
      : null;

    // Price impact: 0x returns no single field for it, but we can derive a
    // rough number when `pricing.priceImpactPercentage` is present (newer
    // routes). Otherwise null — the frontend already handles `null` safely.
    const priceImpactPct = typeof data.pricing?.priceImpactPercentage === "number"
      ? Number(data.pricing.priceImpactPercentage)
      : null;

    return json({
      chainId,
      input: {
        address: sellToken,
        symbol: body.sellTokenSymbol ?? data.sellToken?.symbol ?? "TOKEN",
        decimals: sellDecimals,
        amountAtomic: sellAmountActual,
        amountUi: sellAmountUi,
        valueUsd: sellAmountUsd ? Number(sellAmountUsd) : null,
      },
      output: {
        address: buyToken,
        symbol: body.buyTokenSymbol ?? data.buyToken?.symbol ?? "TOKEN",
        decimals: buyDecimals,
        amountAtomic: buyAmountAtomic,
        amountUi: buyAmountUi,
        minAmountAtomic: minBuyAmountAtomic,
        minAmountUi: atomicToUi(minBuyAmountAtomic, buyDecimals),
        valueUsd: buyAmountUsd ? Number(buyAmountUsd) : null,
      },
      rate,
      priceImpactPct,
      slippageBps,
      route,
      estNetworkFeeNative,
      estNetworkFeeUsd: estNetworkFeeUsd ? Number(estNetworkFeeUsd) : null,
      platformFee,
      // Approval data for the frontend — null = no approval needed (e.g. native sells).
      allowanceTarget: data.issues?.allowance?.spender ?? data.allowanceTarget ?? null,
      allowanceCurrent: data.issues?.allowance?.actual ?? null,
      // Echo back enough to call evm-swap-build without a second 0x roundtrip.
      _quoteCacheKey: `${chainId}:${sellToken}:${buyToken}:${sellAmountActual}:${slippageBps}`,
    });
  } catch (e) {
    console.error("evm-swap-quote error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ---------- helpers ----------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAddress(addr: string): boolean {
  // Allow the 0x native placeholder (mixed case) as well as standard hex addresses.
  if (!addr) return false;
  if (addr.toLowerCase() === EVM_NATIVE_PLACEHOLDER.toLowerCase()) return true;
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function atomicToUi(atomic: string | number | bigint, decimals: number): number {
  try {
    const big = typeof atomic === "bigint" ? atomic : BigInt(String(atomic));
    if (decimals <= 0) return Number(big);
    // For small/medium values Number() loss is fine for display; for very
    // large bigints we render via string division to avoid Infinity.
    const divisor = 10n ** BigInt(decimals);
    const whole = big / divisor;
    const frac = big % divisor;
    if (whole < 1_000_000_000n) {
      return Number(big) / Number(divisor);
    }
    // Build "<whole>.<frac>" then parseFloat.
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 8);
    return parseFloat(`${whole.toString()}.${fracStr}`);
  } catch {
    return 0;
  }
}
