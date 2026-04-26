// Records a per-user swap fee row in `treasury_fees` after the client has
// confirmed the swap landed on-chain. Replaces the old "claim everything,
// attribute to no one" sweep model with attribution at the source.
//
// Auth: requires a logged-in user (we read user_id from the JWT).
// Idempotency: relies on the unique (chain, signature, asset_address) index
// — duplicate calls for the same swap are silently no-ops.
//
// Body: { signature, valueUsd, feeUsd?, feeAmountUi?, feeMint?, feeSymbol?,
//          inputMint?, outputMint? }
//   - valueUsd is the swap notional (input or output, USD)
//   - feeUsd / feeAmountUi / feeMint come from the Jupiter quote when
//     available; otherwise we fall back to 1% of valueUsd in USDC-equivalent.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOL_TREASURY = "ASKVSe32esNeK7i84oGsL5F9cqh8ov3neXEF8jSc9i89";
const PLATFORM_FEE_BPS = 100; // 1% — must stay in sync with swap-quote/swap-build.

const KNOWN_MINTS: Record<string, { symbol: string; address: string | null }> = {
  So11111111111111111111111111111111111111112: { symbol: "SOL", address: null },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    symbol: "USDC",
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
      return json({ error: "Server not configured" }, 500);
    }

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (userErr || !userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const signature = typeof body.signature === "string" ? body.signature : "";
    const valueUsd = typeof body.valueUsd === "number" && Number.isFinite(body.valueUsd)
      ? body.valueUsd
      : null;
    const feeUsdFromClient = typeof body.feeUsd === "number" && Number.isFinite(body.feeUsd)
      ? body.feeUsd
      : null;
    const feeAmountUi = typeof body.feeAmountUi === "number" && Number.isFinite(body.feeAmountUi)
      ? body.feeAmountUi
      : null;
    const feeMint = typeof body.feeMint === "string" ? body.feeMint : null;
    const feeSymbol = typeof body.feeSymbol === "string" ? body.feeSymbol : null;
    const inputMint = typeof body.inputMint === "string" ? body.inputMint : null;
    const outputMint = typeof body.outputMint === "string" ? body.outputMint : null;

    if (!signature) return json({ error: "signature required" }, 400);

    // Prefer the exact fee from Jupiter's quote. Fall back to 1% of valueUsd
    // when the client didn't pass it (older clients / chat preview).
    const amountUsd = feeUsdFromClient
      ?? (valueUsd != null ? valueUsd * (PLATFORM_FEE_BPS / 10_000) : null);

    // Asset attribution: Jupiter takes the platform fee from the OUTPUT mint.
    const assetMint = feeMint ?? outputMint ?? null;
    const known = assetMint ? KNOWN_MINTS[assetMint] : undefined;
    const assetSymbol = feeSymbol ?? known?.symbol ?? null;
    const assetAddress = known
      ? known.address
      : (assetMint && assetMint !== "native" ? assetMint : null);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Best-effort link back to the matching tx_events row for downstream
    // joins (admin user lookup, etc.).
    let relatedTxEventId: string | null = null;
    try {
      const { data: tx } = await admin
        .from("tx_events")
        .select("id")
        .eq("signature", signature)
        .eq("user_id", userId)
        .maybeSingle();
      relatedTxEventId = tx?.id ?? null;
    } catch (_) { /* ignore */ }

    const row = {
      chain: "solana",
      treasury_address: SOL_TREASURY,
      source_kind: "swap_fee",
      asset_symbol: assetSymbol,
      asset_address: assetAddress,
      amount: feeAmountUi ?? 0,
      amount_usd: amountUsd,
      signature,
      from_address: null,
      block_time: new Date().toISOString(),
      related_user_id: userId,
      related_tx_event_id: relatedTxEventId,
      metadata: {
        bps: PLATFORM_FEE_BPS,
        valueUsd,
        inputMint,
        outputMint,
      },
    };

    // Idempotent: the unique index is on (chain, signature, COALESCE(asset_address, 'native'))
    // — a partial expression PostgREST can't target via onConflict, so we
    // pre-check for an existing row and only insert if missing. First
    // attribution wins.
    const dupQuery = admin
      .from("treasury_fees")
      .select("id")
      .eq("chain", "solana")
      .eq("signature", signature);
    const { data: existing } = assetAddress === null
      ? await dupQuery.is("asset_address", null).maybeSingle()
      : await dupQuery.eq("asset_address", assetAddress).maybeSingle();

    if (existing?.id) {
      return json({ ok: true, deduped: true });
    }

    const { error } = await admin.from("treasury_fees").insert(row);

    if (error) {
      // Index may still race-trip; treat unique violation as success.
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        return json({ ok: true, deduped: true });
      }
      console.error("record-swap-fee insert failed:", error);
      return json({ error: "Failed to record fee" }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("record-swap-fee error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
