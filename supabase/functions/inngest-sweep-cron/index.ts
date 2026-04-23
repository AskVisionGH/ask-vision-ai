// Inngest serve endpoint that exposes a single scheduled function:
// "sweep-jupiter-fees" runs every hour and POSTs to the sweep-fees edge
// function with the shared X-Sweep-Secret header.
//
// After deploy, sync this app with Inngest by visiting the URL once in a
// browser, or trigger a sync from the Inngest dashboard. INNGEST_SIGNING_KEY
// is read automatically by the SDK to verify webhook payloads.

import { Inngest } from "https://esm.sh/inngest@3.39.0";
import { serve } from "https://esm.sh/inngest@3.39.0/edge";

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

// Supabase Edge Functions rewrite the request path — `servePath` must match
// the deployed function URL exactly so Inngest's introspection works.
Deno.serve(
  serve({
    client: inngest,
    functions: [sweepFn],
    servePath: "/functions/v1/inngest-sweep-cron",
  }),
);
