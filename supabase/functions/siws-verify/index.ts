// Verifies a Sign-In with Solana signature, finds-or-creates the user account
// linked to that wallet, and returns a Supabase session the client can use.
//
// Flow:
//  1. Client calls `siws-issue-nonce` with their wallet address → gets a nonce + message.
//  2. Wallet signs that message; client posts { walletAddress, nonce, signature } here.
//  3. We verify the signature against the message using ed25519, then look up
//     (or create) the user via the wallet_links table.
//  4. We return a session (access_token + refresh_token) the client can hand to
//     supabase.auth.setSession().

import { createClient } from "jsr:@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import bs58 from "https://esm.sh/bs58@5.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
    const wallet = String(body?.walletAddress ?? "").trim();
    const nonce = String(body?.nonce ?? "").trim();
    const signatureB58 = String(body?.signature ?? "").trim();

    if (!BASE58.test(wallet)) return jsonError(400, "Invalid wallet address");
    if (!nonce) return jsonError(400, "Missing nonce");
    if (!signatureB58) return jsonError(400, "Missing signature");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Look up + claim the nonce. Must be unconsumed, unexpired, and
    //    bound to this wallet.
    const { data: nonceRow, error: nonceErr } = await admin
      .from("siws_nonces")
      .select("id, wallet_address, consumed, expires_at, created_at")
      .eq("nonce", nonce)
      .maybeSingle();

    if (nonceErr) {
      console.error("[siws-verify] nonce lookup error", nonceErr);
      return jsonError(500, "Could not verify sign-in");
    }
    if (!nonceRow) return jsonError(400, "Unknown or expired sign-in request");
    if (nonceRow.consumed) return jsonError(400, "This sign-in request was already used");
    if (nonceRow.wallet_address !== wallet) return jsonError(400, "Wallet mismatch");
    if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
      return jsonError(400, "Sign-in request expired, try again");
    }

    // Reconstruct the exact message that was signed.
    const issuedAt = new Date(nonceRow.created_at).toISOString();
    const message =
      `Vision wants you to sign in with your Solana account:\n${wallet}\n\n` +
      `Sign in to Vision. This request will not trigger a blockchain ` +
      `transaction or cost any gas.\n\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${issuedAt}`;

    // 2. Verify the signature with ed25519.
    let pubkeyBytes: Uint8Array;
    let sigBytes: Uint8Array;
    try {
      pubkeyBytes = bs58.decode(wallet);
      sigBytes = bs58.decode(signatureB58);
    } catch {
      return jsonError(400, "Malformed signature");
    }

    const messageBytes = new TextEncoder().encode(message);
    const ok = nacl.sign.detached.verify(messageBytes, sigBytes, pubkeyBytes);
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
      // Synthesize a stable email so Supabase Auth has something to key on.
      // Using a wallet-derived address keeps re-sign-in idempotent if the
      // wallet_links row is ever lost.
      const syntheticEmail = `${wallet.toLowerCase()}@wallet.vision.local`;

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: { wallet_address: wallet, auth_method: "siws" },
      });

      if (createErr || !created.user) {
        // If a user with that synthetic email already exists (e.g. partial
        // previous run), fetch them by email instead.
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const existing = list?.users.find((u) => u.email === syntheticEmail);
        if (!existing) {
          console.error("[siws-verify] createUser error", createErr);
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
        // 23505 = unique violation, which means another concurrent run already
        // linked this wallet — safe to ignore.
        console.error("[siws-verify] wallet_links insert error", linkErr);
      }
    }

    // 4. Mint a session for the user. The magic-link generator gives us
    //    an action_link with tokens we can convert to a session client-side.
    //    For wallet-only accounts we use the synthetic wallet email; for
    //    existing email accounts (e.g. someone who signed up with Google and
    //    then connected this wallet) we use whatever email auth.users has.
    const { data: userRecord, error: userErr } = await admin.auth.admin.getUserById(userId);
    if (userErr || !userRecord?.user?.email) {
      console.error("[siws-verify] could not load user email", userErr);
      return jsonError(500, "Could not create session");
    }
    const sessionEmail = userRecord.user.email;

    const { data: linkData, error: linkGenErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: sessionEmail,
    });

    if (linkGenErr || !linkData) {
      console.error("[siws-verify] generateLink error", linkGenErr);
      return jsonError(500, "Could not create session");
    }

    // The properties.hashed_token + email_otp pair is what verifyOtp expects.
    const hashedToken = linkData.properties?.hashed_token;
    if (!hashedToken) {
      console.error("[siws-verify] missing hashed_token");
      return jsonError(500, "Could not create session");
    }

    return new Response(
      JSON.stringify({
        userId,
        walletAddress: wallet,
        // Client calls supabase.auth.verifyOtp({ token_hash, type: "magiclink" })
        // to exchange this for a real session.
        tokenHash: hashedToken,
        email: sessionEmail,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[siws-verify] unexpected", e);
    return jsonError(500, "Unexpected error");
  }
});
