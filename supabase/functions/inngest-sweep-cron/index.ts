// Inngest serve endpoint that exposes a single scheduled function:
// "sweep-jupiter-fees" runs every hour and POSTs to the sweep-fees edge
// function with the shared X-Sweep-Secret header.
//
// After deploy, sync this app with Inngest by visiting the URL once in a
// browser, or trigger a sync from the Inngest dashboard. INNGEST_SIGNING_KEY
// is read automatically by the SDK to verify webhook payloads.

import { Inngest } from "https://esm.sh/inngest@3.27.0";
import { serve } from "https://esm.sh/inngest@3.27.0/edge";

const inngest = new Inngest({ id: "vision-fee-sweeper" });

const sweepFn = inngest.createFunction(
  { id: "sweep-jupiter-fees", name: "Sweep Jupiter referral fees" },
  { cron: "0 * * * *" }, // every hour on the hour, UTC
  async ({ step }) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const sweepSecret = Deno.env.get("INNGEST_EVENT_TRIGGER_SECRET");
    if (!supabaseUrl) throw new Error("SUPABASE_URL not configured");
    if (!sweepSecret) throw new Error("INNGEST_EVENT_TRIGGER_SECRET not configured");

    // We intentionally do NOT throw on a non-2xx response. The sweep is
    // best-effort and already records its own failures into `sweep_runs`.
    // Throwing would cause Inngest's `step.run` to retry with backoff, which
    // produced 5 runs per hour (top of hour + ~1m, ~3m, ~5m). Keeping this
    // resolved means exactly one run per hourly tick.
    const result = await step.run("invoke-sweep-fees", async () => {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/sweep-fees`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Sweep-Secret": sweepSecret,
          },
          body: JSON.stringify({ trigger: "cron" }),
        });
        const data = await resp.json().catch(() => ({}));
        return { ok: resp.ok, status: resp.status, data };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
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
