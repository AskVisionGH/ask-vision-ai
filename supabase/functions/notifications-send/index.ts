// Generic notification dispatcher. Service-role callers only.
//
// Body: { user_id, category, title, body?, link?, metadata? }
//
// Flow:
//   1. Read user's prefs. If master off or that category off, skip silently.
//   2. If quiet hours enabled and current wall time in user's tz is in window,
//      skip silently (we can decide later to queue these instead).
//   3. If channel_in_app, insert a row in public.notifications (realtime
//      broadcasts it to the user's bell).
//   4. If channel_web_push, load push_subscriptions for the user and fire
//      one web push per device. Prune subscriptions on 404/410.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWebPush, WebPushError } from "../_shared/web-push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Category = "price" | "wallet_activity" | "order_fills" | "news_sentiment";

interface SendBody {
  user_id: string;
  category: Category;
  title: string;
  body?: string | null;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Parse a Supabase JWT payload (no verification — we still gate on service_role claim).
function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const padded = parts[1]
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Return the user's current local clock time as "HH:MM:SS" in their quiet_timezone.
function nowInTimezone(tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("hour")}:${get("minute")}:${get("second")}`;
  } catch {
    // Invalid tz — treat as UTC so notifications still go through rather than silently drop.
    return new Date().toISOString().slice(11, 19);
  }
}

// quiet window may cross midnight (e.g. 22:00 → 07:00). Inclusive on start, exclusive on end.
function isInQuietWindow(nowHms: string, start: string, end: string): boolean {
  if (start === end) return false;
  if (start < end) return nowHms >= start && nowHms < end;
  return nowHms >= start || nowHms < end;
}

const categoryField: Record<Category, string> = {
  price: "cat_price",
  wallet_activity: "cat_wallet_activity",
  order_fills: "cat_order_fills",
  news_sentiment: "cat_news_sentiment",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Only service-role callers may dispatch notifications.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const claims = parseJwtClaims(token);
  if (claims?.role !== "service_role") {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: SendBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.user_id || !body.category || !body.title) {
    return new Response(
      JSON.stringify({ error: "user_id, category, title required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!(body.category in categoryField)) {
    return new Response(JSON.stringify({ error: "Invalid category" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // 1. Load prefs (row may not exist for brand new users — treat as all-off).
  const { data: prefs, error: prefsErr } = await admin
    .from("notification_preferences")
    .select("*")
    .eq("user_id", body.user_id)
    .maybeSingle();
  if (prefsErr) {
    console.error("load prefs failed", prefsErr);
    return new Response(JSON.stringify({ error: "Prefs lookup failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!prefs || !prefs.master_enabled) {
    return new Response(
      JSON.stringify({ skipped: "prefs_disabled" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const categoryOn = prefs[categoryField[body.category]] === true;
  if (!categoryOn) {
    return new Response(
      JSON.stringify({ skipped: "category_off" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 2. Quiet hours
  if (prefs.quiet_hours_enabled && prefs.quiet_start && prefs.quiet_end) {
    const nowHms = nowInTimezone(prefs.quiet_timezone ?? "UTC");
    if (isInQuietWindow(nowHms, prefs.quiet_start, prefs.quiet_end)) {
      return new Response(
        JSON.stringify({ skipped: "quiet_hours" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  const results: Record<string, unknown> = { in_app: false, web_push_sent: 0, web_push_pruned: 0 };

  // 3. In-app row
  if (prefs.channel_in_app) {
    const { error: insErr } = await admin.from("notifications").insert({
      user_id: body.user_id,
      category: body.category,
      title: body.title,
      body: body.body ?? null,
      link: body.link ?? null,
      metadata: body.metadata ?? null,
    });
    if (insErr) {
      console.error("insert notification failed", insErr);
    } else {
      results.in_app = true;
    }
  }

  // 4. Web push
  if (prefs.channel_web_push && vapidPublic && vapidPrivate && vapidSubject) {
    const { data: subs, error: subsErr } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", body.user_id);
    if (subsErr) {
      console.error("load push subs failed", subsErr);
    } else if (subs && subs.length > 0) {
      const vapid = {
        publicKey: vapidPublic,
        privateKey: vapidPrivate,
        subject: vapidSubject,
      };
      const pushPayload = {
        title: body.title,
        body: body.body ?? "",
        link: body.link ?? null,
        category: body.category,
      };
      const stalEndpoints: string[] = [];
      let sent = 0;
      await Promise.all(
        subs.map(async (s) => {
          try {
            await sendWebPush(
              {
                endpoint: s.endpoint,
                keys: { p256dh: s.p256dh, auth: s.auth },
              },
              pushPayload,
              vapid,
            );
            sent++;
          } catch (err) {
            if (err instanceof WebPushError && (err.status === 404 || err.status === 410)) {
              stalEndpoints.push(s.endpoint);
            } else {
              console.error("web push send failed", { endpoint: s.endpoint, err: String(err) });
            }
          }
        }),
      );
      results.web_push_sent = sent;
      if (stalEndpoints.length > 0) {
        const { error: delErr } = await admin
          .from("push_subscriptions")
          .delete()
          .in("endpoint", stalEndpoints);
        if (delErr) {
          console.error("prune stale subs failed", delErr);
        } else {
          results.web_push_pruned = stalEndpoints.length;
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
