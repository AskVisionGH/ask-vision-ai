import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const userPublicKey: string = body.userPublicKey ?? "";
    const inputMint: string = body.inputMint ?? "";
    const outputMint: string = body.outputMint ?? "";
    const amount = Number(body.amount); // atomic units
    const slippageBps = Number.isFinite(Number(body.slippageBps))
      ? Math.max(1, Math.min(5000, Number(body.slippageBps)))
      : 50;

    if (!userPublicKey) return json({ error: "userPublicKey required" }, 400);
    if (!inputMint || !outputMint) {
      return json({ error: "inputMint and outputMint required" }, 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ error: "amount (atomic) must be a positive number" }, 400);
    }

    // Re-fetch a fresh quote at submission time so the transaction is built
    // against the current on-chain state (not the 15s-old preview).
    const quoteUrl = new URL("https://lite-api.jup.ag/swap/v1/quote");
    quoteUrl.searchParams.set("inputMint", inputMint);
    quoteUrl.searchParams.set("outputMint", outputMint);
    quoteUrl.searchParams.set("amount", String(Math.floor(amount)));
    quoteUrl.searchParams.set("slippageBps", String(slippageBps));
    quoteUrl.searchParams.set("restrictIntermediateTokens", "true");

    const qResp = await fetch(quoteUrl.toString());
    if (!qResp.ok) {
      const t = await qResp.text();
      console.error("Jupiter quote (build) error:", qResp.status, t);
      return json({ error: "No route found at submission time. Try again." }, 502);
    }
    const quoteResponse = await qResp.json();

    const swapResp = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 1_000_000, // cap at 0.001 SOL
            priorityLevel: "high",
          },
        },
      }),
    });

    if (!swapResp.ok) {
      const t = await swapResp.text();
      console.error("Jupiter swap error:", swapResp.status, t);
      return json({ error: "Couldn't build swap transaction. Try again." }, 502);
    }

    const swapData = await swapResp.json();

    return json({
      swapTransaction: swapData.swapTransaction,
      lastValidBlockHeight: swapData.lastValidBlockHeight,
      prioritizationFeeLamports: swapData.prioritizationFeeLamports ?? null,
    });
  } catch (e) {
    console.error("swap-build error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
