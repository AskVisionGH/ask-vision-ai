// Wallet PnL & recent activity using Helius Enhanced Transactions API.
//
// Window: last 30 days, capped to ~500 most recent transactions per call.
// Returns:
//   - recent txs (parsed: swap | transfer_in | transfer_out | other)
//   - per-token PnL summary (cost, proceeds, realized, holdings + unrealized)
//   - overall totals
//
// The chat function picks one of three slices to send back to the client
// (recent_txs / token_pnl / wallet_pnl) but the heavy work is shared here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);
// "Quote" assets we can derive USD value from. Stables are 1:1; SOL gets a
// historical price lookup. Anything in here counts as the "money side" of a
// buy/sell — without this, SOL-funded buys are silently dropped from PnL.
const QUOTES = new Set<string>([...STABLES, SOL_MINT]);

const WINDOW_DAYS = 30;
const MAX_PAGES = 5;            // Helius caps at 100 per page
const PER_PAGE = 100;

interface ParsedTx {
  signature: string;
  timestamp: number;
  type: "swap" | "transfer_in" | "transfer_out" | "other";
  description: string | null;
  source: string | null;
  fee: number;
  /** Net token-level changes for the wallet, parsed for swap math. */
  inToken?: { mint: string; symbol: string; amount: number };
  outToken?: { mint: string; symbol: string; amount: number };
  /** SOL flowed for native transfers, signed (positive = received). */
  solChange?: number;
  /** Counterparty (best-effort) for transfers. */
  counterparty?: string | null;
  /** Stable-equivalent USD value if we can derive it from the swap pair. */
  valueUsd: number | null;
}

interface TokenPnL {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  buys: number;          // count
  sells: number;         // count
  costUsd: number;       // total stable-USD spent buying this token
  proceedsUsd: number;   // total stable-USD received selling
  unitsBought: number;
  unitsSold: number;
  currentUnits: number;  // from balance snapshot
  currentPriceUsd: number | null;
  currentValueUsd: number | null;
  realizedUsd: number;   // proceeds - cost basis of sold units (FIFO-ish via avg cost)
  unrealizedUsd: number; // currentValue - cost basis of held units
  pairUrl: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const address: string = (body.address ?? "").trim();
    const slice: "recent_txs" | "token_pnl" | "wallet_pnl" = body.slice ?? "wallet_pnl";
    const tokenFilter: string | null = body.tokenFilter ?? null;
    const limit: number = Math.min(Math.max(body.limit ?? 25, 5), 50);

    if (!address) return json({ error: "address required" }, 400);

    const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
    if (!HELIUS_API_KEY) return json({ error: "HELIUS_API_KEY missing" }, 500);

    const cutoff = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;

    // 1) Pull enhanced parsed txs (paginated, newest -> oldest until cutoff)
    const txs = await fetchEnhancedTxs(address, HELIUS_API_KEY, cutoff);

    // 2) Parse each tx into a normalised shape
    const parsed: ParsedTx[] = txs
      .map((t) => parseTx(t, address))
      .filter((p): p is ParsedTx => !!p);

    // 3) Snapshot current holdings (for unrealized + symbol/logo enrichment)
    const balance = await fetchBalanceSnapshot(address, HELIUS_API_KEY);

    // 3b) Backfill USD value for SOL-paired swaps using historical SOL price
    //     (so e.g. "bought $HENRY with SOL" still produces cost basis).
    await backfillSolValueUsd(parsed, balance);

    // 4) Compute per-token PnL
    const tokenPnL = computeTokenPnL(parsed, balance);

    // 5) Build totals
    const totals = {
      totalRealizedUsd: tokenPnL.reduce((s, t) => s + t.realizedUsd, 0),
      totalUnrealizedUsd: tokenPnL.reduce((s, t) => s + t.unrealizedUsd, 0),
      totalCostUsd: tokenPnL.reduce((s, t) => s + t.costUsd, 0),
      totalProceedsUsd: tokenPnL.reduce((s, t) => s + t.proceedsUsd, 0),
      currentPortfolioUsd: balance.totalUsd,
      txCount: parsed.length,
    };

    if (slice === "recent_txs") {
      return json({
        address,
        windowDays: WINDOW_DAYS,
        txs: parsed.slice(0, limit),
        totalCount: parsed.length,
      });
    }

    if (slice === "token_pnl" && tokenFilter) {
      const target = tokenFilter.toLowerCase();
      const match = tokenPnL.find(
        (t) =>
          t.mint.toLowerCase() === target ||
          t.symbol.toLowerCase() === target.replace(/^\$/, ""),
      );
      return json({
        address,
        windowDays: WINDOW_DAYS,
        token: match ?? null,
        recentTxs: parsed
          .filter(
            (p) =>
              (p.inToken && p.inToken.mint.toLowerCase() === (match?.mint.toLowerCase() ?? "")) ||
              (p.outToken && p.outToken.mint.toLowerCase() === (match?.mint.toLowerCase() ?? "")),
          )
          .slice(0, 10),
      });
    }

    // Default: wallet_pnl dashboard
    return json({
      address,
      windowDays: WINDOW_DAYS,
      totals,
      tokens: tokenPnL
        .filter((t) => Math.abs(t.realizedUsd) + Math.abs(t.unrealizedUsd) + (t.currentValueUsd ?? 0) > 0.5)
        .sort(
          (a, b) =>
            Math.abs(b.realizedUsd + b.unrealizedUsd) - Math.abs(a.realizedUsd + a.unrealizedUsd),
        )
        .slice(0, 12),
      recentTxs: parsed.slice(0, 10),
    });
  } catch (e) {
    console.error("wallet-pnl error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ------------------------------ Helpers ------------------------------

async function fetchEnhancedTxs(
  address: string,
  apiKey: string,
  cutoff: number,
): Promise<any[]> {
  const out: any[] = [];
  let before: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`https://api.helius.xyz/v0/addresses/${address}/transactions`);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("limit", String(PER_PAGE));
    if (before) url.searchParams.set("before", before);

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("Helius enhanced txs error:", resp.status, await resp.text().catch(() => ""));
      break;
    }
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) break;

    out.push(...data);
    before = data[data.length - 1]?.signature ?? null;

    const oldestTs = data[data.length - 1]?.timestamp ?? 0;
    if (!before || oldestTs < cutoff) break;
  }
  // Filter to window strictly
  return out.filter((t) => (t.timestamp ?? 0) >= cutoff);
}

interface BalanceSnapshot {
  totalUsd: number;
  byMint: Map<
    string,
    { units: number; symbol: string; name: string; logo: string | null; priceUsd: number | null }
  >;
}

async function fetchBalanceSnapshot(address: string, apiKey: string): Promise<BalanceSnapshot> {
  const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const out: BalanceSnapshot = { totalUsd: 0, byMint: new Map() };

  try {
    const resp = await fetch(heliusUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "vision-pnl",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: address,
          page: 1,
          limit: 1000,
          displayOptions: { showFungible: true, showNativeBalance: true },
        },
      }),
    });
    if (!resp.ok) return out;
    const data = await resp.json();
    const items = data.result?.items ?? [];
    const native = data.result?.nativeBalance;

    if (native && native.lamports > 0) {
      const units = native.lamports / 1e9;
      const price = native.price_per_sol ?? null;
      out.byMint.set(SOL_MINT, {
        units,
        symbol: "SOL",
        name: "Solana",
        logo:
          "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
        priceUsd: price,
      });
      if (native.total_price) out.totalUsd += native.total_price;
    }

    for (const item of items) {
      if (item.interface !== "FungibleToken" && item.interface !== "FungibleAsset") continue;
      const info = item.token_info;
      if (!info?.balance || info.balance === 0) continue;
      const decimals = info.decimals ?? 0;
      const units = Number(info.balance) / Math.pow(10, decimals);
      const priceUsd = info.price_info?.price_per_token ?? null;
      out.byMint.set(item.id, {
        units,
        symbol: info.symbol ?? "?",
        name: item.content?.metadata?.name ?? info.symbol ?? "Unknown",
        logo: item.content?.links?.image ?? null,
        priceUsd,
      });
      if (info.price_info?.total_price) out.totalUsd += info.price_info.total_price;
    }
  } catch (e) {
    console.error("balance snapshot error:", e);
  }
  return out;
}

function parseTx(t: any, owner: string): ParsedTx | null {
  if (!t?.signature || !t?.timestamp) return null;

  const base: ParsedTx = {
    signature: t.signature,
    timestamp: t.timestamp,
    type: "other",
    description: typeof t.description === "string" ? t.description : null,
    source: t.source ?? null,
    fee: typeof t.fee === "number" ? t.fee / 1e9 : 0,
    valueUsd: null,
  };

  // 1) SWAP — Helius's `events.swap` is the cleanest signal
  const swap = t.events?.swap;
  if (swap && (swap.tokenInputs?.length || swap.nativeInput || swap.tokenOutputs?.length || swap.nativeOutput)) {
    base.type = "swap";

    // Output side (what wallet received)
    const outSide = pickSwapSide(swap.tokenOutputs, swap.nativeOutput, owner, "out");
    // Input side (what wallet spent)
    const inSide = pickSwapSide(swap.tokenInputs, swap.nativeInput, owner, "in");

    if (outSide) base.outToken = outSide; // received
    if (inSide) base.inToken = inSide;    // spent

    // Compute value in USD if either leg is a stable
    base.valueUsd = computeSwapUsd(inSide, outSide);
    return base;
  }

  // 2) Native SOL transfer
  if (Array.isArray(t.nativeTransfers) && t.nativeTransfers.length) {
    let net = 0;
    let counter: string | null = null;
    for (const nt of t.nativeTransfers) {
      const amt = (nt.amount ?? 0) / 1e9;
      if (nt.toUserAccount === owner) {
        net += amt;
        counter = counter ?? nt.fromUserAccount ?? null;
      } else if (nt.fromUserAccount === owner) {
        net -= amt;
        counter = counter ?? nt.toUserAccount ?? null;
      }
    }
    if (Math.abs(net) > 0.000001) {
      base.type = net > 0 ? "transfer_in" : "transfer_out";
      base.solChange = net;
      base.counterparty = counter;
      base.outToken = net < 0 ? { mint: SOL_MINT, symbol: "SOL", amount: Math.abs(net) } : undefined;
      base.inToken = net > 0 ? { mint: SOL_MINT, symbol: "SOL", amount: net } : undefined;
      return base;
    }
  }

  // 3) SPL token transfer
  if (Array.isArray(t.tokenTransfers) && t.tokenTransfers.length) {
    for (const tt of t.tokenTransfers) {
      const amt = Number(tt.tokenAmount ?? 0);
      if (!amt) continue;
      if (tt.toUserAccount === owner) {
        base.type = "transfer_in";
        base.inToken = { mint: tt.mint, symbol: shortMint(tt.mint), amount: amt };
        base.counterparty = tt.fromUserAccount ?? null;
        return base;
      }
      if (tt.fromUserAccount === owner) {
        base.type = "transfer_out";
        base.outToken = { mint: tt.mint, symbol: shortMint(tt.mint), amount: amt };
        base.counterparty = tt.toUserAccount ?? null;
        return base;
      }
    }
  }

  return base; // other
}

function pickSwapSide(
  tokenSide: any[] | undefined,
  nativeSide: any,
  owner: string,
  direction: "in" | "out",
): { mint: string; symbol: string; amount: number } | undefined {
  // Prefer the token leg that involves the owner
  if (Array.isArray(tokenSide)) {
    for (const t of tokenSide) {
      const involvesOwner =
        t.userAccount === owner ||
        t.fromUserAccount === owner ||
        t.toUserAccount === owner ||
        // For inputs, the wallet sourced these; for outputs, the wallet received.
        true;
      if (!involvesOwner) continue;
      const raw = Number(t.rawTokenAmount?.tokenAmount ?? 0);
      const decimals = Number(t.rawTokenAmount?.decimals ?? 0);
      if (!raw) continue;
      return {
        mint: t.mint,
        symbol: shortMint(t.mint),
        amount: raw / Math.pow(10, decimals),
      };
    }
  }
  // Native SOL leg
  if (nativeSide && (nativeSide.amount ?? nativeSide) > 0) {
    const raw = Number(nativeSide.amount ?? nativeSide);
    return { mint: SOL_MINT, symbol: "SOL", amount: raw / 1e9 };
  }
  return undefined;
}

function computeSwapUsd(
  inSide: { mint: string; amount: number } | undefined,
  outSide: { mint: string; amount: number } | undefined,
): number | null {
  // If one side is a stable, use it directly as the USD value
  if (inSide && STABLES.has(inSide.mint)) return inSide.amount;
  if (outSide && STABLES.has(outSide.mint)) return outSide.amount;
  return null; // unknown until we cross-reference price (kept null for honesty)
}

function computeTokenPnL(parsed: ParsedTx[], balance: BalanceSnapshot): TokenPnL[] {
  const map = new Map<string, TokenPnL>();

  const ensure = (mint: string, symbol: string): TokenPnL => {
    let row = map.get(mint);
    if (row) return row;
    const meta = balance.byMint.get(mint);
    row = {
      mint,
      symbol: meta?.symbol ?? symbol,
      name: meta?.name ?? symbol,
      logo: meta?.logo ?? null,
      buys: 0,
      sells: 0,
      costUsd: 0,
      proceedsUsd: 0,
      unitsBought: 0,
      unitsSold: 0,
      currentUnits: meta?.units ?? 0,
      currentPriceUsd: meta?.priceUsd ?? null,
      currentValueUsd: meta && meta.priceUsd != null ? meta.units * meta.priceUsd : null,
      realizedUsd: 0,
      unrealizedUsd: 0,
      pairUrl: null,
    };
    map.set(mint, row);
    return row;
  };

  // First pass: aggregate buys/sells from swaps with known USD value
  for (const tx of parsed) {
    if (tx.type !== "swap" || tx.valueUsd == null) continue;

    // BUY: wallet RECEIVED a non-stable token, paid in stable
    if (tx.outToken && !STABLES.has(tx.outToken.mint) && tx.inToken && STABLES.has(tx.inToken.mint)) {
      const row = ensure(tx.outToken.mint, tx.outToken.symbol);
      row.buys += 1;
      row.costUsd += tx.valueUsd;
      row.unitsBought += tx.outToken.amount;
    }
    // SELL: wallet SENT a non-stable token, received stable
    if (tx.inToken && !STABLES.has(tx.inToken.mint) && tx.outToken && STABLES.has(tx.outToken.mint)) {
      const row = ensure(tx.inToken.mint, tx.inToken.symbol);
      row.sells += 1;
      row.proceedsUsd += tx.valueUsd;
      row.unitsSold += tx.inToken.amount;
    }
  }

  // Add current holdings that had no recorded activity (still want them visible)
  for (const [mint, meta] of balance.byMint.entries()) {
    if (!map.has(mint) && (meta.priceUsd ?? 0) * meta.units > 1) {
      ensure(mint, meta.symbol);
    }
  }

  // Compute realized/unrealized using average cost basis
  for (const row of map.values()) {
    const avgCost = row.unitsBought > 0 ? row.costUsd / row.unitsBought : 0;
    const costOfSold = avgCost * row.unitsSold;
    row.realizedUsd = row.proceedsUsd - costOfSold;
    const heldCostBasis = avgCost * Math.max(row.currentUnits, 0);
    row.unrealizedUsd = (row.currentValueUsd ?? 0) - heldCostBasis;
    row.pairUrl = `https://dexscreener.com/solana/${row.mint}`;
  }

  return [...map.values()];
}

function shortMint(m: string): string {
  if (!m) return "?";
  return m.length > 8 ? `${m.slice(0, 4)}…${m.slice(-4)}` : m;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
