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
    const signedTransaction: string = body.signedTransaction ?? "";
    if (!signedTransaction) return json({ error: "signedTransaction required" }, 400);

    const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
    if (!HELIUS_API_KEY) return json({ error: "RPC misconfigured" }, 500);

    const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          signedTransaction,
          {
            encoding: "base64",
            skipPreflight: false,
            maxRetries: 2,
            preflightCommitment: "confirmed",
          },
        ],
      }),
    });

    const data = await resp.json();
    if (data.error) {
      console.error("sendTransaction error:", data.error);
      const msg = typeof data.error.message === "string"
        ? data.error.message
        : JSON.stringify(data.error);
      return json({ error: mapRpcError(msg) }, 400);
    }

    return json({ signature: data.result });
  } catch (e) {
    console.error("tx-submit error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function mapRpcError(msg: string): string {
  if (msg.includes("0x1771")) return "Price moved beyond your slippage tolerance.";
  if (msg.includes("BlockhashNotFound") || msg.includes("blockhash")) {
    return "Quote expired before submission. Try again.";
  }
  if (msg.includes("insufficient")) return "Insufficient balance for this swap.";
  return msg.slice(0, 200);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
