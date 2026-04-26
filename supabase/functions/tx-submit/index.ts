// Submits a signed transaction via Helius and (best-effort) records a
// `tx_events` row so the admin Stats panel has real volume data.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type EventKind = "swap" | "transfer" | "bridge";

type MappedRpcError = {
  code: string;
  error: string;
  fallback: boolean;
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
      const mapped = mapRpcError(msg);
      return json(mapped, mapped.fallback ? 200 : 400);
    }

    const signature: string = data.result;

    // Best-effort event logging — never fail the user's tx because of it.
    try {
      await logTxEvent(req, signature, body);
    } catch (e) {
      console.error("tx event log failed:", e);
    }

    return json({ signature });
  } catch (e) {
    console.error("tx-submit error:", e);
    return json(
      {
        code: "SERVICE_FAILED",
        error: "Transaction submission is temporarily unavailable. Try again.",
        fallback: true,
      },
      200,
    );
  }
});

async function logTxEvent(
  req: Request,
  signature: string,
  body: Record<string, unknown>,
) {
  const kindRaw = String(body.kind ?? "").toLowerCase();
  const kinds: EventKind[] = ["swap", "transfer", "bridge"];
  if (!kinds.includes(kindRaw as EventKind)) return; // caller didn't tag it — skip

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) return;

  // Resolve caller's user id from JWT — anon callers don't get logged.
  const auth = req.headers.get("Authorization");
  if (!auth) return;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  await admin.from("tx_events").insert({
    user_id: userId,
    kind: kindRaw,
    signature,
    value_usd: numOrNull(body.valueUsd),
    input_mint: strOrNull(body.inputMint),
    output_mint: strOrNull(body.outputMint),
    input_amount: numOrNull(body.inputAmount),
    output_amount: numOrNull(body.outputAmount),
    recipient: strOrNull(body.recipient),
    wallet_address: strOrNull(body.walletAddress),
    metadata: body.metadata ?? null,
  });
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function mapRpcError(msg: string): MappedRpcError {
  const slippageCodes = ["0x1771", "0x1788", "0x1789"];
  if (
    slippageCodes.some((c) => msg.includes(c)) ||
    /slippage/i.test(msg)
  ) {
    return {
      code: "SLIPPAGE_TOLERANCE_EXCEEDED",
      error: "Price moved beyond your slippage tolerance. Refresh and retry to rebuild the swap at the latest price.",
      fallback: true,
    };
  }
  if (msg.includes("BlockhashNotFound") || msg.includes("blockhash")) {
    return {
      code: "QUOTE_EXPIRED",
      error: "Quote expired before submission. Refresh and try again.",
      fallback: true,
    };
  }
  if (msg.toLowerCase().includes("insufficient")) {
    return {
      code: "INSUFFICIENT_BALANCE",
      error: "Insufficient balance for this swap.",
      fallback: false,
    };
  }
  return {
    code: "TX_SUBMIT_FAILED",
    error: msg.slice(0, 200),
    fallback: false,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
