// helius-webhook-sync — keeps a single Helius webhook in sync with the union
// of every user's tracked smart_wallets addresses.
//
// Behaviour:
//   - Aggregates every distinct address from public.smart_wallets.
//   - If no addresses: deletes any existing webhook and clears the row.
//   - If a webhook row exists: PUT-updates the address list (and rotates the
//     auth header if missing).
//   - If no row exists: POST-creates a new webhook, stores webhook_id +
//     auth_header in public.helius_webhooks.
//
// Webhook delivery target: <SUPABASE_URL>/functions/v1/helius-webhook
// Webhook type: enhanced (Helius parses the tx for us).
//
// Idempotent: safe to call repeatedly. Service role only.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const HELIUS_BASE = "https://api.helius.xyz/v0";

interface HeliusWebhookRow {
  id: string;
  webhook_id: string;
  auth_header: string;
}

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const heliusKey = Deno.env.get("HELIUS_API_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!heliusKey) {
    return new Response(JSON.stringify({ error: "HELIUS_API_KEY missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // 1. Collect distinct addresses across all tracked wallets.
  const { data: walletRows, error: walletErr } = await admin
    .from("smart_wallets")
    .select("address");
  if (walletErr) {
    console.error("load smart_wallets failed", walletErr);
    return new Response(JSON.stringify({ error: "Load wallets failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const addresses = [
    ...new Set(
      (walletRows ?? [])
        .map((r) => String(r.address ?? "").trim())
        .filter(Boolean),
    ),
  ];

  // 2. Load existing webhook row (if any).
  const { data: existing } = await admin
    .from("helius_webhooks")
    .select("id, webhook_id, auth_header")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = existing as HeliusWebhookRow | null;

  const webhookUrl = `${supabaseUrl}/functions/v1/helius-webhook`;

  // 3. No addresses → tear webhook down.
  if (addresses.length === 0) {
    if (row?.webhook_id) {
      try {
        await fetch(
          `${HELIUS_BASE}/webhooks/${encodeURIComponent(row.webhook_id)}?api-key=${heliusKey}`,
          { method: "DELETE" },
        );
      } catch (err) {
        console.error("helius delete webhook failed", String(err));
      }
      await admin.from("helius_webhooks").delete().eq("id", row.id);
    }
    return new Response(
      JSON.stringify({ ok: true, action: "deleted", addresses: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Helius caps account list size around 100k; we cap defensively.
  const MAX = 100_000;
  const list = addresses.slice(0, MAX);

  const authHeader = row?.auth_header ?? randomSecret();

  // 4. Update or create.
  if (row?.webhook_id) {
    const r = await fetch(
      `${HELIUS_BASE}/webhooks/${encodeURIComponent(row.webhook_id)}?api-key=${heliusKey}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookURL: webhookUrl,
          transactionTypes: ["Any"],
          accountAddresses: list,
          webhookType: "enhanced",
          authHeader,
        }),
      },
    );
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("helius PUT failed", { status: r.status, body: text });
      return new Response(
        JSON.stringify({ error: "Helius update failed", status: r.status, body: text }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    await admin
      .from("helius_webhooks")
      .update({
        address_count: list.length,
        last_synced_at: new Date().toISOString(),
        auth_header: authHeader,
      })
      .eq("id", row.id);
    return new Response(
      JSON.stringify({ ok: true, action: "updated", addresses: list.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Create
  const r = await fetch(`${HELIUS_BASE}/webhooks?api-key=${heliusKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      webhookURL: webhookUrl,
      transactionTypes: ["Any"],
      accountAddresses: list,
      webhookType: "enhanced",
      authHeader,
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    console.error("helius POST failed", { status: r.status, body: text });
    return new Response(
      JSON.stringify({ error: "Helius create failed", status: r.status, body: text }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const created = (await r.json()) as { webhookID?: string };
  const newId = created.webhookID;
  if (!newId) {
    return new Response(JSON.stringify({ error: "Helius returned no webhook id" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  await admin.from("helius_webhooks").insert({
    webhook_id: newId,
    auth_header: authHeader,
    address_count: list.length,
  });

  return new Response(
    JSON.stringify({ ok: true, action: "created", addresses: list.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
