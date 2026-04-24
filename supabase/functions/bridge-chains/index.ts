import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Returns the list of chains LI.FI supports, lightly normalized for the UI.
// Cached in-memory per worker for 10 minutes — chain list rarely changes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NormalizedChain {
  id: number | string;       // LI.FI internal id (number for EVM, "SOL" for Solana)
  key: string;               // short key e.g. "eth", "sol", "base"
  name: string;              // display name
  logo: string | null;
  nativeSymbol: string;
  chainType: "EVM" | "SVM" | string;
}

let cache: { ts: number; data: NormalizedChain[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (cache && Date.now() - cache.ts < TTL_MS) {
      return json({ chains: cache.data, cached: true });
    }

    const apiKey = Deno.env.get("LIFI_API_KEY");
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (apiKey) headers["x-lifi-api-key"] = apiKey;

    const resp = await fetch("https://li.quest/v1/chains", { headers });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("LI.FI chains error:", resp.status, t);
      return json({ error: "Couldn't load chain list" }, 502);
    }
    const data = await resp.json();
    const chains: NormalizedChain[] = (data.chains ?? []).map((c: any) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      logo: c.logoURI ?? null,
      nativeSymbol: c.nativeToken?.symbol ?? c.coin ?? "",
      chainType: c.chainType ?? "EVM",
    }));

    cache = { ts: Date.now(), data: chains };
    return json({ chains, cached: false });
  } catch (e) {
    console.error("bridge-chains error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
