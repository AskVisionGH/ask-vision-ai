/**
 * create-vision-wallet
 *
 * Creates a Vision Wallet for the authenticated Supabase user using the
 * Privy Server Wallets REST API. Each user gets one Solana + one EVM
 * server wallet (presented as a single "Vision Wallet" in the UI). The
 * wallets are managed entirely server-side — no Privy SDK runs in the
 * browser, no email OTP step, no iframe.
 *
 * Idempotent: if the user already has both wallets, we just return them.
 * If only one chain exists (e.g. partial creation), we create the missing
 * chain and update the row.
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

type ChainType = "solana" | "ethereum";

interface PrivyWallet {
  id: string;
  address: string;
  chain_type: ChainType;
}

async function privyCreateWallet(
  appSecret: string,
  chainType: ChainType,
): Promise<PrivyWallet> {
  const auth = "Basic " + btoa(`${PRIVY_APP_ID}:${appSecret}`);
  const res = await fetch(`${PRIVY_API_BASE}/wallets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "privy-app-id": PRIVY_APP_ID,
      Authorization: auth,
    },
    body: JSON.stringify({ chain_type: chainType }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Privy wallet create failed (${chainType}, ${res.status}): ${text}`,
    );
  }
  const data = JSON.parse(text) as PrivyWallet;
  if (!data.id || !data.address) {
    throw new Error(`Privy returned malformed wallet: ${text}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const privyAppSecret = Deno.env.get("PRIVY_APP_SECRET");

    if (!privyAppSecret) {
      return new Response(
        JSON.stringify({ error: "PRIVY_APP_SECRET not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Identify the caller via their Supabase JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // Use service role for DB writes (bypasses RLS, we control the user_id).
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // Load or initialise row.
    const { data: existing, error: loadErr } = await admin
      .from("vision_wallets")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (loadErr) {
      console.error("[create-vision-wallet] load failed", loadErr);
      return new Response(JSON.stringify({ error: "DB load failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let solanaAddress = existing?.solana_address ?? null;
    let solanaWalletId = existing?.solana_wallet_id ?? null;
    let evmAddress = existing?.evm_address ?? null;
    let evmWalletId = existing?.evm_wallet_id ?? null;

    // Create missing chains.
    if (!solanaWalletId) {
      const w = await privyCreateWallet(privyAppSecret, "solana");
      solanaWalletId = w.id;
      solanaAddress = w.address;
    }
    if (!evmWalletId) {
      const w = await privyCreateWallet(privyAppSecret, "ethereum");
      evmWalletId = w.id;
      evmAddress = w.address;
    }

    // Upsert. We use a synthetic privy_user_id of "server:<userId>" to keep
    // the NOT-NULL legacy expectations harmless even though the column is
    // now nullable; this also makes server wallets distinguishable from
    // any future migrated embedded wallets.
    const privyUserId = existing?.privy_user_id ?? `server:${userId}`;

    const { data: upserted, error: upsertErr } = await admin
      .from("vision_wallets")
      .upsert(
        {
          user_id: userId,
          privy_user_id: privyUserId,
          solana_address: solanaAddress,
          solana_wallet_id: solanaWalletId,
          evm_address: evmAddress,
          evm_wallet_id: evmWalletId,
          origin: existing?.origin ?? "created",
          is_active: true,
        },
        { onConflict: "user_id" },
      )
      .select()
      .single();

    if (upsertErr) {
      console.error("[create-vision-wallet] upsert failed", upsertErr);
      return new Response(JSON.stringify({ error: "DB upsert failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        wallet: {
          solana_address: upserted.solana_address,
          evm_address: upserted.evm_address,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[create-vision-wallet] error", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
