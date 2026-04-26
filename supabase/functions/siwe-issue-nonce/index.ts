// Issues a one-time nonce for Sign-In with Ethereum (EIP-4361 / SIWE).
// Client builds a human-readable message containing this nonce, has the wallet
// sign it via personal_sign, and sends the result to `siwe-verify`.
//
// We deliberately reuse the `siws_nonces` table — schema is identical
// (wallet_address text + nonce + consumed + expires_at). EVM addresses are
// stored lowercased so lookups are canonical.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 0x followed by 40 hex chars. EIP-55 checksum is preserved on the wire by
// some wallets; we lowercase before storage and verification.
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;

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
    const rawWallet = String(body?.walletAddress ?? "").trim();
    const chainId = Number.isFinite(Number(body?.chainId)) ? Number(body.chainId) : 1;

    if (!EVM_ADDR.test(rawWallet)) {
      return new Response(
        JSON.stringify({ error: "Invalid Ethereum address" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const wallet = rawWallet.toLowerCase();

    const nonce = randomNonce();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Insert and read back so we can derive `Issued At` from `created_at` —
    // verify reconstructs the message from the same row, so they must match.
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
      console.error("[siwe-issue-nonce] insert error", error);
      return new Response(JSON.stringify({ error: "Could not issue nonce" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const issuedAt = new Date(inserted.created_at).toISOString();
    const origin = req.headers.get("origin") ?? "https://askvision.ai";
    const domain = (() => {
      try { return new URL(origin).host; } catch { return "askvision.ai"; }
    })();

    // EIP-4361 SIWE message format. Domain + URI come from the request origin
    // so the user can see what they're signing into. Verify reconstructs this
    // identically using the same fields stored in the nonce row.
    const message =
      `${domain} wants you to sign in with your Ethereum account:\n` +
      `${rawWallet}\n\n` +
      `Sign in to Vision. This request will not trigger a blockchain ` +
      `transaction or cost any gas.\n\n` +
      `URI: ${origin}\n` +
      `Version: 1\n` +
      `Chain ID: ${chainId}\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${issuedAt}`;

    return new Response(
      JSON.stringify({ nonce, message, expiresAt, chainId, domain }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[siwe-issue-nonce] unexpected", e);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
