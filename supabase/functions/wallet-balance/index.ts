import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TokenHolding {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  amount: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { address } = await req.json();
    if (!address || typeof address !== "string") {
      return json({ error: "address required" }, 400);
    }

    const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
    if (!HELIUS_API_KEY) throw new Error("HELIUS_API_KEY missing");

    const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

    // 1. Fetch assets via Helius DAS — returns SOL + all fungibles with metadata + native price
    const assetsResp = await fetch(heliusUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "vision",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: address,
          page: 1,
          limit: 1000,
          displayOptions: {
            showFungible: true,
            showNativeBalance: true,
          },
        },
      }),
    });

    if (!assetsResp.ok) {
      const t = await assetsResp.text();
      console.error("Helius error:", assetsResp.status, t);
      return json({ error: "Failed to fetch wallet data" }, 502);
    }

    const assetsData = await assetsResp.json();
    const items = assetsData.result?.items ?? [];
    const native = assetsData.result?.nativeBalance;

    const holdings: TokenHolding[] = [];

    // SOL native
    if (native && native.lamports > 0) {
      const solAmount = native.lamports / 1e9;
      holdings.push({
        mint: SOL_MINT,
        symbol: "SOL",
        name: "Solana",
        logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
        amount: solAmount,
        decimals: 9,
        priceUsd: native.price_per_sol ?? null,
        valueUsd: native.total_price ?? null,
      });
    }

    // SPL fungibles
    for (const item of items) {
      if (item.interface !== "FungibleToken" && item.interface !== "FungibleAsset") continue;
      const info = item.token_info;
      if (!info || !info.balance || info.balance === 0) continue;

      const decimals = info.decimals ?? 0;
      const amount = Number(info.balance) / Math.pow(10, decimals);
      const priceUsd = info.price_info?.price_per_token ?? null;
      const valueUsd = info.price_info?.total_price ?? (priceUsd ? amount * priceUsd : null);

      holdings.push({
        mint: item.id,
        symbol: info.symbol ?? item.content?.metadata?.symbol ?? "?",
        name: item.content?.metadata?.name ?? info.symbol ?? "Unknown",
        logo: item.content?.links?.image ?? null,
        amount,
        decimals,
        priceUsd,
        valueUsd,
      });
    }

    // Sort by USD value desc, then by amount
    holdings.sort((a, b) => {
      const av = a.valueUsd ?? 0;
      const bv = b.valueUsd ?? 0;
      if (bv !== av) return bv - av;
      return b.amount - a.amount;
    });

    const totalUsd = holdings.reduce((sum, h) => sum + (h.valueUsd ?? 0), 0);

    return json({
      address,
      totalUsd,
      holdings: holdings.slice(0, 50), // cap
      tokenCount: holdings.length,
    });
  } catch (e) {
    console.error("wallet-balance error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
