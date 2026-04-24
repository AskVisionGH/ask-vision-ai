import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Fetches a LI.FI cross-chain quote with our 1% integrator fee baked in.
// LI.FI deducts the integrator fee from the user's input and routes it to
// the wallet address LI.FI has on file for our integrator name. To set that
// address, register at https://li.fi/integrator-portal and bind it to the
// integrator string we send below.
//
// Body:
//   fromChain     LI.FI chain id (number or "SOL")
//   toChain       LI.FI chain id (number or "SOL")
//   fromToken     token address on the source chain (use 0x000...0 for native EVM, "11111111111111111111111111111111" for SOL native? — LI.FI accepts the wrapped SOL mint)
//   toToken       token address on the destination chain
//   fromAmount    atomic units string
//   fromAddress   user's source-chain address
//   toAddress     destination wallet (defaults to fromAddress)
//   slippageBps   optional, defaults 50 (0.5%)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INTEGRATOR = "vision-ai";   // <-- registered at https://li.fi/integrator-portal
const FEE_RATIO = 0.01;            // 1% — LI.FI accepts 0..0.03 as a decimal

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const fromChain = String(body.fromChain ?? "");
    const toChain = String(body.toChain ?? "");
    const fromToken = String(body.fromToken ?? "");
    const toToken = String(body.toToken ?? "");
    const fromAmount = String(body.fromAmount ?? "");
    const fromAddress = String(body.fromAddress ?? "");
    const toAddress = String(body.toAddress ?? fromAddress);
    const slippageBps = Number.isFinite(Number(body.slippageBps))
      ? Math.max(1, Math.min(5000, Number(body.slippageBps)))
      : 50;

    if (!fromChain || !toChain) return json({ error: "fromChain and toChain required" }, 400);
    if (!fromToken || !toToken) return json({ error: "fromToken and toToken required" }, 400);
    if (!fromAmount || fromAmount === "0") return json({ error: "fromAmount required" }, 400);
    if (!fromAddress) return json({ error: "fromAddress required" }, 400);

    const apiKey = Deno.env.get("LIFI_API_KEY");
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (apiKey) headers["x-lifi-api-key"] = apiKey;

    const url = new URL("https://li.quest/v1/quote");
    url.searchParams.set("fromChain", fromChain);
    url.searchParams.set("toChain", toChain);
    url.searchParams.set("fromToken", fromToken);
    url.searchParams.set("toToken", toToken);
    url.searchParams.set("fromAmount", fromAmount);
    url.searchParams.set("fromAddress", fromAddress);
    url.searchParams.set("toAddress", toAddress);
    url.searchParams.set("slippage", String(slippageBps / 10_000));
    url.searchParams.set("integrator", INTEGRATOR);
    url.searchParams.set("fee", String(FEE_RATIO));

    const resp = await fetch(url.toString(), { headers });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("LI.FI quote error:", resp.status, t);
      let msg = "No bridge route found.";
      try {
        const parsed = JSON.parse(t);
        if (parsed?.message) msg = parsed.message;
      } catch { /* ignore */ }
      return json({ error: msg }, resp.status === 404 ? 404 : 502);
    }
    const quote = await resp.json();

    // Surface the bits the UI needs without leaking the full LI.FI payload.
    const est = quote.estimate ?? {};
    const action = quote.action ?? {};
    const includedFees: any[] = est.feeCosts ?? [];
    const platformFeeUsd = includedFees
      .filter((f) => f.included && (f.name?.toLowerCase().includes("integrator") || f.name?.toLowerCase().includes("partner")))
      .reduce((sum, f) => sum + Number(f.amountUSD ?? 0), 0);
    const gasFeeUsd = (est.gasCosts ?? []).reduce((sum: number, g: any) => sum + Number(g.amountUSD ?? 0), 0);

    return json({
      // Echo the raw quote — bridge-build will hand it back to LI.FI for the
      // transaction, which avoids re-quoting and keeps fee math consistent.
      raw: quote,
      tool: quote.tool,
      toolName: quote.toolDetails?.name ?? quote.tool,
      fromAmountAtomic: action.fromAmount ?? fromAmount,
      toAmountAtomic: est.toAmount ?? "0",
      toAmountMinAtomic: est.toAmountMin ?? "0",
      fromAmountUsd: est.fromAmountUSD != null ? Number(est.fromAmountUSD) : null,
      toAmountUsd: est.toAmountUSD != null ? Number(est.toAmountUSD) : null,
      executionDurationSec: est.executionDuration ?? null,
      platformFeeUsd: platformFeeUsd || null,
      gasFeeUsd: gasFeeUsd || null,
      slippageBps,
      quotedAt: Date.now(),
    });
  } catch (e) {
    console.error("bridge-quote error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
