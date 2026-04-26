// Verifies a Sign-In with Ethereum (EIP-4361 / SIWE) signature, finds-or-creates
// the user account linked to that wallet, and returns a Supabase session.
//
// Mirrors siws-verify but for EVM:
//   - Uses viem's `verifyMessage` which supports both EOAs (personal_sign) and
//     EIP-1271 smart wallets (Safe, etc.).
//   - Synthetic email is `<lowercased-address>@wallet.vision.local` so wallet-
//     only accounts have a stable Supabase Auth identity.
//   - Reuses siws_nonces table (wallet_address is plain text).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyMessage } from "npm:viem@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const HEX_SIG = /^0x[0-9a-fA-F]+$/;

function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawWallet = String(body?.walletAddress ?? "").trim();
    const nonce = String(body?.nonce ?? "").trim();
    const signature = String(body?.signature ?? "").trim();
    const chainId = Number.isFinite(Number(body?.chainId)) ? Number(body.chainId) : 1;

    if (!EVM_ADDR.test(rawWallet)) return jsonError(400, "Invalid Ethereum address");
    if (!nonce) return jsonError(400, "Missing nonce");
    if (!HEX_SIG.test(signature)) return jsonError(400, "Malformed signature");
    const wallet = rawWallet.toLowerCase();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Look up + claim the nonce.
    const { data: nonceRow, error: nonceErr } = await admin
      .from("siws_nonces")
      .select("id, wallet_address, consumed, expires_at, created_at")
      .eq("nonce", nonce)
      .maybeSingle();

    if (nonceErr) {
      console.error("[siwe-verify] nonce lookup error", nonceErr);
      return jsonError(500, "Could not verify sign-in");
    }
    if (!nonceRow) return jsonError(400, "Unknown or expired sign-in request");
    if (nonceRow.consumed) return jsonError(400, "This sign-in request was already used");
    if (nonceRow.wallet_address !== wallet) return jsonError(400, "Wallet mismatch");
    if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
      return jsonError(400, "Sign-in request expired, try again");
    }

    // Reconstruct the exact message that was signed. Must match siwe-issue-nonce.
    const issuedAt = new Date(nonceRow.created_at).toISOString();
    const origin = req.headers.get("origin") ?? "https://askvision.ai";
    const domain = (() => {
      try { return new URL(origin).host; } catch { return "askvision.ai"; }
    })();
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

    // 2. Verify signature. viem handles EOA personal_sign and EIP-1271 contract
    //    wallets transparently. We pass the address as-checksum to satisfy
    //    viem's strict typing (it accepts any case but TS likes the prefix).
    let ok = false;
    try {
      ok = await verifyMessage({
        address: rawWallet as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    } catch (e) {
      console.error("[siwe-verify] verifyMessage threw", e);
      return jsonError(401, "Signature verification failed");
    }
    if (!ok) return jsonError(401, "Signature verification failed");

    // Burn the nonce so it can't be replayed.
    await admin.from("siws_nonces").update({ consumed: true }).eq("id", nonceRow.id);

    // 3. Find-or-create the user linked to this wallet.
    const { data: linkRow } = await admin
      .from("wallet_links")
      .select("user_id")
      .eq("wallet_address", wallet)
      .maybeSingle();

    let userId = linkRow?.user_id ?? null;

    if (!userId) {
      const syntheticEmail = `${wallet}@wallet.vision.local`;

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: { wallet_address: wallet, auth_method: "siwe" },
      });

      if (createErr || !created.user) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const existing = list?.users.find((u) => u.email === syntheticEmail);
        if (!existing) {
          console.error("[siwe-verify] createUser error", createErr);
          return jsonError(500, "Could not create account");
        }
        userId = existing.id;
      } else {
        userId = created.user.id;
      }

      const { error: linkErr } = await admin.from("wallet_links").insert({
        user_id: userId,
        wallet_address: wallet,
      });
      if (linkErr && linkErr.code !== "23505") {
        console.error("[siwe-verify] wallet_links insert error", linkErr);
      }
    }

    // 4. Mint a session via magic-link token exchange (same path as SIWS).
    const { data: userRecord, error: userErr } = await admin.auth.admin.getUserById(userId);
    if (userErr || !userRecord?.user?.email) {
      console.error("[siwe-verify] could not load user email", userErr);
      return jsonError(500, "Could not create session");
    }
    const sessionEmail = userRecord.user.email;

    const { data: linkData, error: linkGenErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: sessionEmail,
    });
    if (linkGenErr || !linkData) {
      console.error("[siwe-verify] generateLink error", linkGenErr);
      return jsonError(500, "Could not create session");
    }
    const hashedToken = linkData.properties?.hashed_token;
    if (!hashedToken) {
      console.error("[siwe-verify] missing hashed_token");
      return jsonError(500, "Could not create session");
    }

    return new Response(
      JSON.stringify({
        userId,
        walletAddress: wallet,
        tokenHash: hashedToken,
        email: sessionEmail,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[siwe-verify] unexpected", e);
    return jsonError(500, "Unexpected error");
  }
});
