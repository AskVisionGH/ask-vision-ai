// Inngest serve endpoint that exposes a single scheduled function:
// "sweep-jupiter-fees" runs every hour and POSTs to the sweep-fees edge
// function with the shared X-Sweep-Secret header.
//
// After deploy, sync this app with Inngest by visiting the URL once in a
// browser, or trigger a sync from the Inngest dashboard. INNGEST_SIGNING_KEY
// is read automatically by the SDK to verify webhook payloads.

import { Inngest } from "https://esm.sh/inngest@3.27.5";
import { serve } from "https://esm.sh/inngest@3.27.5/deno";

const inngest = new Inngest({ id: "vision-fee-sweeper" });

const sweepFn = inngest.createFunction(
  { id: "sweep-jupiter-fees", name: "Sweep Jupiter referral fees" },
  { cron: "0 * * * *" }, // every hour on the hour, UTC
  async ({ step }) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const sweepSecret = Deno.env.get("INNGEST_EVENT_TRIGGER_SECRET");
    if (!supabaseUrl) throw new Error("SUPABASE_URL not configured");
    if (!sweepSecret) throw new Error("INNGEST_EVENT_TRIGGER_SECRET not configured");

    // step.run gives us automatic retries with backoff if the sweep crashes.
    const result = await step.run("invoke-sweep-fees", async () => {
      const resp = await fetch(`${supabaseUrl}/functions/v1/sweep-fees`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sweep-Secret": sweepSecret,
        },
        body: JSON.stringify({ trigger: "cron" }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(`sweep-fees ${resp.status}: ${JSON.stringify(data)}`);
      }
      return data;
    });

    return { ok: true, result };
  },
);

const handler = serve({
  client: inngest,
  functions: [sweepFn],
  // Inngest webhooks come from inngest.com — they don't carry our Supabase JWT.
  // verify_jwt=false in config.toml lets them through; INNGEST_SIGNING_KEY
  // (read by the SDK) authenticates the payloads instead.
  servePath: "/inngest-sweep-cron",
});

Deno.serve(handler);
