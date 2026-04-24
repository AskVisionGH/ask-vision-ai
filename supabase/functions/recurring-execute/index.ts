import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Wraps Jupiter Recurring v1 execute — submits a signed tx returned from
// createOrder or cancelOrder.
// Body: { signedTransaction (b64), requestId }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE = "https://api.jup.ag/recurring/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("JUPITER_PORTAL_API_KEY");
    if (!apiKey) return json({ error: "JUPITER_PORTAL_API_KEY not configured" }, 500);

    const body = await req.json();
    const signedTransaction: string = body.signedTransaction ?? "";
    const requestId: string = body.requestId ?? "";
    if (!signedTransaction || !requestId) {
      return json({ error: "signedTransaction and requestId required" }, 400);
    }

    const r = await fetch(`${BASE}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ signedTransaction, requestId }),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error("recurring execute error:", r.status, text);
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      return json({ error: parsed?.error ?? "Couldn't submit transaction" }, 502);
    }
    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recurring-execute error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}