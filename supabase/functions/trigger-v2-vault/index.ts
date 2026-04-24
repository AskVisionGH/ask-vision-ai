import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Gets the user's Jupiter v2 vault, registering one on first use.
// Caller passes: { jwt }
// Returns: { userPubkey, vaultPubkey, privyVaultId }

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
    const jwt: string = body.jwt ?? "";
    if (!jwt) return json({ error: "jwt required" }, 400);

    const headers = {
      "x-api-key": apiKey,
      "Authorization": `Bearer ${jwt}`,
    };

    // Try fetch existing vault first.
    let r = await fetch(`${BASE}/vault`, { headers });
    if (!r.ok) {
      // Register a new vault.
      r = await fetch(`${BASE}/vault/register`, { headers });
    }
    if (!r.ok) {
      const t = await r.text();
      console.error("v2 vault error:", r.status, t);
      return json({ error: "Couldn't get vault" }, 502);
    }
    return json(await r.json());
  } catch (e) {
    console.error("trigger-v2-vault error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
