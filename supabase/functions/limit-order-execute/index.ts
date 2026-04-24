import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Submits a signed Jupiter Trigger API transaction (createOrder or cancelOrder).
// Docs: https://dev.jup.ag/docs/trigger-api/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const requestId: string = body.requestId ?? "";
    const signedTransaction: string = body.signedTransaction ?? "";

    if (!requestId) return json({ error: "requestId required" }, 400);
    if (!signedTransaction) return json({ error: "signedTransaction required" }, 400);

    const resp = await fetch("https://lite-api.jup.ag/trigger/v1/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, signedTransaction }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Jupiter trigger execute error:", resp.status, t);
      return json({ error: "Couldn't submit limit order. Try again." }, 502);
    }

    const data = await resp.json();
    return json({
      signature: data.signature ?? null,
      status: data.status ?? null,
      code: data.code ?? null,
      error: data.error ?? null,
    });
  } catch (e) {
    console.error("limit-order-execute error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
