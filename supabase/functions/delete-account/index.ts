// Hard-deletes everything Vision knows about the calling user, including
// their auth account. Requires a valid user JWT — never trusts the client to
// say which user_id to nuke.
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

    // Resolve the caller's user from their JWT.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Invalid session" }, 401);
    const userId = userData.user.id;
    const userEmail = (userData.user.email ?? "").toLowerCase();

    // Body: { confirmEmail, mode } — email must match the user's own.
    // mode: "wipe" (delete data, keep auth user) | "full" (delete everything).
    const body = await req.json().catch(() => ({}));
    const confirmEmail = String(body?.confirmEmail ?? "").trim().toLowerCase();
    const mode = body?.mode === "wipe" ? "wipe" : "full";
    if (!confirmEmail || confirmEmail !== userEmail) {
      return json({ error: "Email confirmation didn't match." }, 400);
    }

    // Service-role client: bypasses RLS so we can clean up everything.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Wipe owned avatar files first (storage doesn't cascade with table deletes).
    try {
      const { data: files } = await admin.storage.from("avatars").list(userId);
      if (files && files.length > 0) {
        const paths = files.map((f) => `${userId}/${f.name}`);
        await admin.storage.from("avatars").remove(paths);
      }
    } catch (e) {
      // Non-fatal — log and continue. Orphan avatars are harmless.
      console.error("avatar cleanup failed:", e);
    }

    // Wipe owned data. messages first because it has FK to conversations.
    // For "wipe" mode we keep the profile row but reset it to defaults so the
    // user can keep using the app fresh; for "full" we drop it entirely.
    const dataTables = ["messages", "conversations", "contacts", "wallet_links"];
    for (const t of dataTables) {
      const { error } = await admin.from(t).delete().eq("user_id", userId);
      if (error) {
        console.error(`delete ${t} failed:`, error);
        return json({ error: `Failed to delete ${t}` }, 500);
      }
    }

    if (mode === "full") {
      const { error: pErr } = await admin.from("profiles").delete().eq("user_id", userId);
      if (pErr) {
        console.error("delete profiles failed:", pErr);
        return json({ error: "Failed to delete profile" }, 500);
      }
      const { error: authErr } = await admin.auth.admin.deleteUser(userId);
      if (authErr) {
        console.error("auth.admin.deleteUser failed:", authErr);
        return json({ error: "Failed to delete auth account" }, 500);
      }
    } else {
      // Reset profile to a fresh state so the next sign-in feels new.
      const { error: rErr } = await admin
        .from("profiles")
        .update({
          display_name: null,
          avatar_url: null,
          experience: null,
          interests: [],
          risk_tolerance: null,
          onboarding_completed: false,
        })
        .eq("user_id", userId);
      if (rErr) {
        console.error("reset profile failed:", rErr);
        return json({ error: "Failed to reset profile" }, 500);
      }
    }

    return json({ ok: true, mode });

  } catch (e) {
    console.error("delete-account error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
