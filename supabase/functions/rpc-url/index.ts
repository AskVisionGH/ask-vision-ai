import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "solana-client",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
].join(", ");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": ALLOWED_HEADERS,
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

// Thin proxy to Helius mainnet RPC. Wallet adapters fire many concurrent
// JSON-RPC calls; we add a timeout + structured error responses so a single
// flaky upstream doesn't crash the worker (which surfaces as a 503
// SUPABASE_EDGE_RUNTIME_ERROR to the client).
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
  if (!HELIUS_API_KEY) {
    return new Response(
      JSON.stringify({ error: "RPC misconfigured" }),
      { status: 500, headers: jsonHeaders },
    );
  }

  let body: string;
  try {
    body = await req.text();
  } catch (_e) {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      { status: 400, headers: jsonHeaders },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const upstream = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      },
    );

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: jsonHeaders,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error("rpc-url upstream error:", aborted ? "timeout" : e);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: aborted ? "RPC upstream timeout" : "RPC upstream unavailable",
        },
        id: null,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } finally {
    clearTimeout(timeout);
  }
});
