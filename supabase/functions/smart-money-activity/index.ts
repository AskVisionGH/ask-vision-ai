import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface WalletMeta {
  address: string;
  label: string;
  twitterHandle: string | null;
  category: string | null;
  notes: string | null;
  isCurated: boolean;
  isUserAdded: boolean;
}

interface WalletTradeSummary {
  wallet: WalletMeta;
  side: "buy" | "sell";
  count: number;
  totalUsd: number;
  totalAmount: number;
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
  wallets: WalletTradeSummary[];
}

interface TradeRow {
  wallet_address: string;
  wallet_label: string;
  wallet_twitter_handle: string | null;
  wallet_category: string | null;
  wallet_notes: string | null;
  wallet_is_curated: boolean;
  side: "buy" | "sell";
  token_mint: string;
  token_amount: number;
  value_usd: number | null;
  signature: string;
  block_time: string;
  source: string | null;
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: { userId?: string | null; windowHours?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Backend misconfigured" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const requested = Number(body.windowHours);
  const windowHours = Number.isFinite(requested) && requested > 0 && requested <= 168
    ? Math.floor(requested)
    : 24;
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
  const fetchedAt = Date.now();

  try {
    // 1. Pull all trades inside the window in one query. Cap at 5000 to
    //    keep memory bounded; for 7d * ~150 wallets this is more than
    //    enough headroom.
    const { data: trades, error } = await supabase
      .from("smart_money_trades")
      .select("*")
      .gte("block_time", cutoff)
      .order("block_time", { ascending: false })
      .limit(5000);

    if (error) {
      console.error("[smart-money-activity] DB error", error);
      return json({
        tokens: [], walletsTracked: 0, walletsActive: 0, totalTrades: 0,
        windowHours, fetchedAt, error: "Couldn't fetch smart-money activity right now.",
      });
    }

    const rows = (trades ?? []) as TradeRow[];

    // 2. Identify which user-added wallets exist so we can tag them.
    const userWalletSet = new Set<string>();
    if (body.userId) {
      const { data: usr } = await supabase
        .from("smart_wallets")
        .select("address")
        .eq("user_id", body.userId);
      for (const r of usr ?? []) userWalletSet.add(r.address);
    }

    // 3. Filter noise.
    const meaningful = rows.filter((t) =>
      t.token_mint &&
      t.token_mint !== SOL_MINT &&
      !STABLE_MINTS.has(t.token_mint),
    );

    if (meaningful.length === 0) {
      // Total wallets known to the system (rough denominator for the UI).
      const { count: walletsTracked } = await supabase
        .from("smart_money_sync_state")
        .select("wallet_address", { count: "exact", head: true });
      return json({
        tokens: [], walletsTracked: walletsTracked ?? 0, walletsActive: 0,
        totalTrades: 0, windowHours, fetchedAt,
      });
    }

    // 4. Hydrate token info (symbol, name, logo, price) via DexScreener.
    const uniqueMints = [...new Set(meaningful.map((t) => t.token_mint))];
    const tokenInfo = await lookupTokens(uniqueMints);

    // 5. Backfill USD where the trade row has no price (e.g. token-for-token
    //    swap that didn't touch SOL/stable).
    for (const t of meaningful) {
      if (t.value_usd == null) {
        const info = tokenInfo.get(t.token_mint);
        if (info?.priceUsd != null && t.token_amount > 0) {
          t.value_usd = info.priceUsd * t.token_amount;
        }
      }
    }

    // 6. Group by token, then by wallet+side.
    const byToken = new Map<string, TradeRow[]>();
    for (const t of meaningful) {
      const list = byToken.get(t.token_mint) ?? [];
      list.push(t);
      byToken.set(t.token_mint, list);
    }

    const tokens: TokenActivity[] = [];
    for (const [mint, group] of byToken) {
      const info = tokenInfo.get(mint);
      if (!info) continue;

      const groups = new Map<string, WalletTradeSummary>();
      for (const t of group) {
        const meta: WalletMeta = {
          address: t.wallet_address,
          label: t.wallet_label,
          twitterHandle: t.wallet_twitter_handle,
          category: t.wallet_category,
          notes: t.wallet_notes,
          isCurated: t.wallet_is_curated,
          isUserAdded: userWalletSet.has(t.wallet_address),
        };
        const k = `${t.wallet_address}|${t.side}`;
        const ts = new Date(t.block_time).getTime();
        const existing = groups.get(k);
        if (!existing) {
          groups.set(k, {
            wallet: meta,
            side: t.side,
            count: 1,
            totalUsd: t.value_usd ?? 0,
            totalAmount: Number(t.token_amount),
            latestTimestamp: ts,
            latestSignature: t.signature,
          });
          continue;
        }
        existing.count += 1;
        existing.totalUsd += t.value_usd ?? 0;
        existing.totalAmount += Number(t.token_amount);
        if (ts > existing.latestTimestamp) {
          existing.latestTimestamp = ts;
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

    // 7. Rank: |net| weighted by distinct-wallet count.
    tokens.sort((a, b) => {
      const aScore = Math.abs(a.netUsd) + (a.buyerCount + a.sellerCount) * 100;
      const bScore = Math.abs(b.netUsd) + (b.buyerCount + b.sellerCount) * 100;
      return bScore - aScore;
    });

    const walletsActive = new Set(meaningful.map((t) => t.wallet_address)).size;

    // Total roster size (for the "X/Y wallets active" copy in the UI).
    const { count: walletsTracked } = await supabase
      .from("smart_money_sync_state")
      .select("wallet_address", { count: "exact", head: true });

    return json({
      tokens: tokens.slice(0, 20),
      walletsTracked: walletsTracked ?? walletsActive,
      walletsActive,
      totalTrades: meaningful.length,
      windowHours,
      fetchedAt,
    });
  } catch (e) {
    console.error("[smart-money-activity] fatal", e);
    return json({
      tokens: [], walletsTracked: 0, walletsActive: 0, totalTrades: 0,
      windowHours, fetchedAt,
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
  const chunkSize = 30;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
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
