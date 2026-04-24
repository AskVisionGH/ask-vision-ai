import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Wraps Jupiter Trigger v2 challenge/verify auth flow.
// Docs: https://developers.jup.ag/docs/trigger/authentication
//
// Actions:
//   { action: "challenge", walletPubkey, type?: "message" | "transaction" }
//   { action: "verify", walletPubkey, type, signature?, signedTransaction? }

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
    const action: string = body.action ?? "challenge";

    if (action === "challenge") {
      const walletPubkey: string = body.walletPubkey ?? "";
      const type: string = body.type === "transaction" ? "transaction" : "message";
      if (!walletPubkey) return json({ error: "walletPubkey required" }, 400);

      const r = await fetch(`${BASE}/auth/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ walletPubkey, type }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("v2 challenge error:", r.status, t);
        return json({ error: "Couldn't request challenge" }, 502);
      }
      return json(await r.json());
    }

    if (action === "verify") {
      const walletPubkey: string = body.walletPubkey ?? "";
      const type: string = body.type === "transaction" ? "transaction" : "message";
      if (!walletPubkey) return json({ error: "walletPubkey required" }, 400);

      const payload: Record<string, unknown> = { walletPubkey, type };
      if (type === "message") {
        if (!body.signature) return json({ error: "signature required" }, 400);
        payload.signature = body.signature;
      } else {
        if (!body.signedTransaction) return json({ error: "signedTransaction required" }, 400);
        payload.signedTransaction = body.signedTransaction;
      }

      const r = await fetch(`${BASE}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("v2 verify error:", r.status, t);
        return json({ error: "Couldn't verify signature" }, 502);
      }
      return json(await r.json());
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("trigger-v2-auth error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
