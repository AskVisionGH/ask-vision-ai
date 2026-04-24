// Returns the VAPID public key so the browser can subscribe to Web Push.
// The public key is intentionally public — it's the same value embedded
// in every push subscription's `applicationServerKey`.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  if (!publicKey) {
    return new Response(
      JSON.stringify({ error: "VAPID_PUBLIC_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ publicKey }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
