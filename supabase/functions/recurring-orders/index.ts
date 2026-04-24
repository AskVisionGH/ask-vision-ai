import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Wraps Jupiter Recurring v1 getRecurringOrders.
// Body: { user, orderStatus?: "active" | "history", page?: number,
//         inputMint?, outputMint?, includeFailedTx?: boolean }

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
    const user: string = body.user ?? "";
    if (!user) return json({ error: "user required" }, 400);

    const params = new URLSearchParams();
    params.set("user", user);
    params.set("orderStatus", body.orderStatus === "history" ? "history" : "active");
    params.set("recurringType", "time");
    if (body.page != null) params.set("page", String(body.page));
    if (body.inputMint) params.set("inputMint", String(body.inputMint));
    if (body.outputMint) params.set("outputMint", String(body.outputMint));
    params.set("includeFailedTx", body.includeFailedTx ? "true" : "false");

    const r = await fetch(`${BASE}/getRecurringOrders?${params.toString()}`, {
      headers: { "x-api-key": apiKey },
    });
    const text = await r.text();
    if (!r.ok) {
      console.error("recurring orders error:", r.status, text);
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      return json({ error: parsed?.error ?? "Couldn't load DCA orders" }, 502);
    }
    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recurring-orders error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}