// Merges a wallet-only auth account (created earlier via SIWS) into the
// caller's current account.
//
// Trigger:
//   Email user signs in, then connects a wallet from Settings/etc. The
//   client detects (via `wallet_links`) that this wallet is also linked
//   to a *different* user_id. We surface a one-time prompt; if the user
//   accepts, the client invokes this function with the wallet address.
//
// Flow (all server-side, using service role):
//   1. Verify caller's JWT and resolve their user_id (the keep_id).
//   2. Look up wallet_links for the wallet → must point to a different
//      user_id (orphan_id) and orphan must be the synthetic
//      `<wallet>@wallet.vision.local` account (we never auto-merge real
//      email accounts).
//   3. Re-parent every per-user row from orphan_id → keep_id:
//        conversations, messages, contacts, smart_wallets, wallet_links.
//   4. Delete the orphan profile + auth user.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonError(401, "Missing auth");
    }

    // 1. Resolve caller.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonError(401, "Invalid session");
    const keepId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const wallet = String(body?.walletAddress ?? "").trim();
    if (!BASE58.test(wallet)) return jsonError(400, "Invalid wallet address");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 2. Find wallet_links rows for this wallet.
    const { data: links, error: linkErr } = await admin
      .from("wallet_links")
      .select("user_id")
      .eq("wallet_address", wallet);
    if (linkErr) {
      console.error("[merge] wallet_links lookup", linkErr);
      return jsonError(500, "Lookup failed");
    }
    const otherIds = (links ?? []).map((r) => r.user_id).filter((id) => id !== keepId);
    if (otherIds.length === 0) {
      // Nothing to merge — wallet is only linked to the caller (or nobody).
      return new Response(JSON.stringify({ merged: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (otherIds.length > 1) {
      // Should never happen with the unique index, but be safe.
      return jsonError(409, "Wallet is linked to multiple other accounts");
    }

    const orphanId = otherIds[0];
    const expectedSyntheticEmail = `${wallet.toLowerCase()}@wallet.vision.local`;

    // 3. Confirm the orphan really is the wallet-only synthetic account.
    //    We refuse to absorb arbitrary real accounts (e.g. another Google user).
    const { data: orphanRecord, error: orphanErr } = await admin.auth.admin.getUserById(orphanId);
    if (orphanErr || !orphanRecord?.user) {
      console.error("[merge] orphan lookup", orphanErr);
      return jsonError(500, "Could not load other account");
    }
    if (orphanRecord.user.email !== expectedSyntheticEmail) {
      return jsonError(
        409,
        "That wallet belongs to a real account, not a wallet-only account. Please contact support to merge.",
      );
    }

    // 4. Re-parent per-user rows. We use a Postgres function via raw RPC
    //    would be cleaner, but staying with the typed client keeps this
    //    auditable. Wallet_links is handled last to avoid the unique-index
    //    collision (orphan already has a row for this wallet).
    const tables = [
      "conversations",
      "messages",
      "contacts",
      "smart_wallets",
    ] as const;
    for (const table of tables) {
      const { error } = await admin
        .from(table)
        .update({ user_id: keepId })
        .eq("user_id", orphanId);
      if (error) {
        console.error(`[merge] reparent ${table}`, error);
        return jsonError(500, `Failed to migrate ${table}`);
      }
    }

    // wallet_links: drop the orphan's row; if caller doesn't already have
    // one, insert it.
    await admin.from("wallet_links").delete().eq("user_id", orphanId).eq("wallet_address", wallet);
    const { data: existingLink } = await admin
      .from("wallet_links")
      .select("id")
      .eq("user_id", keepId)
      .eq("wallet_address", wallet)
      .maybeSingle();
    if (!existingLink) {
      await admin.from("wallet_links").insert({ user_id: keepId, wallet_address: wallet });
    }

    // 5. Tear down the orphan profile + auth user. Profile first so the
    //    foreign-key-free row goes cleanly; then delete the auth user
    //    which cascades any auth-side data.
    await admin.from("profiles").delete().eq("user_id", orphanId);
    await admin.from("user_roles").delete().eq("user_id", orphanId);

    const { error: deleteErr } = await admin.auth.admin.deleteUser(orphanId);
    if (deleteErr) {
      console.error("[merge] deleteUser", deleteErr);
      // Non-fatal — data is already migrated. Surface to the user as a warning.
      return new Response(
        JSON.stringify({ merged: true, warning: "Old account data migrated, but the empty account couldn't be removed automatically." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ merged: true, absorbedUserId: orphanId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[merge] unexpected", e);
    return jsonError(500, "Unexpected error");
  }
});
