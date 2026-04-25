// Hard-deletes a target user — only callable by super admins.
// Mirrors delete-account, but the target is supplied by the caller and
// privilege is checked via user_roles instead of the caller's own JWT identity.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
      return json({ error: "Server misconfigured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    // Resolve the caller from their JWT.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Invalid session" }, 401);
    const callerId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Only super admins are allowed to nuke other accounts.
    const { data: roleRows, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "super_admin");
    if (roleErr) return json({ error: "Role check failed" }, 500);
    if (!roleRows || roleRows.length === 0) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body?.userId ?? "").trim();
    if (!targetUserId) return json({ error: "Missing userId" }, 400);
    if (targetUserId === callerId) {
      return json({ error: "Refusing to delete your own account here" }, 400);
    }

    // Refuse to delete other super admins to avoid foot-gunning.
    const { data: targetRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", targetUserId)
      .eq("role", "super_admin");
    if (targetRoles && targetRoles.length > 0) {
      return json({ error: "Cannot delete a super admin" }, 400);
    }

    // Wipe owned avatar files first (storage doesn't cascade).
    try {
      const { data: files } = await admin.storage.from("avatars").list(targetUserId);
      if (files && files.length > 0) {
        const paths = files.map((f) => `${targetUserId}/${f.name}`);
        await admin.storage.from("avatars").remove(paths);
      }
    } catch (e) {
      console.error("avatar cleanup failed:", e);
    }

    // Order matters: messages references conversations.
    const dataTables = ["messages", "conversations", "contacts", "wallet_links", "user_roles"];
    for (const t of dataTables) {
      const { error } = await admin.from(t).delete().eq("user_id", targetUserId);
      if (error) {
        console.error(`delete ${t} failed:`, error);
        return json({ error: `Failed to delete ${t}` }, 500);
      }
    }

    const { error: pErr } = await admin.from("profiles").delete().eq("user_id", targetUserId);
    if (pErr) {
      console.error("delete profiles failed:", pErr);
      return json({ error: "Failed to delete profile" }, 500);
    }

    const { error: authErr } = await admin.auth.admin.deleteUser(targetUserId);
    if (authErr) {
      console.error("auth.admin.deleteUser failed:", authErr);
      return json({ error: "Failed to delete auth account" }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("admin-delete-user error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
