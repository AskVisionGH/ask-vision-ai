import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Creates a Jupiter v2 trigger order: single, oco, or otoco.
// Pass-through wrapper that forwards the order spec + signed deposit tx.
//
// Body fields (all required unless noted):
//   jwt
//   orderType: "single" | "oco" | "otoco"
//   depositRequestId
//   depositSignedTx
//   userPubkey
//   inputMint, inputAmount (atomic string), outputMint, triggerMint
//   expiresAt (ms epoch, optional — defaults to +30d)
// Plus per-order-type fields:
//   single: triggerCondition ("above"|"below"), triggerPriceUsd, slippageBps?
//   oco:    tpPriceUsd, slPriceUsd, tpSlippageBps?, slSlippageBps?
//   otoco:  triggerCondition, triggerPriceUsd, tpPriceUsd, slPriceUsd,
//           slippageBps?, tpSlippageBps?, slSlippageBps?

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE = "https://api.jup.ag/trigger/v2";
const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("JUPITER_PORTAL_API_KEY");
    if (!apiKey) return json({ error: "JUPITER_PORTAL_API_KEY not configured" }, 500);

    const body = await req.json();
    const jwt: string = body.jwt ?? "";
    const orderType: string = body.orderType ?? "";
    if (!jwt) return json({ error: "jwt required" }, 400);
    if (!["single", "oco", "otoco"].includes(orderType)) {
      return json({ error: "orderType must be single | oco | otoco" }, 400);
    }
    for (const k of [
      "depositRequestId", "depositSignedTx", "userPubkey",
      "inputMint", "inputAmount", "outputMint", "triggerMint",
    ]) {
      if (!body[k]) return json({ error: `${k} required` }, 400);
    }

    const expiresAt = body.expiresAt ?? Date.now() + DEFAULT_EXPIRY_MS;

    const payload: Record<string, unknown> = {
      orderType,
      depositRequestId: body.depositRequestId,
      depositSignedTx: body.depositSignedTx,
      userPubkey: body.userPubkey,
      inputMint: body.inputMint,
      inputAmount: String(body.inputAmount),
      outputMint: body.outputMint,
      triggerMint: body.triggerMint,
      expiresAt,
    };

    if (orderType === "single" || orderType === "otoco") {
      if (!body.triggerCondition || !["above", "below"].includes(body.triggerCondition)) {
        return json({ error: "triggerCondition must be above | below" }, 400);
      }
      if (body.triggerPriceUsd == null) return json({ error: "triggerPriceUsd required" }, 400);
      payload.triggerCondition = body.triggerCondition;
      payload.triggerPriceUsd = Number(body.triggerPriceUsd);
      if (body.slippageBps != null) payload.slippageBps = Number(body.slippageBps);
    }
    if (orderType === "oco" || orderType === "otoco") {
      if (body.tpPriceUsd == null || body.slPriceUsd == null) {
        return json({ error: "tpPriceUsd and slPriceUsd required" }, 400);
      }
      if (Number(body.tpPriceUsd) <= Number(body.slPriceUsd)) {
        return json({ error: "Take-profit must be greater than stop-loss" }, 400);
      }
      payload.tpPriceUsd = Number(body.tpPriceUsd);
      payload.slPriceUsd = Number(body.slPriceUsd);
      if (body.tpSlippageBps != null) payload.tpSlippageBps = Number(body.tpSlippageBps);
      if (body.slSlippageBps != null) payload.slSlippageBps = Number(body.slSlippageBps);
    }

    const r = await fetch(`${BASE}/orders/price`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "Authorization": `Bearer ${jwt}`,
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("v2 create order error:", r.status, t);
      let parsed: any = null;
      try { parsed = JSON.parse(t); } catch { /* ignore */ }
      return json({ error: parsed?.error ?? parsed?.cause ?? "Couldn't create order" }, 502);
    }
    return json(await r.json());
  } catch (e) {
    console.error("trigger-v2-create-order error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
