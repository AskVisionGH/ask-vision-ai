import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Returns the unsigned source-chain transaction for a previously-fetched
// LI.FI quote. The client signs with the source-chain wallet (Solana for
// Phase 1) and submits via tx-submit (Solana) or wagmi (EVM, Phase 2).
//
// Body:
//   quote        the `raw` quote object returned by bridge-quote
//   fromAddress  user's source-chain address (must match quote.fromAddress)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const quote = body.quote;
    if (!quote || typeof quote !== "object") {
      return json({ error: "quote object required" }, 400);
    }

    const apiKey = Deno.env.get("LIFI_API_KEY");
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
    };
    if (apiKey) headers["x-lifi-api-key"] = apiKey;

    // LI.FI's /stepTransaction takes the full quote and returns the same step
    // with a populated `transactionRequest` (for EVM) or `solanaTransaction`
    // (base64 versioned tx, for Solana).
    const resp = await fetch("https://li.quest/v1/advanced/stepTransaction", {
      method: "POST",
      headers,
      body: JSON.stringify(quote),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("LI.FI stepTransaction error:", resp.status, t);
      return json({ error: "Couldn't build bridge transaction. Try again." }, 502);
    }
    const step = await resp.json();

    const txReq = step.transactionRequest ?? null;
    // For Solana, LI.FI puts the base64 versioned tx in transactionRequest.data
    // (the rest of the EVM-shaped fields are null). We pass it through unchanged.
    return json({
      step,
      transactionRequest: txReq,
      solanaTransaction: txReq?.data ?? null,  // base64 string when source is Solana
      chainType: step.action?.fromChainType ?? null,
    });
  } catch (e) {
    console.error("bridge-build error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
