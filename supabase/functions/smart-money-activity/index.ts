import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ActivityTrade {
  id: string;
  wallet: {
    address: string;
    label: string;
    twitterHandle: string | null;
    category: string | null;
    isCurated: boolean;
    isUserAdded: boolean;
  };
  side: "buy" | "sell" | "transfer" | "other";
  token: {
    symbol: string;
    name: string;
    address: string;
    logo: string | null;
    pairUrl: string | null;
  } | null;
  /** approximate USD value */
  valueUsd: number | null;
  amountUi: number | null;
  timestamp: number;
  signature: string;
  source: string | null;
}

interface ActivityResponse {
  trades: ActivityTrade[];
  walletsTracked: number;
  windowHours: number;
  fetchedAt: number;
  error?: string;
}

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
    // Load curated + user wallets, dedupe
    const { data: curated } = await supabase
      .from("smart_wallets_global_seed")
      .select("address, label, twitter_handle, category");

    const wallets = new Map<string, {
      label: string;
      twitterHandle: string | null;
      category: string | null;
      isCurated: boolean;
      isUserAdded: boolean;
    }>();

    for (const row of curated ?? []) {
      wallets.set(row.address, {
        label: row.label,
        twitterHandle: row.twitter_handle,
        category: row.category,
        isCurated: true,
        isUserAdded: false,
      });
    }

    if (body.userId) {
      const { data: usr } = await supabase
        .from("smart_wallets")
        .select("address, label, twitter_handle")
        .eq("user_id", body.userId);
      for (const row of usr ?? []) {
        const existing = wallets.get(row.address);
        if (existing) {
          existing.isUserAdded = true;
        } else {
          wallets.set(row.address, {
            label: row.label,
            twitterHandle: row.twitter_handle,
            category: null,
            isCurated: false,
            isUserAdded: true,
          });
        }
      }
    }

    if (wallets.size === 0) {
      return json({
        trades: [],
        walletsTracked: 0,
        windowHours,
        fetchedAt: Date.now(),
        error: "No wallets to track yet.",
      });
    }

    // To stay under CPU limits: only sample up to 25 wallets per call,
    // prioritizing user-added ones.
    const sortedWallets = [...wallets.entries()].sort((a, b) => {
      const aScore = (a[1].isUserAdded ? 2 : 0) + (a[1].isCurated ? 1 : 0);
      const bScore = (b[1].isUserAdded ? 2 : 0) + (b[1].isCurated ? 1 : 0);
      return bScore - aScore;
    }).slice(0, 25);

    const trades: ActivityTrade[] = [];

    // Fetch in parallel with a hard cap
    const results = await Promise.allSettled(
      sortedWallets.map(([address, meta]) =>
        fetchWalletActivity(address, meta, HELIUS_API_KEY, cutoff)
      ),
    );

    for (const r of results) {
      if (r.status === "fulfilled") trades.push(...r.value);
    }

    // Diversify: cap each wallet to its 5 most-recent trades so a single
    // chatty wallet (e.g. an MM bot) can't dominate the feed.
    const perWalletCap = 5;
    const byWallet = new Map<string, ActivityTrade[]>();
    for (const t of trades) {
      const list = byWallet.get(t.wallet.address) ?? [];
      list.push(t);
      byWallet.set(t.wallet.address, list);
    }
    const diversified: ActivityTrade[] = [];
    for (const [, list] of byWallet) {
      list.sort((a, b) => b.timestamp - a.timestamp);
      diversified.push(...list.slice(0, perWalletCap));
    }
    diversified.sort((a, b) => b.timestamp - a.timestamp);
    const limited = diversified.slice(0, 60);

    return json({
      trades: limited,
      walletsTracked: wallets.size,
      windowHours,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    console.error("[smart-money-activity] fatal", e);
    return json({
      trades: [],
      walletsTracked: 0,
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

async function fetchWalletActivity(
  address: string,
  meta: {
    label: string;
    twitterHandle: string | null;
    category: string | null;
    isCurated: boolean;
    isUserAdded: boolean;
  },
  apiKey: string,
  cutoff: number,
): Promise<ActivityTrade[]> {
  const url = new URL(`https://api.helius.xyz/v0/addresses/${address}/transactions`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("limit", "20");
  const resp = await fetch(url.toString());
  if (!resp.ok) return [];
  const txs = await resp.json();
  if (!Array.isArray(txs)) return [];

  const out: ActivityTrade[] = [];
  for (const tx of txs) {
    const ts = typeof tx?.timestamp === "number" ? tx.timestamp : 0;
    if (ts < cutoff) continue;

    const swap = tx?.events?.swap;
    let side: ActivityTrade["side"] = "other";
    let token: ActivityTrade["token"] = null;
    let valueUsd: number | null = null;
    let amountUi: number | null = null;

    if (swap) {
      // tokenOutputs[] are what the wallet received => "buy"
      // tokenInputs[] are what they sold
      const outs = Array.isArray(swap.tokenOutputs) ? swap.tokenOutputs : [];
      const ins = Array.isArray(swap.tokenInputs) ? swap.tokenInputs : [];
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const STABLE_MINTS = new Set([
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
        "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
      ]);

      // Pick a non-SOL/non-stable token as the meaningful side
      const meaningfulOut = outs.find(
        (o: any) => o?.mint && o.mint !== SOL_MINT && !STABLE_MINTS.has(o.mint),
      );
      const meaningfulIn = ins.find(
        (i: any) => i?.mint && i.mint !== SOL_MINT && !STABLE_MINTS.has(i.mint),
      );

      if (meaningfulOut) {
        side = "buy";
        amountUi = Number(meaningfulOut?.tokenAmount?.uiAmount ?? 0) || null;
        token = await lookupToken(meaningfulOut.mint);
        // value = SOL + stables spent
        valueUsd = sumValueUsd(ins, SOL_MINT, STABLE_MINTS);
      } else if (meaningfulIn) {
        side = "sell";
        amountUi = Number(meaningfulIn?.tokenAmount?.uiAmount ?? 0) || null;
        token = await lookupToken(meaningfulIn.mint);
        valueUsd = sumValueUsd(outs, SOL_MINT, STABLE_MINTS);
      }
    } else if (tx?.type === "TRANSFER") {
      side = "transfer";
    }

    if (side === "other") continue;

    out.push({
      id: `${address}-${tx.signature}`,
      wallet: { address, ...meta },
      side,
      token,
      valueUsd,
      amountUi,
      timestamp: ts * 1000,
      signature: tx.signature,
      source: typeof tx?.source === "string" ? tx.source : null,
    });
  }

  return out;
}

function sumValueUsd(
  side: any[],
  solMint: string,
  stableMints: Set<string>,
): number | null {
  let usd = 0;
  let any = false;
  for (const t of side) {
    const amt = Number(t?.tokenAmount?.uiAmount ?? 0);
    if (!amt) continue;
    if (t.mint === solMint) {
      usd += amt * 150; // rough SOL pricing for display only
      any = true;
    } else if (stableMints.has(t.mint)) {
      usd += amt;
      any = true;
    }
  }
  return any ? usd : null;
}

const tokenCache = new Map<
  string,
  { symbol: string; name: string; address: string; logo: string | null; pairUrl: string | null } | null
>();

async function lookupToken(mint: string) {
  if (tokenCache.has(mint)) return tokenCache.get(mint) ?? null;
  try {
    const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (!resp.ok) {
      tokenCache.set(mint, null);
      return null;
    }
    const data = await resp.json();
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    const solPairs = pairs.filter((p: any) => p?.chainId === "solana");
    if (solPairs.length === 0) {
      tokenCache.set(mint, null);
      return null;
    }
    solPairs.sort((a: any, b: any) => Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0));
    const top = solPairs[0];
    const base = top.baseToken;
    const result = {
      symbol: base?.symbol ?? "?",
      name: base?.name ?? base?.symbol ?? "Unknown",
      address: base?.address ?? mint,
      logo: top?.info?.imageUrl ?? null,
      pairUrl: top?.url ?? null,
    };
    tokenCache.set(mint, result);
    return result;
  } catch {
    tokenCache.set(mint, null);
    return null;
  }
}
