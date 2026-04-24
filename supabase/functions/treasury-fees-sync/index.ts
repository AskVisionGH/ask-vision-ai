// Treasury fees indexer.
//
// Aggregates platform revenue from three sources into the `treasury_fees`
// ledger. Designed to be idempotent — safe to run as often as we want.
//
//   1. Solana sweeps: mirror `sweep_runs` rows (these capture all swap +
//      limit-order fees that flow through the Jupiter referral program).
//   2. DCA upfront fees: mirror `tx_events` where the user paid the 1% before
//      placing a DCA order (these go directly to TREASURY_PUBLIC_KEY).
//   3. Bridge fees: scan the ETH treasury via Etherscan for incoming
//      transfers from known LI.FI fee-collector addresses.
//
// Anything we can't confidently classify as a platform fee is *not* inserted —
// the ledger stays clean for accounting purposes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOL_TREASURY = "ASKVSe32esNeK7i84oGsL5F9cqh8ov3neXEF8jSc9i89";
const ETH_TREASURY = "0xd62427353491907D6A0606DC8be4a8Be05bBaF58";

// LI.FI integrator fee collectors. These are the addresses LI.FI uses to
// settle integrator payouts. Normalized to lowercase. Add new ones as we see
// them in the wild — anything from an unknown address is silently ignored.
const LIFI_FEE_SOURCES = new Set<string>([
  // LI.FI Diamond router (main contract) — handles direct fee payouts on a
  // subset of routes.
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
  // FeeCollector — sweeps integrator balances periodically.
  "0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9",
  // LI.FI integrator payout EOA — observed paying out vision-ai bridge fees.
  "0x5babe600b9fcd5fb7b66c0611bf4896d967b23a1",
  // Add more when discovered.
]);

// Common ERC-20 stablecoin contracts on Ethereum (for USD value & decimals).
const ERC20_META: Record<string, { symbol: string; decimals: number; usd: number | null }> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6, usd: 1 },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6, usd: 1 },
  "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18, usd: 1 },
};

interface FeeRow {
  chain: "solana" | "ethereum";
  treasury_address: string;
  source_kind: string;
  asset_symbol: string | null;
  asset_address: string | null;
  amount: number;
  amount_usd: number | null;
  signature: string;
  from_address: string | null;
  block_time: string;
  related_user_id?: string | null;
  related_tx_event_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const etherscanKey = Deno.env.get("ETHERSCAN_API_KEY");
    if (!supabaseUrl || !serviceRole) {
      return json({ error: "Server not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRole);
    const summary = { swap_sweeps: 0, dca_fees: 0, bridge_fees: 0, errors: [] as string[] };

    // 1. Mirror Solana sweep runs ----------------------------------------
    try {
      summary.swap_sweeps = await syncSolanaSweeps(supabase);
    } catch (e) {
      summary.errors.push(`sweeps: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Mirror DCA upfront fees ----------------------------------------
    try {
      summary.dca_fees = await syncDcaFees(supabase);
    } catch (e) {
      summary.errors.push(`dca: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. Index ETH treasury for bridge fees ------------------------------
    if (etherscanKey) {
      try {
        summary.bridge_fees = await syncEthBridgeFees(supabase, etherscanKey);
      } catch (e) {
        summary.errors.push(`bridge: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      summary.errors.push("ETHERSCAN_API_KEY not configured — bridge fees skipped");
    }

    return json({ ok: true, summary });
  } catch (e) {
    console.error("treasury-fees-sync fatal:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ---------------- Solana sweeps ----------------

async function syncSolanaSweeps(supabase: ReturnType<typeof createClient>): Promise<number> {
  // Pull all successful sweep runs from the last 90 days. The dedupe index
  // on (chain, signature, asset) lets us re-run safely.
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: runs, error } = await supabase
    .from("sweep_runs")
    .select("id, started_at, finished_at, status, total_value_usd, signatures, per_token")
    .eq("status", "success")
    .gte("started_at", since)
    .order("started_at", { ascending: false });
  if (error) throw error;
  if (!runs || runs.length === 0) return 0;

  const rows: FeeRow[] = [];
  for (const r of runs) {
    const blockTime = (r.finished_at as string | null) ?? (r.started_at as string);
    const sigs: string[] = Array.isArray(r.signatures) ? (r.signatures as string[]) : [];
    const primarySig = sigs[0];
    if (!primarySig) continue;

    // per_token is a jsonb breakdown of what was claimed. Shape (from
    // sweep-fees/index.ts):
    //   { [mint]: { symbol, amount, decimals?, valueUsd } }
    // If missing, fall back to a single aggregated row with total_value_usd.
    const perToken = (r.per_token ?? null) as
      | Record<string, { symbol?: string; amount?: number; decimals?: number; valueUsd?: number }>
      | null;

    if (perToken && Object.keys(perToken).length > 0) {
      for (const [mint, info] of Object.entries(perToken)) {
        rows.push({
          chain: "solana",
          treasury_address: SOL_TREASURY,
          source_kind: "sweep",
          asset_symbol: info.symbol ?? null,
          asset_address: mint === "native" || mint === "SOL" ? null : mint,
          amount: Number(info.amount ?? 0),
          amount_usd: info.valueUsd != null ? Number(info.valueUsd) : null,
          signature: primarySig,
          from_address: null,
          block_time: blockTime,
          metadata: { sweep_run_id: r.id, all_signatures: sigs },
        });
      }
    } else {
      rows.push({
        chain: "solana",
        treasury_address: SOL_TREASURY,
        source_kind: "sweep",
        asset_symbol: null,
        asset_address: null,
        amount: 0,
        amount_usd: r.total_value_usd != null ? Number(r.total_value_usd) : null,
        signature: primarySig,
        from_address: null,
        block_time: blockTime,
        metadata: { sweep_run_id: r.id, all_signatures: sigs },
      });
    }
  }

  return await upsertFees(supabase, rows);
}

// ---------------- DCA upfront fees ----------------

async function syncDcaFees(supabase: ReturnType<typeof createClient>): Promise<number> {
  // DCA fee transfers are recorded in `tx_events` with metadata.feeAmountAtomic
  // or a dedicated kind. We treat any swap/transfer event whose metadata
  // explicitly tags `platform_fee: true` as a recordable fee.
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: events, error } = await supabase
    .from("tx_events")
    .select("id, signature, value_usd, input_mint, input_amount, user_id, created_at, metadata, kind")
    .gte("created_at", since)
    .not("metadata", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  if (!events || events.length === 0) return 0;

  const rows: FeeRow[] = [];
  for (const ev of events) {
    const meta = (ev.metadata as Record<string, unknown> | null) ?? null;
    if (!meta) continue;
    // Recognise either:
    //   metadata.kind === 'dca_fee'  (preferred — set by dca flow at submit)
    //   metadata.platform_fee === true
    const isDcaFee =
      meta.kind === "dca_fee" ||
      meta.platform_fee === true ||
      meta.platformFee === true;
    if (!isDcaFee) continue;

    const feeAmount = Number(meta.feeAmount ?? meta.fee_amount ?? ev.input_amount ?? 0);
    rows.push({
      chain: "solana",
      treasury_address: SOL_TREASURY,
      source_kind: "dca_fee",
      asset_symbol: (meta.symbol as string) ?? null,
      asset_address: (ev.input_mint as string | null) ?? null,
      amount: feeAmount,
      amount_usd: ev.value_usd != null ? Number(ev.value_usd) : null,
      signature: ev.signature as string,
      from_address: null,
      block_time: ev.created_at as string,
      related_user_id: ev.user_id as string,
      related_tx_event_id: ev.id as string,
      metadata: meta,
    });
  }

  return await upsertFees(supabase, rows);
}

// ---------------- ETH bridge fees ----------------

interface EtherscanTx {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  contractAddress?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  isError?: string;
}

async function syncEthBridgeFees(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
): Promise<number> {
  const treasury = ETH_TREASURY.toLowerCase();

  // Etherscan v2 unified API supports chainid=1 for mainnet. We pull both
  // native ETH transfers and ERC-20 transfers for the treasury, then filter
  // to incoming transfers from a known LI.FI source.
  const baseUrl = "https://api.etherscan.io/v2/api";

  const fetchPaged = async (action: "txlist" | "tokentx"): Promise<EtherscanTx[]> => {
    const url = new URL(baseUrl);
    url.searchParams.set("chainid", "1");
    url.searchParams.set("module", "account");
    url.searchParams.set("action", action);
    url.searchParams.set("address", ETH_TREASURY);
    url.searchParams.set("startblock", "0");
    url.searchParams.set("endblock", "99999999");
    url.searchParams.set("page", "1");
    url.searchParams.set("offset", "1000"); // last 1000 txs
    url.searchParams.set("sort", "desc");
    url.searchParams.set("apikey", apiKey);

    const resp = await fetch(url.toString());
    const data = await resp.json();
    if (data.status !== "1" && data.message !== "No transactions found") {
      throw new Error(`Etherscan ${action} error: ${data.message ?? "unknown"}`);
    }
    return Array.isArray(data.result) ? (data.result as EtherscanTx[]) : [];
  };

  const [nativeTxs, tokenTxs, ethUsd] = await Promise.all([
    fetchPaged("txlist"),
    fetchPaged("tokentx"),
    fetchEthUsdPrice(),
  ]);

  const rows: FeeRow[] = [];

  // Native ETH transfers
  for (const tx of nativeTxs) {
    if (tx.isError === "1") continue;
    if (tx.to?.toLowerCase() !== treasury) continue;
    const fromLc = tx.from?.toLowerCase();
    if (!fromLc || !LIFI_FEE_SOURCES.has(fromLc)) continue;
    const valueWei = BigInt(tx.value || "0");
    if (valueWei === 0n) continue;
    const amount = Number(valueWei) / 1e18;
    rows.push({
      chain: "ethereum",
      treasury_address: ETH_TREASURY,
      source_kind: "bridge_fee",
      asset_symbol: "ETH",
      asset_address: null,
      amount,
      amount_usd: ethUsd != null ? amount * ethUsd : null,
      signature: tx.hash,
      from_address: tx.from,
      block_time: new Date(Number(tx.timeStamp) * 1000).toISOString(),
      metadata: { source: "etherscan", block: tx.blockNumber, eth_usd: ethUsd },
    });
  }

  // ERC-20 transfers (USDC / USDT / DAI etc.)
  for (const tx of tokenTxs) {
    if (tx.to?.toLowerCase() !== treasury) continue;
    const fromLc = tx.from?.toLowerCase();
    if (!fromLc || !LIFI_FEE_SOURCES.has(fromLc)) continue;
    const contract = tx.contractAddress?.toLowerCase() ?? "";
    const meta = ERC20_META[contract];
    const decimals = meta?.decimals ?? Number(tx.tokenDecimal ?? "18");
    const symbol = meta?.symbol ?? tx.tokenSymbol ?? "TOKEN";
    const amountAtomic = BigInt(tx.value || "0");
    if (amountAtomic === 0n) continue;
    const amount = Number(amountAtomic) / Math.pow(10, decimals);
    const amountUsd = meta?.usd != null ? amount * meta.usd : null;
    rows.push({
      chain: "ethereum",
      treasury_address: ETH_TREASURY,
      source_kind: "bridge_fee",
      asset_symbol: symbol,
      asset_address: contract,
      amount,
      amount_usd: amountUsd,
      signature: tx.hash,
      from_address: tx.from,
      block_time: new Date(Number(tx.timeStamp) * 1000).toISOString(),
      metadata: { source: "etherscan", block: tx.blockNumber, token_name: tx.tokenName },
    });
  }

  const inserted = await upsertFees(supabase, rows);

  // Backfill USD for ETH rows that were indexed before we priced inline.
  if (ethUsd != null) {
    const { data: nullRows } = await supabase
      .from("treasury_fees")
      .select("id, amount")
      .eq("chain", "ethereum")
      .eq("asset_symbol", "ETH")
      .is("amount_usd", null);
    if (nullRows && nullRows.length > 0) {
      for (const r of nullRows) {
        await supabase
          .from("treasury_fees")
          .update({ amount_usd: Number(r.amount) * ethUsd })
          .eq("id", r.id);
      }
    }
  }

  return inserted;
}

// Fetch ETH/USD spot price from CoinGecko (no API key needed for this endpoint).
async function fetchEthUsdPrice(): Promise<number | null> {
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const price = data?.ethereum?.usd;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}

// ---------------- Upsert helper ----------------

async function upsertFees(
  supabase: ReturnType<typeof createClient>,
  rows: FeeRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  // Dedupe key on the table: (chain, signature, COALESCE(asset_address, 'native'))
  // We use upsert with `ignoreDuplicates` so re-runs are no-ops.
  const { error, count } = await supabase
    .from("treasury_fees")
    .upsert(rows, { onConflict: "chain,signature", ignoreDuplicates: true, count: "exact" });
  if (error) {
    // Some Supabase versions can't upsert on a partial unique index. Fall
    // back to per-row inserts and swallow duplicate-key errors.
    let inserted = 0;
    for (const row of rows) {
      const { error: insertErr } = await supabase.from("treasury_fees").insert(row);
      if (!insertErr) inserted++;
      else if (!String(insertErr.message).includes("duplicate")) {
        console.warn("treasury_fees insert error:", insertErr.message);
      }
    }
    return inserted;
  }
  return count ?? rows.length;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
