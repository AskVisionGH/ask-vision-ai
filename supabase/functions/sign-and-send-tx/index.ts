/**
 * sign-and-send-tx
 *
 * Signs and broadcasts a transaction from the authenticated user's
 * Vision Wallet via the Privy Server Wallets RPC API.
 *
 * Request body:
 *   {
 *     "chain": "solana" | "evm",
 *     "caip2":  string,           // required: e.g. "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" or "eip155:1"
 *     "transaction": string,      // base64 serialized tx (Solana) OR raw tx object/string (EVM)
 *     "method"?: "signAndSendTransaction" | "signTransaction" | "eth_sendTransaction" | "eth_signTransaction",
 *     "sponsor"?: boolean         // Solana sponsorship (optional)
 *   }
 *
 * For EVM, you may pass either:
 *   - `transaction` as a base64-encoded serialized tx
 *   - or pass `tx` as an object (to/value/data/...) and we forward it directly to Privy.
 *
 * Response:
 *   { ok: true, hash?, signature?, transaction_id?, raw }
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRIVY_APP_ID = "cmogw21xh00vj0cjsefsm5fi8";
const PRIVY_API_BASE = "https://api.privy.io/v1";

type Chain = "solana" | "evm";

interface SignRequest {
  chain: Chain;
  caip2: string;
  transaction?: string; // base64 (Solana) or hex/base64 (EVM serialized)
  tx?: Record<string, unknown>; // EVM unsigned tx object
  method?: string;
  sponsor?: boolean;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function privyRpc(
  appSecret: string,
  walletId: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const auth = "Basic " + btoa(`${PRIVY_APP_ID}:${appSecret}`);
  const res = await fetch(`${PRIVY_API_BASE}/wallets/${walletId}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "privy-app-id": PRIVY_APP_ID,
      Authorization: auth,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const privyAppSecret = Deno.env.get("PRIVY_APP_SECRET");
    if (!privyAppSecret) {
      return jsonResponse({ error: "PRIVY_APP_SECRET not configured" }, 500);
    }

    // Authenticate caller
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } =
      await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }
    const userId = userData.user.id;

    // Parse + validate body
    let body: SignRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    const { chain, caip2, transaction, tx, sponsor } = body;
    if (chain !== "solana" && chain !== "evm") {
      return jsonResponse({ error: "chain must be 'solana' or 'evm'" }, 400);
    }
    if (!caip2 || typeof caip2 !== "string") {
      return jsonResponse({ error: "caip2 is required" }, 400);
    }
    if (!transaction && !tx) {
      return jsonResponse(
        { error: "Either 'transaction' (serialized) or 'tx' (object) required" },
        400,
      );
    }

    // Look up wallet ids
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const { data: walletRow, error: loadErr } = await admin
      .from("vision_wallets")
      .select("solana_wallet_id, evm_wallet_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (loadErr) {
      console.error("[sign-and-send-tx] DB load failed", loadErr);
      return jsonResponse({ error: "DB load failed" }, 500);
    }
    if (!walletRow) {
      return jsonResponse({ error: "No Vision Wallet for user" }, 404);
    }

    const walletId =
      chain === "solana" ? walletRow.solana_wallet_id : walletRow.evm_wallet_id;
    if (!walletId) {
      return jsonResponse(
        { error: `No ${chain} wallet provisioned for user` },
        404,
      );
    }

    // Build Privy RPC payload
    let payload: Record<string, unknown>;
    if (chain === "solana") {
      const method = body.method ?? "signAndSendTransaction";
      payload = {
        method,
        caip2,
        ...(sponsor ? { sponsor: true } : {}),
        params: {
          transaction,
          encoding: "base64",
        },
      };
    } else {
      // EVM
      const method = body.method ?? "eth_sendTransaction";
      payload = {
        method,
        caip2,
        chain_type: "ethereum",
        params: tx
          ? { transaction: tx }
          : { transaction, encoding: "base64" },
      };
    }

    const { status, body: rpcBody } = await privyRpc(
      privyAppSecret,
      walletId,
      payload,
    );

    if (status < 200 || status >= 300) {
      console.error("[sign-and-send-tx] Privy RPC error", status, rpcBody);
      return jsonResponse(
        { error: "Privy RPC failed", status, details: rpcBody },
        502,
      );
    }

    const data = rpcBody?.data ?? {};
    return jsonResponse({
      ok: true,
      hash: data.hash ?? null,
      signature: data.signature ?? data.signed_transaction ?? null,
      transaction_id: data.transaction_id ?? null,
      raw: rpcBody,
    });
  } catch (err) {
    console.error("[sign-and-send-tx] error", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
