import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Returns LI.FI's token list for a given chain (LI.FI numeric id or "SOL").
// The UI calls this when the user opens the destination-token picker.
// We cap the response to the top ~150 tokens per chain (sorted by price-known
// + symbol) so the dialog stays snappy on slow connections.

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
}

const cache = new Map<string, { ts: number; data: BridgeToken[] }>();
const TTL_MS = 5 * 60 * 1000;
const MAX_TOKENS = 150;

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
      .map((t: any) => ({
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        logo: t.logoURI ?? null,
        priceUsd: t.priceUSD != null ? Number(t.priceUSD) : null,
        chainId: t.chainId,
      }))
      // Surface tokens we have prices for first; they're the ones users actually bridge.
      .sort((a, b) => {
        const ap = a.priceUsd != null ? 1 : 0;
        const bp = b.priceUsd != null ? 1 : 0;
        if (ap !== bp) return bp - ap;
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
