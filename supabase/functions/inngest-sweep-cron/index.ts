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
  // retries: 0 — the sweep is hourly and best-effort. Retries on failure
  // caused multiple runs per hour; one tick = one attempt.
  { id: "sweep-jupiter-fees", name: "Sweep Jupiter referral fees", retries: 0 },
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

// Indexes the `treasury_fees` ledger every 15 minutes:
//   - Mirrors successful sweeps into the unified ledger
//   - Mirrors DCA upfront-fee transfers
//   - Scans the ETH treasury via Etherscan for incoming bridge-fee payouts
const indexFeesFn = inngest.createFunction(
  { id: "index-treasury-fees", name: "Index treasury fee ledger", retries: 1 },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL not configured");
    const result = await step.run("invoke-treasury-fees-sync", async () => {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/treasury-fees-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

// Pre-syncs smart-money wallet trades into the `smart_money_trades` table
// every 5 minutes. The chat-facing `smart-money-activity` reads from that
// table instead of calling Helius live, so user requests are fast and
// never blocked by upstream rate limits.
const smartMoneySyncFn = inngest.createFunction(
  { id: "smart-money-sync", name: "Sync smart-money wallet trades", retries: 0 },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL not configured");
    const result = await step.run("invoke-smart-money-sync", async () => {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/smart-money-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
    functions: [sweepFn, indexFeesFn, smartMoneySyncFn],
    servePath: "/functions/v1/inngest-sweep-cron",
  }),
);
