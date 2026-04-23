import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface EarlyBuyer {
  address: string;
  label: string | null;
  twitterHandle: string | null;
  category: string | null;
  isCurated: boolean;
  isUserTracked: boolean;
  firstBuyAt: number;
  signature: string | null;
  /** approximate USD spent on first buy */
  firstBuyUsd: number | null;
  /** how many tokens of the target mint they received on the first buy */
  firstBuyAmount: number | null;
  /** approximate current value of that first buy at the live price */
  currentValueUsd: number | null;
  /** rough multiplier on the first buy at current price (currentValue / firstBuyUsd) */
  multiplier: number | null;
  /** how soon after launch they aped, in minutes */
  minutesAfterLaunch: number | null;
}

interface EarlyBuyersResponse {
  token: {
    symbol: string;
    name: string;
    address: string;
    logo: string | null;
    priceUsd: number | null;
    pairUrl: string | null;
  };
  launchTimestamp: number | null;
  curatedBuyers: EarlyBuyer[];
  totalCuratedTracked: number;
  windowHours: number;
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: { query?: string; userId?: string | null };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const query = (body.query ?? "").trim();
  if (!query) return json({ error: "query required" }, 400);

  const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
  if (!HELIUS_API_KEY) return json({ error: "HELIUS_API_KEY not configured" }, 500);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Backend misconfigured" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // 1. Resolve token via DexScreener (fast, no key)
    const tokenInfo = await resolveToken(query);
    if ("error" in tokenInfo) {
      return json({
        error: tokenInfo.error,
        token: null,
        launchTimestamp: null,
        curatedBuyers: [],
        totalCuratedTracked: 0,
        windowHours: 24,
      }, 200);
    }

    // 2. Load curated + user wallets
    const { data: curated } = await supabase
      .from("smart_wallets_global_seed")
      .select("address, label, twitter_handle, category");
    const curatedMap = new Map<string, { label: string; twitterHandle: string | null; category: string | null }>();
    for (const row of curated ?? []) {
      curatedMap.set(row.address, {
        label: row.label,
        twitterHandle: row.twitter_handle,
        category: row.category,
      });
    }

    const userTracked = new Set<string>();
    if (body.userId) {
      const { data: usr } = await supabase
        .from("smart_wallets")
        .select("address")
        .eq("user_id", body.userId);
      for (const r of usr ?? []) userTracked.add(r.address);
    }

    // Combine: every curated wallet + user-added (we'll check their early activity)
    const allAddresses = new Set<string>([...curatedMap.keys(), ...userTracked]);

    // 3. Use Helius DAS getAssetsByAuthority is wrong here.
    //    Instead, we use Helius getSignaturesForAsset / Enhanced Transactions
    //    to find earliest token holders. To stay within free-tier, we use
    //    the token's earliest signatures via Helius RPC `getSignaturesForAddress`
    //    on the mint, then look at SWAP / TRANSFER events from the first 24h.
    const launchTs = await fetchLaunchTimestamp(tokenInfo.address, HELIUS_API_KEY);
    const windowHours = 24;
    const windowSec = windowHours * 3600;
    const cutoff = launchTs ? launchTs + windowSec : null;

    // 4. Fetch enhanced transactions for the mint, oldest-first.
    const earlyTxs = await fetchEarlyMintTxs(tokenInfo.address, HELIUS_API_KEY, cutoff);

    // 5. Map signers/fee payers in the first 24h that match curated wallets.
    const found = new Map<string, EarlyBuyer>();
    const STABLE_MINTS = new Set([
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    ]);
    const SOL_MINT = "So11111111111111111111111111111111111111112";

    for (const tx of earlyTxs) {
      const ts = tx.timestamp ?? 0;
      if (cutoff && ts > cutoff) continue;
      const minsAfter = launchTs ? Math.max(0, Math.round((ts - launchTs) / 60)) : null;
      const accounts: string[] = Array.isArray(tx.accountData)
        ? tx.accountData.map((a: any) => a?.account).filter(Boolean)
        : [];
      const candidates = [tx.feePayer, ...accounts].filter(
        (a): a is string => typeof a === "string",
      );

      // Sum SOL/stables spent in this tx (rough USD)
      let spentUsd: number | null = null;
      if (Array.isArray(tx.events?.swap?.tokenInputs)) {
        let usd = 0;
        let any = false;
        for (const inp of tx.events.swap.tokenInputs as any[]) {
          const amt = Number(inp?.tokenAmount?.uiAmount ?? 0);
          if (!amt) continue;
          if (inp.mint === SOL_MINT) { usd += amt * 150; any = true; }
          else if (STABLE_MINTS.has(inp.mint)) { usd += amt; any = true; }
        }
        if (any) spentUsd = usd;
      }
      // Tokens of the target mint received in this tx
      let receivedAmount: number | null = null;
      if (Array.isArray(tx.events?.swap?.tokenOutputs)) {
        for (const out of tx.events.swap.tokenOutputs as any[]) {
          if (out?.mint === tokenInfo.address) {
            const amt = Number(out?.tokenAmount?.uiAmount ?? 0);
            if (amt) receivedAmount = (receivedAmount ?? 0) + amt;
          }
        }
      }

      for (const addr of candidates) {
        if (!allAddresses.has(addr)) continue;
        if (found.has(addr)) continue; // first buy only
        const meta = curatedMap.get(addr);
        const currentValueUsd =
          receivedAmount != null && tokenInfo.priceUsd != null
            ? receivedAmount * tokenInfo.priceUsd
            : null;
        const multiplier =
          currentValueUsd != null && spentUsd != null && spentUsd > 0
            ? currentValueUsd / spentUsd
            : null;
        found.set(addr, {
          address: addr,
          label: meta?.label ?? null,
          twitterHandle: meta?.twitterHandle ?? null,
          category: meta?.category ?? null,
          isCurated: !!meta,
          isUserTracked: userTracked.has(addr),
          firstBuyAt: ts * 1000,
          signature: typeof tx?.signature === "string" ? tx.signature : null,
          firstBuyUsd: spentUsd,
          firstBuyAmount: receivedAmount,
          currentValueUsd,
          multiplier,
          minutesAfterLaunch: minsAfter,
        });
      }
    }

    const buyers = [...found.values()].sort((a, b) => a.firstBuyAt - b.firstBuyAt);

    const resp: EarlyBuyersResponse = {
      token: tokenInfo,
      launchTimestamp: launchTs ? launchTs * 1000 : null,
      curatedBuyers: buyers,
      totalCuratedTracked: allAddresses.size,
      windowHours,
    };
    return json(resp);
  } catch (e) {
    console.error("[smart-money-early-buyers] fatal", e);
    return json({
      error: "Couldn't analyze early buyers right now. Try again in a moment.",
      token: null,
      launchTimestamp: null,
      curatedBuyers: [],
      totalCuratedTracked: 0,
      windowHours: 24,
    }, 200);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveToken(query: string): Promise<
  | { symbol: string; name: string; address: string; logo: string | null; priceUsd: number | null; pairUrl: string | null }
  | { error: string }
> {
  const q = query.trim();
  const isMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
  const url = isMint
    ? `https://api.dexscreener.com/latest/dex/tokens/${q}`
    : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
  const resp = await fetch(url);
  if (!resp.ok) return { error: "Token lookup failed." };
  const data = await resp.json();
  const pairs: any[] = Array.isArray(data?.pairs) ? data.pairs : [];
  const solPairs = pairs.filter((p) => p?.chainId === "solana");
  if (solPairs.length === 0) return { error: `No Solana pair found for "${query}".` };
  solPairs.sort((a, b) => Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0));
  const top = solPairs[0];
  const base = top.baseToken;
  return {
    symbol: base?.symbol ?? "?",
    name: base?.name ?? base?.symbol ?? "Unknown",
    address: base?.address ?? q,
    logo: top?.info?.imageUrl ?? null,
    priceUsd: top?.priceUsd ? Number(top.priceUsd) : null,
    pairUrl: top?.url ?? null,
  };
}

async function fetchLaunchTimestamp(mint: string, apiKey: string): Promise<number | null> {
  // Helius RPC: get the earliest signature for the mint account
  const rpc = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const resp = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [mint, { limit: 1000 }],
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const sigs = data?.result;
  if (!Array.isArray(sigs) || sigs.length === 0) return null;
  // Oldest at the end
  const oldest = sigs[sigs.length - 1];
  return typeof oldest?.blockTime === "number" ? oldest.blockTime : null;
}

async function fetchEarlyMintTxs(
  mint: string,
  apiKey: string,
  cutoff: number | null,
): Promise<any[]> {
  // Use Helius parsed transaction history endpoint, paginate backwards from oldest
  const out: any[] = [];
  let before: string | undefined = undefined;
  // Cap pages to keep cpu time bounded
  for (let i = 0; i < 5; i++) {
    const url = new URL(`https://api.helius.xyz/v0/addresses/${mint}/transactions`);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("limit", "100");
    if (before) url.searchParams.set("before", before);
    const resp = await fetch(url.toString());
    if (!resp.ok) break;
    const txs = await resp.json();
    if (!Array.isArray(txs) || txs.length === 0) break;
    out.push(...txs);
    const last = txs[txs.length - 1];
    if (!last?.signature) break;
    before = last.signature;
    // Stop if we've gone past the 24h cutoff (txs are returned newest-first)
    const lastTs = last?.timestamp ?? 0;
    if (cutoff && lastTs < cutoff - 7 * 24 * 3600) break; // safety stop
  }
  return out;
}
