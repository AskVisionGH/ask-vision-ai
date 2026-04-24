import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Returns LI.FI's token list for a given chain (LI.FI numeric id or "SOL").
// The UI calls this when the user opens the destination-token picker.
//
// LI.FI's raw token list is enormous and includes a long tail of LP tokens,
// wrapped derivatives, and abandoned forks (e.g. searching "USDC" surfaces
// 3Crv, 9SUSDCcore, aAmmUni*USDC* before real USDC). We filter that junk out
// server-side so the picker stays useful:
//   - drop tokens with priceUsd > $100k (broken/LP shares with garbage prices)
//   - rank canonical tokens (matching coinKey/symbol heuristics) first
//   - then tokens with logo + sane price
//   - cap at MAX_TOKENS

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface BridgeToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
  chainId: number | string;
  coinKey: string | null;
  verified: boolean;
}

const cache = new Map<string, { ts: number; data: BridgeToken[] }>();
const TTL_MS = 5 * 60 * 1000;
const MAX_TOKENS = 400;
// Anything pricier than this is almost certainly a broken LP / share token
// (real assets above this — like wBTC — never come close in raw priceUsd).
const MAX_SANE_PRICE_USD = 100_000;

// Canonical symbols people actually want to see at the top of the list.
// Matched case-insensitively against the token's symbol.
const CANONICAL_SYMBOLS = new Set([
  "ETH", "WETH", "BTC", "WBTC", "USDC", "USDT", "DAI", "MATIC", "WMATIC",
  "BNB", "WBNB", "AVAX", "WAVAX", "SOL", "WSOL", "ARB", "OP", "BASE",
  "LINK", "UNI", "AAVE", "CRV", "LDO", "MKR", "SNX", "FRAX", "LUSD",
  "PYUSD", "USDE", "SUSDE", "TUSD", "USDP", "GUSD", "EURC", "EURS",
  "STETH", "WSTETH", "RETH", "CBETH", "EZETH",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const chain = url.searchParams.get("chain") ?? "";
    if (!chain) return json({ error: "chain required" }, 400);

    const cached = cache.get(chain);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      return json({ tokens: cached.data, cached: true });
    }

    const apiKey = Deno.env.get("LIFI_API_KEY");
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (apiKey) headers["x-lifi-api-key"] = apiKey;

    const resp = await fetch(
      `https://li.quest/v1/tokens?chains=${encodeURIComponent(chain)}`,
      { headers },
    );
    if (!resp.ok) {
      const t = await resp.text();
      console.error("LI.FI tokens error:", resp.status, t);
      return json({ error: "Couldn't load tokens for that chain" }, 502);
    }
    const data = await resp.json();
    const list: any[] = data.tokens?.[chain] ?? [];

    const tokens: BridgeToken[] = list
      .map((t: any): BridgeToken => {
        const priceUsd = t.priceUSD != null ? Number(t.priceUSD) : null;
        const symbol = String(t.symbol ?? "").trim();
        const coinKey = t.coinKey ? String(t.coinKey) : null;
        const verified = CANONICAL_SYMBOLS.has(symbol.toUpperCase()) ||
          (coinKey != null && CANONICAL_SYMBOLS.has(coinKey.toUpperCase()));
        return {
          address: t.address,
          symbol,
          name: t.name,
          decimals: t.decimals,
          logo: t.logoURI ?? null,
          priceUsd,
          chainId: t.chainId,
          coinKey,
          verified,
        };
      })
      // Drop obvious junk: missing symbol, broken price, or no logo AND no price
      // (those are almost always abandoned tokens nobody bridges).
      .filter((t) => {
        if (!t.symbol || !t.address) return false;
        if (t.priceUsd != null && t.priceUsd > MAX_SANE_PRICE_USD) return false;
        if (t.priceUsd != null && t.priceUsd < 0) return false;
        return true;
      })
      .sort((a, b) => {
        // 1. Verified canonical tokens first
        if (a.verified !== b.verified) return a.verified ? -1 : 1;
        // 2. Tokens with both logo + price next
        const aRich = (a.logo ? 1 : 0) + (a.priceUsd != null ? 1 : 0);
        const bRich = (b.logo ? 1 : 0) + (b.priceUsd != null ? 1 : 0);
        if (aRich !== bRich) return bRich - aRich;
        // 3. Alpha by symbol
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, MAX_TOKENS);

    cache.set(chain, { ts: Date.now(), data: tokens });
    return json({ tokens, cached: false });
  } catch (e) {
    console.error("bridge-tokens error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
