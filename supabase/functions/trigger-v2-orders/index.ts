import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Lists, cancels, and confirms-cancel for v2 trigger orders.
//
// Actions:
//   { action: "list", jwt, state?: "active" | "past", limit?, offset? }
//   { action: "cancel", jwt, orderId }
//      -> returns { id, transaction (b64 unsigned), requestId }
//   { action: "confirm-cancel", jwt, orderId, signedTransaction (b64), cancelRequestId }
//      -> returns { id, txSignature }
//
// Endpoints used (from upstream docs):
//   GET  /trigger/v2/orders/history?state=active|past
//   POST /trigger/v2/orders/price/cancel/:orderId
//   POST /trigger/v2/orders/price/confirm-cancel/:orderId

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
      const state: string = body.state === "past" ? "past" : "active";
      const limit = Number(body.limit) > 0 ? Number(body.limit) : 50;
      const offset = Number(body.offset) >= 0 ? Number(body.offset) : 0;
      const url = new URL(`${BASE}/orders/history`);
      url.searchParams.set("state", state);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      const r = await fetch(url.toString(), { headers });
      if (!r.ok) {
        const t = await r.text();
        console.error("v2 list orders error:", r.status, t);
        return json({ error: "Couldn't fetch orders" }, 502);
      }
      return json(await r.json());
    }

    if (action === "cancel") {
      const orderId: string = body.orderId ?? "";
      if (!orderId) return json({ error: "orderId required" }, 400);

      const r = await fetch(
        `${BASE}/orders/price/cancel/${encodeURIComponent(orderId)}`,
        { method: "POST", headers },
      );
      if (!r.ok) {
        const t = await r.text();
        console.error("v2 cancel order error:", r.status, t);
        return json({ error: parseError(t) ?? "Couldn't cancel order" }, 502);
      }
      return json(await r.json());
    }

    if (action === "confirm-cancel") {
      const orderId: string = body.orderId ?? "";
      const signedTransaction: string = body.signedTransaction ?? "";
      const cancelRequestId: string = body.cancelRequestId ?? "";
      if (!orderId) return json({ error: "orderId required" }, 400);
      if (!signedTransaction) return json({ error: "signedTransaction required" }, 400);
      if (!cancelRequestId) return json({ error: "cancelRequestId required" }, 400);

      const r = await fetch(
        `${BASE}/orders/price/confirm-cancel/${encodeURIComponent(orderId)}`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ signedTransaction, cancelRequestId }),
        },
      );
      if (!r.ok) {
        const t = await r.text();
        console.error("v2 confirm-cancel error:", r.status, t);
        return json({ error: parseError(t) ?? "Couldn't confirm withdrawal" }, 502);
      }
      return json(await r.json());
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("trigger-v2-orders error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function parseError(t: string): string | null {
  try {
    const p = JSON.parse(t);
    return p?.error ?? p?.message ?? p?.cause ?? null;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
