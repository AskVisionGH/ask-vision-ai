// Issues a one-time nonce for Sign-In with Solana.
// Client builds a human-readable message containing this nonce, has the wallet
// sign it, and sends the result to `siws-verify`.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Lightweight base58 (alphabet-only) sanity check — full key validation
// happens server-side during signature verification.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const wallet = String(body?.walletAddress ?? "").trim();

    if (!BASE58.test(wallet)) {
      return new Response(
        JSON.stringify({ error: "Invalid wallet address" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const nonce = randomNonce();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Insert and read back the row so we can derive `Issued At` from the
    // database-assigned `created_at`. The verify function reconstructs the
    // signed message from the same `created_at`, so they must match exactly.
    const { data: inserted, error } = await admin
      .from("siws_nonces")
      .insert({
        wallet_address: wallet,
        nonce,
        expires_at: expiresAt,
      })
      .select("created_at")
      .single();

    if (error || !inserted) {
      console.error("[siws-issue-nonce] insert error", error);
      return new Response(JSON.stringify({ error: "Could not issue nonce" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The exact message the wallet must sign. Keep this stable — verify uses
    // the identical format and derives `issuedAt` from the same DB column.
    const issuedAt = new Date(inserted.created_at).toISOString();
    const message =
      `Vision wants you to sign in with your Solana account:\n${wallet}\n\n` +
      `Sign in to Vision. This request will not trigger a blockchain ` +
      `transaction or cost any gas.\n\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${issuedAt}`;

    return new Response(
      JSON.stringify({ nonce, message, expiresAt }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[siws-issue-nonce] unexpected", e);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
