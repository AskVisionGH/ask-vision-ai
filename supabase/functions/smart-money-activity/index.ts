import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface WalletMeta {
  address: string;
  label: string;
  twitterHandle: string | null;
  category: string | null;
  isCurated: boolean;
  isUserAdded: boolean;
}

interface RawTrade {
  wallet: WalletMeta;
  side: "buy" | "sell";
  tokenMint: string;
  tokenAmount: number;
  /** Best-effort USD value at trade time. */
  valueUsd: number | null;
  timestamp: number;
  signature: string;
  source: string | null;
}

interface WalletTradeSummary {
  wallet: WalletMeta;
  side: "buy" | "sell";
  count: number;
  totalUsd: number;
  totalAmount: number;
  /** Most recent trade in this group — drives the tx link. */
  latestTimestamp: number;
  latestSignature: string;
}

interface TokenActivity {
  token: {
    symbol: string;
    name: string;
    address: string;
    logo: string | null;
    pairUrl: string | null;
    priceUsd: number | null;
  };
  netUsd: number;
  buyUsd: number;
  sellUsd: number;
  buyerCount: number;
  sellerCount: number;
  totalTradeCount: number;
  latestTimestamp: number;
  /** All wallet-level summaries for this token, sorted by USD desc. */
  wallets: WalletTradeSummary[];
}

interface ActivityResponse {
  tokens: TokenActivity[];
  walletsTracked: number;
  walletsActive: number;
  totalTrades: number;
  windowHours: number;
  fetchedAt: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter lists
// ─────────────────────────────────────────────────────────────────────────────

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",  // USDH
  "BoZoQQRAmYkr5iJhqo7DChAs7DPDwEZ5cv1vkYC9yzJB", // pyUSD-style mistakes
]);

/**
 * Aggregator/router program addresses that often show up as the *receiver*
 * when a tracked wallet routes a swap through them. These are noise — the
 * tracked wallet is the actor, not these. We filter trades whose wallet
 * matches one of these (defensive — should never happen) and we filter
 * tokens whose mint matches (also defensive).
 */
const NOISE_ADDRESSES = new Set<string>([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",  // Jupiter v6 program
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",  // Jupiter v4
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP", // Raydium CLMM
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",   // Orca whirlpool
]);

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: { userId?: string | null; windowHours?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
  if (!HELIUS_API_KEY) return json({ error: "HELIUS_API_KEY not configured" }, 500);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Backend misconfigured" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const requested = Number(body.windowHours);
  const windowHours = Number.isFinite(requested) && requested > 0 && requested <= 168
    ? Math.floor(requested)
    : 24;
  const windowSec = windowHours * 3600;
  const cutoff = Math.floor(Date.now() / 1000) - windowSec;

  try {
    // 1. Load tracked wallet roster (curated + user)
    const wallets = await loadWallets(supabase, body.userId ?? null);
    if (wallets.size === 0) {
      return json({
        tokens: [],
        walletsTracked: 0,
        walletsActive: 0,
        totalTrades: 0,
        windowHours,
        fetchedAt: Date.now(),
        error: "No wallets to track yet.",
      });
    }

    // 2. Sample wallets. Prioritize user-added, then curated traders/KOLs/founders.
    //    Skip categories that don't actively trade (protocol treasuries,
    //    market makers, VCs) and filter out invalid placeholder addresses.
    const NON_TRADING_CATEGORIES = new Set(["protocol", "mm", "vc"]);
    const sortedWallets = [...wallets.values()]
      .filter((w) => BASE58_RE.test(w.address))
      .filter((w) => !NOISE_ADDRESSES.has(w.address))
      .filter((w) => w.isUserAdded || !NON_TRADING_CATEGORIES.has(w.category ?? ""))
      .sort((a, b) => {
        const aScore = (a.isUserAdded ? 2 : 0) + (a.isCurated ? 1 : 0);
        const bScore = (b.isUserAdded ? 2 : 0) + (b.isCurated ? 1 : 0);
        return bScore - aScore;
      })
      .slice(0, 18);

    // 3. Fetch wallet activity with a conservative concurrency limit so we
    //    don't get Helius 429s and collapse to an empty result set.
    const rawTrades: RawTrade[] = [];
    for (let i = 0; i < sortedWallets.length; i += 6) {
      const batch = sortedWallets.slice(i, i + 6);
      const results = await Promise.allSettled(
        batch.map((meta) => fetchWalletTrades(meta, HELIUS_API_KEY, cutoff)),
      );
      for (const r of results) {
        if (r.status === "fulfilled") rawTrades.push(...r.value);
      }
    }

    // 4. Filter noise: skip pure SOL/stable transfers (they have no token side
    //    with a real mint) and aggregator pubkeys (defensive).
    const meaningful = rawTrades.filter((t) => {
      if (!t.tokenMint) return false;
      if (t.tokenMint === SOL_MINT) return false;
      if (STABLE_MINTS.has(t.tokenMint)) return false;
      if (NOISE_ADDRESSES.has(t.tokenMint)) return false;
      return true;
    });

    // 5. Backfill USD for trades that don't have it (token-out swaps where
    //    the input wasn't SOL/stable).
    const mintsNeedingPrice = new Set<string>();
    for (const t of meaningful) {
      if (t.valueUsd == null && t.tokenAmount > 0) mintsNeedingPrice.add(t.tokenMint);
    }
    const tokenInfo = await lookupTokens([...mintsNeedingPrice, ...new Set(meaningful.map((t) => t.tokenMint))]);

    for (const t of meaningful) {
      if (t.valueUsd == null) {
        const info = tokenInfo.get(t.tokenMint);
        if (info?.priceUsd != null && t.tokenAmount > 0) {
          t.valueUsd = info.priceUsd * t.tokenAmount;
        }
      }
    }

    // 6. Group by token, then by wallet+side.
    const byToken = new Map<string, RawTrade[]>();
    for (const t of meaningful) {
      const list = byToken.get(t.tokenMint) ?? [];
      list.push(t);
      byToken.set(t.tokenMint, list);
    }

    const tokens: TokenActivity[] = [];
    for (const [mint, trades] of byToken) {
      const info = tokenInfo.get(mint);
      if (!info) continue; // token didn't resolve, skip rather than show "?"

      // Group by wallet+side
      const groupKey = (t: RawTrade) => `${t.wallet.address}|${t.side}`;
      const groups = new Map<string, WalletTradeSummary>();
      for (const t of trades) {
        const k = groupKey(t);
        const existing = groups.get(k);
        if (!existing) {
          groups.set(k, {
            wallet: t.wallet,
            side: t.side,
            count: 1,
            totalUsd: t.valueUsd ?? 0,
            totalAmount: t.tokenAmount,
            latestTimestamp: t.timestamp,
            latestSignature: t.signature,
          });
          continue;
        }
        existing.count += 1;
        existing.totalUsd += t.valueUsd ?? 0;
        existing.totalAmount += t.tokenAmount;
        if (t.timestamp > existing.latestTimestamp) {
          existing.latestTimestamp = t.timestamp;
          existing.latestSignature = t.signature;
        }
      }

      const walletSummaries = [...groups.values()].sort((a, b) => b.totalUsd - a.totalUsd);
      const buyers = new Set(walletSummaries.filter((w) => w.side === "buy").map((w) => w.wallet.address));
      const sellers = new Set(walletSummaries.filter((w) => w.side === "sell").map((w) => w.wallet.address));
      const buyUsd = walletSummaries.filter((w) => w.side === "buy").reduce((acc, w) => acc + w.totalUsd, 0);
      const sellUsd = walletSummaries.filter((w) => w.side === "sell").reduce((acc, w) => acc + w.totalUsd, 0);
      const totalTradeCount = walletSummaries.reduce((acc, w) => acc + w.count, 0);
      const latestTimestamp = Math.max(...walletSummaries.map((w) => w.latestTimestamp));

      tokens.push({
        token: {
          symbol: info.symbol,
          name: info.name,
          address: mint,
          logo: info.logo,
          pairUrl: info.pairUrl,
          priceUsd: info.priceUsd,
        },
        netUsd: buyUsd - sellUsd,
        buyUsd,
        sellUsd,
        buyerCount: buyers.size,
        sellerCount: sellers.size,
        totalTradeCount,
        latestTimestamp,
        wallets: walletSummaries,
      });
    }

    // 7. Rank tokens by total notional traded (|net| + a tiebreaker on
    //    count of distinct wallets, so a token traded by 5 wallets ranks
    //    above a token traded by 1 with the same notional).
    tokens.sort((a, b) => {
      const aScore = Math.abs(a.netUsd) + (a.buyerCount + a.sellerCount) * 100;
      const bScore = Math.abs(b.netUsd) + (b.buyerCount + b.sellerCount) * 100;
      return bScore - aScore;
    });

    const walletsActive = new Set(meaningful.map((t) => t.wallet.address)).size;

    const response: ActivityResponse = {
      tokens: tokens.slice(0, 20),
      walletsTracked: sortedWallets.length,
      walletsActive,
      totalTrades: meaningful.length,
      windowHours,
      fetchedAt: Date.now(),
    };
    return json(response);
  } catch (e) {
    console.error("[smart-money-activity] fatal", e);
    return json({
      tokens: [],
      walletsTracked: 0,
      walletsActive: 0,
      totalTrades: 0,
      windowHours,
      fetchedAt: Date.now(),
      error: "Couldn't fetch smart-money activity right now.",
    });
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet roster
// ─────────────────────────────────────────────────────────────────────────────

async function loadWallets(supabase: ReturnType<typeof createClient>, userId: string | null) {
  const wallets = new Map<string, WalletMeta>();

  // 1. Curated seed (always present).
  const { data: curated } = await supabase
    .from("smart_wallets_global_seed")
    .select("address, label, twitter_handle, category");

  for (const row of curated ?? []) {
    wallets.set(row.address, {
      address: row.address,
      label: row.label,
      twitterHandle: row.twitter_handle,
      category: row.category,
      isCurated: true,
      isUserAdded: false,
    });
  }

  // 2. Live top-traders from Birdeye (this-week PnL leaders). This keeps
  //    the roster fresh as the market rotates without us having to
  //    re-curate the seed by hand. Cached for 6h to avoid burning API quota.
  const birdeyeTraders = await fetchBirdeyeTopTraders();
  for (const trader of birdeyeTraders) {
    if (wallets.has(trader.address)) continue;
    wallets.set(trader.address, {
      address: trader.address,
      label: trader.label,
      twitterHandle: null,
      category: "trader",
      isCurated: true,
      isUserAdded: false,
    });
  }

  // 3. User-added wallets (highest priority).
  if (userId) {
    const { data: usr } = await supabase
      .from("smart_wallets")
      .select("address, label, twitter_handle")
      .eq("user_id", userId);
    for (const row of usr ?? []) {
      const existing = wallets.get(row.address);
      if (existing) {
        existing.isUserAdded = true;
      } else {
        wallets.set(row.address, {
          address: row.address,
          label: row.label,
          twitterHandle: row.twitter_handle,
          category: null,
          isCurated: false,
          isUserAdded: true,
        });
      }
    }
  }

  return wallets;
}

// ─────────────────────────────────────────────────────────────────────────────
// Birdeye top-traders feed
// ─────────────────────────────────────────────────────────────────────────────

interface BirdeyeTrader {
  address: string;
  label: string;
  pnl: number;
}

let birdeyeCache: { fetchedAt: number; traders: BirdeyeTrader[] } | null = null;
const BIRDEYE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function fetchBirdeyeTopTraders(): Promise<BirdeyeTrader[]> {
  const now = Date.now();
  if (birdeyeCache && now - birdeyeCache.fetchedAt < BIRDEYE_TTL_MS) {
    return birdeyeCache.traders;
  }

  const apiKey = Deno.env.get("BIRDEYE_API_KEY");
  if (!apiKey) return [];

  // Pull both gainers (this week) and yesterday for breadth. 10 per call is
  // the max — we make two calls to get up to ~20 unique traders.
  const traders: BirdeyeTrader[] = [];
  const seen = new Set<string>();

  for (const type of ["1W", "yesterday"] as const) {
    try {
      const url =
        `https://public-api.birdeye.so/trader/gainers-losers` +
        `?type=${type}&sort_by=PnL&sort_type=desc&offset=0&limit=10`;
      const resp = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-API-KEY": apiKey,
          "x-chain": "solana",
        },
      });
      if (!resp.ok) {
        console.error(`[smart-money-activity] Birdeye ${type} HTTP`, resp.status);
        continue;
      }
      const data = await resp.json();
      const items = data?.data?.items;
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        if (!it?.address || seen.has(it.address)) continue;
        seen.add(it.address);
        traders.push({
          address: it.address,
          label: `Top trader (${type === "1W" ? "7d" : "1d"})`,
          pnl: Number(it?.pnl ?? 0),
        });
      }
    } catch (e) {
      console.error(`[smart-money-activity] Birdeye ${type} error`, e);
    }
  }

  birdeyeCache = { fetchedAt: now, traders };
  return traders;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-wallet trade extraction from Helius
// ─────────────────────────────────────────────────────────────────────────────

async function fetchWalletTrades(
  meta: WalletMeta,
  apiKey: string,
  cutoff: number,
): Promise<RawTrade[]> {
  const txs = await fetchEnhancedTxs(meta.address, apiKey, cutoff);
  const out: RawTrade[] = [];

  for (const tx of txs) {
    const ts = typeof tx?.timestamp === "number" ? tx.timestamp : 0;
    if (ts < cutoff) continue;

    const swap = tx?.events?.swap;
    if (!swap) continue;

    const outSide = pickSwapSide(swap.tokenOutputs, swap.nativeOutput, meta.address);
    const inSide = pickSwapSide(swap.tokenInputs, swap.nativeInput, meta.address);

    let side: "buy" | "sell" | null = null;
    let tokenSide: { mint: string; amount: number } | undefined;

    if (outSide && outSide.mint !== SOL_MINT && !STABLE_MINTS.has(outSide.mint)) {
      side = "buy";
      tokenSide = outSide;
    } else if (inSide && inSide.mint !== SOL_MINT && !STABLE_MINTS.has(inSide.mint)) {
      side = "sell";
      tokenSide = inSide;
    }

    if (!side || !tokenSide || !tx?.signature) continue;

    out.push({
      wallet: meta,
      side,
      tokenMint: tokenSide.mint,
      tokenAmount: tokenSide.amount,
      valueUsd: computeSwapUsd(inSide, outSide),
      timestamp: ts * 1000,
      signature: tx.signature,
      source: typeof tx?.source === "string" ? tx.source : null,
    });
  }

  return out;
}

async function fetchEnhancedTxs(address: string, apiKey: string, cutoff: number): Promise<any[]> {
  const out: any[] = [];
  let before: string | null = null;
  const PER_PAGE = 100;
  const MAX_PAGES = 4;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`https://api.helius.xyz/v0/addresses/${address}/transactions`);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("limit", String(PER_PAGE));
    if (before) url.searchParams.set("before", before);

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("[smart-money-activity] Helius enhanced txs error:", resp.status);
      break;
    }

    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) break;

    out.push(...data);
    before = data[data.length - 1]?.signature ?? null;
    const oldestTs = data[data.length - 1]?.timestamp ?? 0;
    if (!before || oldestTs < cutoff) break;
  }

  return out.filter((t) => (t.timestamp ?? 0) >= cutoff);
}

function pickSwapSide(
  tokenSide: any[] | undefined,
  nativeSide: any,
  owner: string,
): { mint: string; amount: number } | undefined {
  if (Array.isArray(tokenSide) && tokenSide.length > 0) {
    const involvingOwner = tokenSide.filter((t) =>
      t?.userAccount === owner || t?.fromUserAccount === owner || t?.toUserAccount === owner,
    );
    const candidates = involvingOwner.length > 0 ? involvingOwner : tokenSide;

    for (const t of candidates) {
      const raw = Number(t?.rawTokenAmount?.tokenAmount ?? 0);
      const decimals = Number(t?.rawTokenAmount?.decimals ?? 0);
      const uiAmount = Number(t?.tokenAmount?.uiAmount ?? t?.tokenAmount ?? 0);
      const amount = raw > 0 ? raw / Math.pow(10, decimals) : uiAmount;
      if (!Number.isFinite(amount) || amount <= 0 || !t?.mint) continue;
      return { mint: t.mint, amount };
    }
  }

  const nativeRaw = Number(nativeSide?.amount ?? nativeSide ?? 0);
  if (Number.isFinite(nativeRaw) && nativeRaw > 0) {
    return { mint: SOL_MINT, amount: nativeRaw / 1e9 };
  }

  return undefined;
}

function computeSwapUsd(
  inSide: { mint: string; amount: number } | undefined,
  outSide: { mint: string; amount: number } | undefined,
): number | null {
  if (inSide && STABLE_MINTS.has(inSide.mint)) return inSide.amount;
  if (outSide && STABLE_MINTS.has(outSide.mint)) return outSide.amount;
  if (inSide?.mint === SOL_MINT) return inSide.amount * 150;
  if (outSide?.mint === SOL_MINT) return outSide.amount * 150;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token metadata + price lookup (DexScreener)
// ─────────────────────────────────────────────────────────────────────────────

interface TokenInfo {
  symbol: string;
  name: string;
  logo: string | null;
  pairUrl: string | null;
  priceUsd: number | null;
}

async function lookupTokens(mints: string[]): Promise<Map<string, TokenInfo>> {
  const out = new Map<string, TokenInfo>();
  const unique = [...new Set(mints)];
  // DexScreener supports up to 30 mints per /tokens/ batch call.
  const chunkSize = 30;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
      // For each mint, pick the highest-liquidity Solana pair.
      const byMint = new Map<string, any[]>();
      for (const p of pairs) {
        if (p?.chainId !== "solana") continue;
        const baseAddr = p?.baseToken?.address;
        if (!baseAddr) continue;
        const list = byMint.get(baseAddr) ?? [];
        list.push(p);
        byMint.set(baseAddr, list);
      }
      for (const [mint, list] of byMint) {
        list.sort((a, b) => Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0));
        const top = list[0];
        out.set(mint, {
          symbol: top?.baseToken?.symbol ?? "?",
          name: top?.baseToken?.name ?? top?.baseToken?.symbol ?? "Unknown",
          logo: top?.info?.imageUrl ?? null,
          pairUrl: top?.url ?? null,
          priceUsd: top?.priceUsd ? Number(top.priceUsd) : null,
        });
      }
    } catch (e) {
      console.error("[lookupTokens] chunk failed", e);
    }
  }
  return out;
}
