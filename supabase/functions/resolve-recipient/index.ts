import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Zero-dependency recipient resolver.
// Heavy Solana validation (isOnCurve, decoding) happens in transfer-quote,
// which already loads @solana/web3.js. Keeping this function light avoids
// hitting the Edge Function CPU ceiling.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { recipient } = await req.json();
    if (!recipient || typeof recipient !== "string") {
      return json({ error: "recipient required" }, 400);
    }

    const trimmed = recipient.trim();

    if (trimmed.toLowerCase().endsWith(".sol")) {
      try {
        const resp = await fetch(
          `https://sdk-proxy.sns.id/resolve/${encodeURIComponent(trimmed)}`,
        );
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data || data.s !== "ok" || typeof data.result !== "string") {
          return json(
            { error: `Couldn't resolve "${trimmed}" — that .sol name doesn't exist or has no owner.` },
            404,
          );
        }
        const result = data.result.trim();
        if (!BASE58_RE.test(result)) {
          return json({ error: `Resolver returned an invalid address for "${trimmed}".` }, 502);
        }
        return json({ address: result, displayName: trimmed.toLowerCase() });
      } catch (e) {
        console.error("SNS proxy resolve error:", e);
        return json(
          { error: `Couldn't resolve "${trimmed}" — please try again in a moment.` },
          502,
        );
      }
    }

    if (BASE58_RE.test(trimmed)) {
      return json({ address: trimmed, displayName: null });
    }

    return json({ error: "Recipient must be a wallet address or .sol name." }, 400);
  } catch (e) {
    console.error("resolve-recipient error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
