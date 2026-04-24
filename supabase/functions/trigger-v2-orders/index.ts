import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Lists or cancels Jupiter v2 trigger orders for the authed user.
//
// Actions:
//   { action: "list", jwt, status?: "open" | "history" }
//   { action: "cancel", jwt, orderId }
//
// Note: Jupiter v2 cancel is a two-step withdrawal flow. This wrapper only
// performs step 1 (initiate cancel). Funds remain in the vault until the
// user signs a withdrawal transaction (separate flow, future work).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE = "https://api.jup.ag/trigger/v2";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("JUPITER_PORTAL_API_KEY");
    if (!apiKey) return json({ error: "JUPITER_PORTAL_API_KEY not configured" }, 500);

    const body = await req.json();
    const action: string = body.action ?? "list";
    const jwt: string = body.jwt ?? "";
    if (!jwt) return json({ error: "jwt required" }, 400);

    const headers = {
      "x-api-key": apiKey,
      "Authorization": `Bearer ${jwt}`,
    };

    if (action === "list") {
      const status: string = body.status === "history" ? "history" : "open";
      const url = new URL(`${BASE}/orders`);
      url.searchParams.set("status", status);
      const r = await fetch(url.toString(), { headers });
      if (!r.ok) {
        const t = await r.text();
        console.error("v2 list orders error:", r.status, t);
        return json({ error: "Couldn't fetch orders" }, 502);
      }
      const data = await r.json();
      return json(data);
    }

    if (action === "cancel") {
      const orderId: string = body.orderId ?? "";
      if (!orderId) return json({ error: "orderId required" }, 400);

      const r = await fetch(`${BASE}/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("v2 cancel order error:", r.status, t);
        return json({ error: "Couldn't cancel order" }, 502);
      }
      return json(await r.json());
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("trigger-v2-orders error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
