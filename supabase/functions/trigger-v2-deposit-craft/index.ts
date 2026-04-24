import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Crafts an unsigned deposit transaction that moves tokens from the user's
// wallet to their Jupiter v2 vault. Client signs and forwards to
// trigger-v2-create-order.
//
// Body: { jwt, inputMint, outputMint, userAddress, amount } (amount = atomic string)

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
    const inputMint: string = body.inputMint ?? "";
    const outputMint: string = body.outputMint ?? "";
    const userAddress: string = body.userAddress ?? "";
    const amount: string = body.amount != null ? String(body.amount) : "";

    if (!jwt) return json({ error: "jwt required" }, 400);
    if (!inputMint || !outputMint) return json({ error: "inputMint and outputMint required" }, 400);
    if (!userAddress) return json({ error: "userAddress required" }, 400);
    if (!amount) return json({ error: "amount required" }, 400);

    const r = await fetch(`${BASE}/deposit/craft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "Authorization": `Bearer ${jwt}`,
      },
      body: JSON.stringify({ inputMint, outputMint, userAddress, amount }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("v2 deposit/craft error:", r.status, t);
      return json({ error: "Couldn't craft deposit" }, 502);
    }
    return json(await r.json());
  } catch (e) {
    console.error("trigger-v2-deposit-craft error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
