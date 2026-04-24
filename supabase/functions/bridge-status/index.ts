import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Polls LI.FI's status endpoint for a cross-chain transaction. Bridges can
// take anywhere from ~30s (Mayan SOL→ETH) to several minutes, and the
// destination tx hash isn't known until the bridge releases funds, so the UI
// polls this until status is DONE or FAILED.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const txHash = url.searchParams.get("txHash") ?? "";
    const fromChain = url.searchParams.get("fromChain") ?? "";
    const toChain = url.searchParams.get("toChain") ?? "";
    const bridge = url.searchParams.get("bridge") ?? ""; // tool name from quote

    if (!txHash) return json({ error: "txHash required" }, 400);

    const apiKey = Deno.env.get("LIFI_API_KEY");
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (apiKey) headers["x-lifi-api-key"] = apiKey;

    const u = new URL("https://li.quest/v1/status");
    u.searchParams.set("txHash", txHash);
    if (fromChain) u.searchParams.set("fromChain", fromChain);
    if (toChain) u.searchParams.set("toChain", toChain);
    if (bridge) u.searchParams.set("bridge", bridge);

    const resp = await fetch(u.toString(), { headers });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("LI.FI status error:", resp.status, t);
      // Don't fail the poll loop on 404 — the bridge may not have indexed
      // the tx yet. Surface a "pending" so the client keeps polling.
      if (resp.status === 404) return json({ status: "PENDING", substatus: "INDEXING" });
      return json({ error: "Couldn't fetch status" }, 502);
    }
    const data = await resp.json();
    return json({
      status: data.status ?? "PENDING",      // PENDING | DONE | FAILED | INVALID
      substatus: data.substatus ?? null,
      sending: data.sending ?? null,
      receiving: data.receiving ?? null,
    });
  } catch (e) {
    console.error("bridge-status error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
