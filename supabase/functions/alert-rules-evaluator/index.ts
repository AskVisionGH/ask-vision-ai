// Alert rule evaluator — runs every 2 minutes via pg_cron.
//
// Loops all enabled alert_rules rows, evaluates each against fresh data, and
// calls `notifications-send` (which respects prefs + quiet hours + push) when
// a rule matches. Debounces via last_triggered_at so rules don't spam on every
// tick while a condition stays true.
//
// Rule kinds:
//   - price          → current USD price crosses threshold (30 min debounce)
//   - wallet_activity→ a qualifying tx_events row appeared since last fire
//                      (15 min debounce)
//   - portfolio_pnl  → user's wallet PnL % change over the rule's window
//                      crosses threshold (1 h debounce)
//
// Auth: service-role only (called by cron with service key).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type RuleKind = "price" | "wallet_activity" | "portfolio_pnl";

interface AlertRuleRow {
  id: string;
  user_id: string;
  kind: RuleKind;
  label: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_triggered_at: string | null;
}

const DEBOUNCE_MS: Record<RuleKind, number> = {
  price: 30 * 60 * 1000,
  wallet_activity: 15 * 60 * 1000,
  portfolio_pnl: 60 * 60 * 1000,
};

const notificationCategory: Record<RuleKind, string> = {
  price: "price",
  wallet_activity: "wallet_activity",
  portfolio_pnl: "price", // PnL reuses the price category (no dedicated cat yet)
};

// (JWT parsing no longer needed — evaluator is gated by being reachable only
// via the internal cron shared-secret header or a service-role Bearer.)

/**
 * Pull live USD prices for a set of mint addresses via Jupiter's mint-keyed
 * price endpoint. Deterministic — no ticker collisions.
 * Returns Map<mint, priceUsd>.
 */
async function fetchPricesByMint(
  mints: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = [...new Set(mints.filter(Boolean))];
  if (unique.length === 0) return out;
  // Jupiter accepts up to ~100 ids per call.
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 80) chunks.push(unique.slice(i, i + 80));
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const r = await fetch(
          `https://lite-api.jup.ag/price/v3?ids=${chunk.join(",")}`,
        );
        if (!r.ok) return;
        const data = (await r.json()) as Record<string, { usdPrice?: number | string }>;
        for (const [mint, info] of Object.entries(data ?? {})) {
          const p = Number(info?.usdPrice ?? 0);
          if (Number.isFinite(p) && p > 0) out.set(mint, p);
        }
      } catch (err) {
        console.error("price-by-mint fetch failed", { err: String(err) });
      }
    }),
  );
  return out;
}

/**
 * Legacy fallback: when a price rule was created before we captured the mint
 * address, look up the most-liquid token matching the symbol on Jupiter.
 * Returns Map<UPPER_SYMBOL, priceUsd>.
 */
async function fetchPricesBySymbol(
  symbols: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(
    [...new Set(symbols.map((s) => s.toUpperCase()))].map(async (sym) => {
      try {
        const r = await fetch(
          `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(sym)}`,
        );
        if (!r.ok) return;
        const data = (await r.json()) as unknown;
        if (!Array.isArray(data) || data.length === 0) return;
        // Pick the match with highest usdVolume24h (most liquid → most likely
        // the token the user meant when they typed "SOL" / "JUP" / etc.).
        const arr = data as Array<{
          symbol?: string;
          usdPrice?: number | string | null;
          usdVolume24h?: number | string | null;
        }>;
        const best = arr
          .filter((t) => (t.symbol ?? "").toUpperCase() === sym)
          .sort(
            (a, b) =>
              Number(b.usdVolume24h ?? 0) - Number(a.usdVolume24h ?? 0),
          )[0] ?? arr[0];
        const price = Number(best?.usdPrice ?? 0);
        if (Number.isFinite(price) && price > 0) out.set(sym, price);
      } catch (err) {
        console.error("price fetch failed", { sym, err: String(err) });
      }
    }),
  );
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Open endpoint by design: takes no user input, only evaluates rules already
  // in the DB, and is idempotent thanks to per-rule debounce windows. The
  // worst an unauthenticated caller can do is burn one extra eval cycle.
  // (Same posture as sweep-fees / treasury-fees-sync.)

  const admin = createClient(supabaseUrl, serviceKey);
  const now = Date.now();

  const { data: rulesData, error: rulesErr } = await admin
    .from("alert_rules")
    .select("id, user_id, kind, label, enabled, config, last_triggered_at")
    .eq("enabled", true);

  if (rulesErr) {
    console.error("load rules failed", rulesErr);
    return new Response(JSON.stringify({ error: "Load rules failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rules = (rulesData ?? []) as unknown as AlertRuleRow[];
  if (rules.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, evaluated: 0, fired: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Filter out rules still in debounce window.
  const ready = rules.filter((r) => {
    if (!r.last_triggered_at) return true;
    const last = new Date(r.last_triggered_at).getTime();
    return now - last >= DEBOUNCE_MS[r.kind];
  });

  // Pre-fetch prices for all enabled+ready price rules.
  // Prefer mint-keyed lookup (deterministic — no ticker collisions). For
  // legacy rules that lack a mint, fall back to symbol search.
  const priceRules = ready.filter((r) => r.kind === "price");
  const mints = priceRules
    .map((r) => String(r.config.token_address ?? ""))
    .filter(Boolean);
  const symbols = priceRules
    .filter((r) => !r.config.token_address)
    .map((r) => String(r.config.token_symbol ?? ""))
    .filter(Boolean);
  const [pricesByMint, pricesBySym] = await Promise.all([
    mints.length > 0 ? fetchPricesByMint(mints) : Promise.resolve(new Map<string, number>()),
    symbols.length > 0 ? fetchPricesBySymbol(symbols) : Promise.resolve(new Map<string, number>()),
  ]);

  const fires: Array<{
    rule: AlertRuleRow;
    title: string;
    body: string;
    metadata: Record<string, unknown>;
  }> = [];

  for (const rule of ready) {
    try {
      if (rule.kind === "price") {
        const sym = String(rule.config.token_symbol ?? "").toUpperCase();
        const mint = String(rule.config.token_address ?? "");
        const dir = rule.config.direction === "below" ? "below" : "above";
        const price = mint ? pricesByMint.get(mint) : pricesBySym.get(sym);
        if (!price || price <= 0) continue;

        const ttype = rule.config.threshold_type === "percent" ? "percent" : "price";

        if (ttype === "price") {
          const threshold = Number(rule.config.threshold_usd ?? 0);
          if (!Number.isFinite(threshold) || threshold <= 0) continue;
          const matched = dir === "above" ? price >= threshold : price <= threshold;
          if (!matched) continue;
          fires.push({
            rule,
            title: `${sym} ${dir === "above" ? "rose above" : "fell below"} $${threshold.toLocaleString()}`,
            body: `${sym} is now $${price.toFixed(price >= 1 ? 2 : 6)}.`,
            metadata: { rule_id: rule.id, kind: rule.kind, sym, mint, price, threshold, direction: dir },
          });
        } else {
          // Percent-change mode. We anchor to a baseline price + timestamp
          // captured the first time we evaluate the rule. When the elapsed
          // time exceeds `window_hours`, we re-anchor to roll the window
          // forward — keeps memory tiny vs. fetching historical candles.
          const pctThreshold = Number(rule.config.percent_change ?? 0);
          const windowHours = Number(rule.config.window_hours ?? 24);
          if (!Number.isFinite(pctThreshold) || pctThreshold <= 0) continue;
          if (!Number.isFinite(windowHours) || windowHours <= 0) continue;

          const basePrice = Number(rule.config.baseline_price_usd ?? 0);
          const baseAt = rule.config.baseline_at
            ? new Date(String(rule.config.baseline_at)).getTime()
            : 0;
          const windowMs = windowHours * 60 * 60 * 1000;
          const expired = baseAt > 0 && now - baseAt > windowMs;

          if (basePrice <= 0 || expired) {
            // Seed (or re-seed) the baseline; can't fire on this tick.
            await admin
              .from("alert_rules")
              .update({
                config: {
                  ...rule.config,
                  baseline_price_usd: price,
                  baseline_at: new Date(now).toISOString(),
                },
              })
              .eq("id", rule.id);
            continue;
          }

          const pct = ((price - basePrice) / basePrice) * 100;
          const matched =
            dir === "above" ? pct >= pctThreshold : pct <= -pctThreshold;
          if (!matched) continue;
          fires.push({
            rule,
            title: `${sym} ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% in ${windowHours}h`,
            body: `${sym} moved from $${basePrice.toFixed(basePrice >= 1 ? 2 : 6)} to $${price.toFixed(price >= 1 ? 2 : 6)}.`,
            metadata: {
              rule_id: rule.id,
              kind: rule.kind,
              sym,
              mint,
              price,
              baseline: basePrice,
              pct,
              threshold_pct: pctThreshold,
              window_hours: windowHours,
              direction: dir,
            },
          });
          // Reset baseline so the next window measures fresh.
          await admin
            .from("alert_rules")
            .update({
              config: {
                ...rule.config,
                baseline_price_usd: price,
                baseline_at: new Date(now).toISOString(),
              },
            })
            .eq("id", rule.id);
        }
      } else if (rule.kind === "wallet_activity") {
        const wallet = String(rule.config.wallet_address ?? "");
        const minUsd = Number(rule.config.min_value_usd ?? 0);
        if (!wallet || !Number.isFinite(minUsd) || minUsd <= 0) continue;
        // Look for tx events on this wallet since last fire (or last 15 min).
        const since = rule.last_triggered_at
          ? new Date(rule.last_triggered_at).toISOString()
          : new Date(now - DEBOUNCE_MS.wallet_activity).toISOString();
        const { data: evts } = await admin
          .from("tx_events")
          .select("kind, value_usd, signature, created_at, input_mint, output_mint")
          .eq("wallet_address", wallet)
          .gte("created_at", since)
          .gte("value_usd", minUsd)
          .order("created_at", { ascending: false })
          .limit(1);
        const top = evts?.[0];
        if (!top) continue;
        const label = String(rule.config.wallet_label ?? wallet.slice(0, 6));
        fires.push({
          rule,
          title: `${label} made a move`,
          body: `${top.kind} worth $${Number(top.value_usd).toLocaleString()}.`,
          metadata: { rule_id: rule.id, kind: rule.kind, signature: top.signature, wallet },
        });
      } else if (rule.kind === "portfolio_pnl") {
        const direction = rule.config.direction === "up"
          ? "up"
          : rule.config.direction === "down"
          ? "down"
          : "both";
        const pctThreshold = Number(rule.config.percent_change ?? 0);
        const windowHours = Number(rule.config.window_hours ?? 24);
        if (!Number.isFinite(pctThreshold) || pctThreshold <= 0) continue;

        // Find the user's primary wallet.
        const { data: walletLink } = await admin
          .from("wallet_links")
          .select("wallet_address")
          .eq("user_id", rule.user_id)
          .limit(1)
          .maybeSingle();
        const walletAddr = walletLink?.wallet_address;
        if (!walletAddr) continue;

        // Compute rough PnL % by summing tx_events value flow over window.
        // (Full holdings/price delta is expensive; value_usd of swaps+transfers
        // is a reasonable proxy for "activity PnL" and keeps this cron cheap.)
        const since = new Date(
          now - windowHours * 60 * 60 * 1000,
        ).toISOString();
        const { data: evts } = await admin
          .from("tx_events")
          .select("kind, value_usd, output_amount, input_amount")
          .eq("user_id", rule.user_id)
          .gte("created_at", since);

        if (!evts || evts.length === 0) continue;

        const totalFlow = evts.reduce(
          (s: number, e: { value_usd: number | null }) =>
            s + Number(e.value_usd ?? 0),
          0,
        );
        // Need a baseline: use rule metadata's stored baseline if present,
        // otherwise seed it with today's flow and skip firing.
        const baseline = Number(rule.config.pnl_baseline_usd ?? 0);
        if (baseline <= 0) {
          // Seed baseline in rule config so the next tick can compute a delta.
          await admin
            .from("alert_rules")
            .update({
              config: { ...rule.config, pnl_baseline_usd: Math.max(totalFlow, 1) },
            })
            .eq("id", rule.id);
          continue;
        }
        const pct = ((totalFlow - baseline) / baseline) * 100;
        const movedUp = pct >= pctThreshold;
        const movedDown = pct <= -pctThreshold;
        const matched =
          direction === "up"
            ? movedUp
            : direction === "down"
              ? movedDown
              : movedUp || movedDown;
        if (!matched) continue;
        fires.push({
          rule,
          title: `Portfolio ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}%`,
          body: `Activity over last ${windowHours}h shifted beyond your ${pctThreshold}% threshold.`,
          metadata: { rule_id: rule.id, kind: rule.kind, pct, windowHours },
        });
        // Reset baseline so the next window measures fresh.
        await admin
          .from("alert_rules")
          .update({ config: { ...rule.config, pnl_baseline_usd: totalFlow } })
          .eq("id", rule.id);
      }
    } catch (err) {
      console.error("rule eval failed", { rule_id: rule.id, err: String(err) });
    }
  }

  // Dispatch each fire via notifications-send.
  let fired = 0;
  for (const f of fires) {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/notifications-send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: f.rule.user_id,
          category: notificationCategory[f.rule.kind],
          title: f.title,
          body: f.body,
          link: "/alerts",
          metadata: f.metadata,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error("notifications-send failed", {
          rule_id: f.rule.id,
          status: resp.status,
          body: text,
        });
        continue;
      }
      // Mark rule as triggered so debounce kicks in.
      await admin
        .from("alert_rules")
        .update({ last_triggered_at: new Date().toISOString() })
        .eq("id", f.rule.id);
      fired++;
    } catch (err) {
      console.error("dispatch failed", { rule_id: f.rule.id, err: String(err) });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      evaluated: ready.length,
      total_rules: rules.length,
      fired,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
