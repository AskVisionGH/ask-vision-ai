import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const signature: string = body.signature ?? "";
    if (!signature) return json({ error: "signature required" }, 400);

    const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
    if (!HELIUS_API_KEY) return json({ error: "RPC misconfigured" }, 500);

    const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

    // 1) Check signature status (fast path — works while sig is in the status cache)
    const statusResp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }],
      }),
    });

    if (!statusResp.ok) {
      return json({ status: "pending" });
    }

    const statusData = await statusResp.json();
    const info = statusData?.result?.value?.[0];

    if (info) {
      if (info.err) {
        return json({
          status: "failed",
          err: typeof info.err === "string" ? info.err : JSON.stringify(info.err),
          slot: info.slot ?? null,
        });
      }
      const conf = info.confirmationStatus;
      if (conf === "confirmed" || conf === "finalized") {
        // Optionally pull blockTime for confirmation timing
        let blockTime: number | null = null;
        try {
          const txResp = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "getTransaction",
              params: [signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
            }),
          });
          if (txResp.ok) {
            const txData = await txResp.json();
            blockTime = txData?.result?.blockTime ?? null;
          }
        } catch (_) { /* ignore */ }

        return json({
          status: "confirmed",
          slot: info.slot ?? null,
          blockTime,
        });
      }
    }

    return json({ status: "pending" });
  } catch (e) {
    console.error("tx-status error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
