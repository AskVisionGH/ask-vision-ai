import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Wraps Jupiter Recurring v1 createOrder for time-based DCA.
// Body: { user, inputMint, outputMint, inAmount (atomic string),
//         numberOfOrders, interval (seconds),
//         minPriceUsd?, maxPriceUsd?, startAt? (unix seconds) }
// Returns: { transaction (b64), requestId }

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
    const inputMint: string = body.inputMint ?? "";
    const outputMint: string = body.outputMint ?? "";
    const inAmount: string = String(body.inAmount ?? "");
    const numberOfOrders = Number(body.numberOfOrders ?? 0);
    const interval = Number(body.interval ?? 0);

    if (!user || !inputMint || !outputMint || !inAmount) {
      return json({ error: "user, inputMint, outputMint, inAmount required" }, 400);
    }
    if (!Number.isFinite(numberOfOrders) || numberOfOrders < 2) {
      return json({ error: "numberOfOrders must be ≥ 2" }, 400);
    }
    if (!Number.isFinite(interval) || interval < 60) {
      return json({ error: "interval must be ≥ 60 seconds" }, 400);
    }

    // Optional price guards (min/max in USD, sent to Jupiter as numeric strings)
    const minPriceUsd =
      body.minPriceUsd != null && body.minPriceUsd !== "" ? Number(body.minPriceUsd) : null;
    const maxPriceUsd =
      body.maxPriceUsd != null && body.maxPriceUsd !== "" ? Number(body.maxPriceUsd) : null;
    const startAt = body.startAt != null && body.startAt !== "" ? Number(body.startAt) : null;

    const payload = {
      user,
      inputMint,
      outputMint,
      params: {
        time: {
          inAmount: Number(inAmount),
          numberOfOrders,
          interval,
          minPrice: minPriceUsd,
          maxPrice: maxPriceUsd,
          startAt,
        },
      },
    };

    const r = await fetch(`${BASE}/createOrder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error("recurring create error:", r.status, text);
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      return json({ error: parsed?.error ?? "Couldn't create DCA order" }, 502);
    }
    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recurring-create error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}