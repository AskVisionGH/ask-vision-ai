/**
 * wallet-activity
 *
 * Returns a unified activity feed for the caller's Vision Wallet:
 *   - Recent `tx_events` rows (swaps, limits, transfers, etc. that we
 *     already record server-side)
 *   - Recent on-chain incoming transfers detected via Helius (Solana) and
 *     Etherscan v2 (EVM)
 *
 * Output is a single chronologically sorted list. Each entry has a stable
 * `id` (so we can dedupe in the UI if needed) and a discriminated `kind`
 * field describing what it represents.
 *
 * Auth: requires the caller's Supabase JWT. Vision Wallet addresses are
 * loaded from `vision_wallets` for the user.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type ActivityItem =
  | {
      id: string;
      kind: "tx_event";
      subKind: string; // tx_events.kind
      at: string;
      signature: string | null;
      walletAddress: string | null;
      valueUsd: number | null;
      inputMint: string | null;
      outputMint: string | null;
      inputAmount: number | null;
      outputAmount: number | null;
      recipient: string | null;
      explorerUrl: string | null;
    }
  | {
      id: string;
      kind: "deposit";
      chain: "solana" | "evm";
      chainId?: number;
      at: string;
      signature: string;
      from: string | null;
      asset: string;
      amountUi: number | null;
      explorerUrl: string;
    };

const SOLANA_EXPLORER = (sig: string) => `https://solscan.io/tx/${sig}`;

const EVM_EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  10: "https://optimistic.etherscan.io",
  56: "https://bscscan.com",
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
  42161: "https://arbiscan.io",
  43114: "https://snowtrace.io",
  59144: "https://lineascan.build",
  534352: "https://scrollscan.com",
  324: "https://explorer.zksync.io",
};

// Etherscan v2 supports all major chains via single endpoint when you pass chainid.
// https://docs.etherscan.io/etherscan-v2
const EVM_CHAINS_FOR_DEPOSIT_SCAN = [1, 8453, 42161, 10, 137, 56];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const supaAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supaAuth.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Not authenticated" }, 401);
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // Parse pagination params from body (best-effort).
    let before: string | null = null;
    let limit = 30;
    try {
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        if (typeof b.before === "string" && b.before.length > 0) before = b.before;
        if (typeof b.limit === "number" && b.limit > 0 && b.limit <= 100) {
          limit = Math.floor(b.limit);
        }
      }
    } catch { /* default */ }

    // 1. Look up Vision Wallet addresses
    const { data: walletRow } = await admin
      .from("vision_wallets")
      .select("solana_address, evm_address")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    const solanaAddress = walletRow?.solana_address ?? null;
    const evmAddress = walletRow?.evm_address ?? null;

    // 2. Query tx_events for the user (server-recorded actions). We fetch
    //    `limit + 1` so we know if there's a next page.
    let txQuery = admin
      .from("tx_events")
      .select(
        "id, created_at, signature, kind, value_usd, input_mint, output_mint, input_amount, output_amount, recipient, wallet_address, metadata",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (before) txQuery = txQuery.lt("created_at", before);
    const { data: txRows } = await txQuery;

    const rowsForPage = (txRows ?? []).slice(0, limit);
    const hasMore = (txRows ?? []).length > limit;
    const nextCursor = hasMore && rowsForPage.length > 0
      ? rowsForPage[rowsForPage.length - 1].created_at
      : null;

    const txItems: ActivityItem[] = rowsForPage.map((r) => ({
      id: `tx:${r.id}`,
      kind: "tx_event",
      subKind: String(r.kind),
      at: r.created_at,
      signature: r.signature,
      walletAddress: r.wallet_address,
      valueUsd: r.value_usd,
      inputMint: r.input_mint,
      outputMint: r.output_mint,
      inputAmount: r.input_amount,
      outputAmount: r.output_amount,
      recipient: r.recipient,
      metadata: (r as { metadata?: unknown }).metadata ?? null,
      explorerUrl: r.signature && r.signature.length >= 64
        ? r.signature.startsWith("0x")
          ? null // EVM tx hash — we'd need the chain to build URL; skip for now
          : SOLANA_EXPLORER(r.signature)
        : null,
    }));

    // 3. Fetch on-chain deposits ONLY on the first page (when no cursor).
    //    Deposits are inherently a "latest snapshot" feed — paging them
    //    alongside tx_events would cause weird overlaps.
    const [solanaDeposits, evmDeposits] = before
      ? [[], []]
      : await Promise.all([
          solanaAddress ? fetchSolanaDeposits(solanaAddress).catch(() => []) : Promise.resolve([]),
          evmAddress ? fetchEvmDeposits(evmAddress).catch(() => []) : Promise.resolve([]),
        ]);

    // 4. Merge + sort (newest first)
    const all = [...txItems, ...solanaDeposits, ...evmDeposits];
    all.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return json({
      items: all,
      nextCursor,
      hasMore,
      counts: {
        tx_events: txItems.length,
        solana_deposits: solanaDeposits.length,
        evm_deposits: evmDeposits.length,
      },
    });
  } catch (e) {
    console.error("wallet-activity error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ---------- Solana deposits via Helius enhanced transactions ----------

async function fetchSolanaDeposits(address: string): Promise<ActivityItem[]> {
  const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
  if (!HELIUS_API_KEY) return [];

  const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_API_KEY}&limit=25`;
  const r = await fetch(url);
  if (!r.ok) {
    console.warn("helius transactions failed", r.status);
    return [];
  }
  const data = (await r.json()) as Array<Record<string, unknown>>;

  const items: ActivityItem[] = [];
  for (const tx of data ?? []) {
    const sig = String(tx.signature ?? "");
    const ts = Number(tx.timestamp ?? 0);
    if (!sig || !ts) continue;
    const at = new Date(ts * 1000).toISOString();

    // Native SOL transfers
    const nativeTransfers =
      (tx.nativeTransfers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const t of nativeTransfers) {
      if (String(t.toUserAccount ?? "") === address) {
        const lamports = Number(t.amount ?? 0);
        if (lamports <= 0) continue;
        items.push({
          id: `sol-deposit:${sig}:${t.fromUserAccount}:${lamports}`,
          kind: "deposit",
          chain: "solana",
          at,
          signature: sig,
          from: String(t.fromUserAccount ?? "") || null,
          asset: "SOL",
          amountUi: lamports / 1_000_000_000,
          explorerUrl: SOLANA_EXPLORER(sig),
        });
      }
    }

    // SPL token transfers
    const tokenTransfers =
      (tx.tokenTransfers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const t of tokenTransfers) {
      if (String(t.toUserAccount ?? "") === address) {
        const tokenAmount = Number(t.tokenAmount ?? 0);
        if (tokenAmount <= 0) continue;
        const mint = String(t.mint ?? "");
        items.push({
          id: `spl-deposit:${sig}:${mint}:${t.fromUserAccount}:${tokenAmount}`,
          kind: "deposit",
          chain: "solana",
          at,
          signature: sig,
          from: String(t.fromUserAccount ?? "") || null,
          asset: mint, // Client can resolve to symbol via existing token info APIs
          amountUi: tokenAmount,
          explorerUrl: SOLANA_EXPLORER(sig),
        });
      }
    }
  }
  return items;
}

// ---------- EVM deposits via Etherscan v2 ----------

async function fetchEvmDeposits(address: string): Promise<ActivityItem[]> {
  const ETHERSCAN_API_KEY = Deno.env.get("ETHERSCAN_API_KEY");
  if (!ETHERSCAN_API_KEY) return [];

  const items: ActivityItem[] = [];

  // Etherscan v2 unified endpoint — one key, all supported chains.
  // We only fetch native txs per chain to keep this snappy. ERC-20
  // deposit detection per chain would multiply requests; leaving for v2.
  await Promise.all(
    EVM_CHAINS_FOR_DEPOSIT_SCAN.map(async (chainId) => {
      try {
        const u = new URL("https://api.etherscan.io/v2/api");
        u.searchParams.set("chainid", String(chainId));
        u.searchParams.set("module", "account");
        u.searchParams.set("action", "txlist");
        u.searchParams.set("address", address);
        u.searchParams.set("startblock", "0");
        u.searchParams.set("endblock", "99999999");
        u.searchParams.set("page", "1");
        u.searchParams.set("offset", "10");
        u.searchParams.set("sort", "desc");
        u.searchParams.set("apikey", ETHERSCAN_API_KEY);

        const r = await fetch(u.toString());
        if (!r.ok) return;
        const data = await r.json();
        if (data.status !== "1" || !Array.isArray(data.result)) return;

        const explorerBase = EVM_EXPLORERS[chainId] ?? "https://etherscan.io";

        for (const tx of data.result.slice(0, 10)) {
          const to = String(tx.to ?? "").toLowerCase();
          const from = String(tx.from ?? "").toLowerCase();
          if (to !== address.toLowerCase()) continue;
          if (from === address.toLowerCase()) continue;
          const value = BigInt(String(tx.value ?? "0"));
          if (value === 0n) continue;
          const ts = Number(tx.timeStamp ?? 0);
          if (!ts) continue;
          items.push({
            id: `evm-deposit:${chainId}:${tx.hash}`,
            kind: "deposit",
            chain: "evm",
            chainId,
            at: new Date(ts * 1000).toISOString(),
            signature: String(tx.hash),
            from: tx.from,
            asset: "native",
            amountUi: Number(value) / 1e18,
            explorerUrl: `${explorerBase}/tx/${tx.hash}`,
          });
        }
      } catch (e) {
        console.warn(`etherscan chain ${chainId} failed`, e);
      }
    }),
  );

  return items;
}
