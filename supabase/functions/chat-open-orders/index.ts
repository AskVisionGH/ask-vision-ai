import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Returns a chat-friendly summary of a wallet's active limit + DCA orders so
// the chat preview card (OpenOrdersCard) can render quickly without N round-
// trips. We hit the same Jupiter endpoints used by /trade.
//
// Body: { wallet: string }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface MintMeta {
  symbol: string;
  decimals: number;
  logo: string | null;
}

async function batchMintMeta(mints: string[]): Promise<Record<string, MintMeta>> {
  const out: Record<string, MintMeta> = {};
  if (mints.length === 0) return out;
  try {
    const q = mints.join(",");
    const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${q}`);
    if (r.ok) {
      const arr: any[] = await r.json();
      for (const t of arr) {
        if (!t?.id) continue;
        out[t.id] = {
          symbol: t.symbol ?? String(t.id).slice(0, 4),
          decimals: typeof t.decimals === "number" ? t.decimals : 9,
          logo: t.icon ?? null,
        };
      }
    }
  } catch (e) {
    console.error("batchMintMeta failed:", e);
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const wallet: string = (body.wallet ?? "").trim();
    if (!wallet) return json({ error: "wallet required" }, 400);

    const apiKey = Deno.env.get("JUPITER_PORTAL_API_KEY");

    // Fetch limit + DCA in parallel. Failures on either side don't kill the response.
    const [limitData, dcaData] = await Promise.all([
      fetchLimit(wallet),
      apiKey ? fetchDca(wallet, apiKey) : Promise.resolve({ orders: [] as any[] }),
    ]);

    const limitOrders: any[] = Array.isArray(limitData?.orders) ? limitData.orders : [];
    const dcaOrders: any[] = Array.isArray(dcaData?.orders) ? dcaData.orders : [];

    // Collect mints and fetch metadata in one batch.
    const mintSet = new Set<string>();
    for (const o of limitOrders) {
      const a = o.account ?? o;
      if (a.inputMint) mintSet.add(a.inputMint);
      if (a.outputMint) mintSet.add(a.outputMint);
    }
    for (const o of dcaOrders) {
      if (o.inputMint) mintSet.add(o.inputMint);
      if (o.outputMint) mintSet.add(o.outputMint);
    }
    const meta = await batchMintMeta(Array.from(mintSet));
    const lookup = (mint: string): MintMeta => meta[mint] ?? {
      symbol: mint.slice(0, 4),
      decimals: 9,
      logo: null,
    };

    const previewLimit = limitOrders.map((o): any => {
      const a = o.account ?? o;
      const inMeta = lookup(a.inputMint);
      const outMeta = lookup(a.outputMint);
      const orderId = o.publicKey ?? o.account?.publicKey ?? o.orderKey ?? o.order ?? "";
      const remainingMaking = Number(a.remainingMakingAmount ?? a.makingAmount ?? 0);
      const inAmountUi = remainingMaking / Math.pow(10, inMeta.decimals);
      const takingTotal = Number(a.takingAmount ?? 0);
      const outAmountUi = takingTotal / Math.pow(10, outMeta.decimals);
      const expiredAt = a.expiredAt ? Number(a.expiredAt) * 1000 : null;
      return {
        kind: "limit" as const,
        id: String(orderId),
        inSymbol: inMeta.symbol,
        outSymbol: outMeta.symbol,
        inLogo: inMeta.logo,
        outLogo: outMeta.logo,
        inAmount: inAmountUi,
        outAmount: outAmountUi,
        remainingCycles: null,
        perCycleAmount: null,
        expiresAt: expiredAt,
        nextCycleAt: null,
      };
    });

    const previewDca = dcaOrders.map((o): any => {
      const inMeta = lookup(o.inputMint);
      const outMeta = lookup(o.outputMint);
      const inAmountTotal = Number(o.inDeposited ?? o.inAmount ?? 0);
      const inAmountUi = inAmountTotal / Math.pow(10, inMeta.decimals);
      const totalCycles = Number(o.numberOfOrders ?? o.cycleCount ?? 0);
      const idx = Number(o.idx ?? o.cyclesCompleted ?? 0);
      const remainingCycles = Math.max(0, totalCycles - idx);
      const perCycleAtomic = totalCycles > 0 ? inAmountTotal / totalCycles : 0;
      const perCycle = perCycleAtomic / Math.pow(10, inMeta.decimals);
      const nextRaw = o.nextCycleAt ?? o.nextCycle ?? null;
      const nextCycleAt = nextRaw ? Number(nextRaw) * 1000 : null;
      return {
        kind: "dca" as const,
        id: String(o.dcaPubKey ?? o.publicKey ?? o.orderKey ?? ""),
        inSymbol: inMeta.symbol,
        outSymbol: outMeta.symbol,
        inLogo: inMeta.logo,
        outLogo: outMeta.logo,
        inAmount: inAmountUi,
        outAmount: null,
        remainingCycles,
        perCycleAmount: perCycle,
        expiresAt: null,
        nextCycleAt,
      };
    });

    // Most-relevant first: nearest expiry / next cycle, capped at 6 entries.
    const all = [...previewLimit, ...previewDca].sort((a, b) => {
      const aT = a.kind === "dca" ? (a.nextCycleAt ?? Infinity) : (a.expiresAt ?? Infinity);
      const bT = b.kind === "dca" ? (b.nextCycleAt ?? Infinity) : (b.expiresAt ?? Infinity);
      return aT - bT;
    });

    return json({
      walletAddress: wallet,
      limitCount: previewLimit.length,
      dcaCount: previewDca.length,
      totalCount: previewLimit.length + previewDca.length,
      preview: all.slice(0, 6),
    });
  } catch (e) {
    console.error("chat-open-orders error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function fetchLimit(wallet: string) {
  const url = new URL("https://lite-api.jup.ag/trigger/v1/getTriggerOrders");
  url.searchParams.set("user", wallet);
  url.searchParams.set("orderStatus", "active");
  const r = await fetch(url.toString());
  if (!r.ok) {
    const t = await r.text();
    console.error("getTriggerOrders failed:", r.status, t);
    return { orders: [] };
  }
  return await r.json();
}

async function fetchDca(wallet: string, apiKey: string) {
  const url = new URL("https://api.jup.ag/recurring/v1/getRecurringOrders");
  url.searchParams.set("user", wallet);
  url.searchParams.set("orderStatus", "active");
  url.searchParams.set("recurringType", "time");
  url.searchParams.set("includeFailedTx", "false");
  const r = await fetch(url.toString(), { headers: { "x-api-key": apiKey } });
  if (!r.ok) {
    const t = await r.text();
    console.error("getRecurringOrders failed:", r.status, t);
    return { orders: [] };
  }
  const data = await r.json();
  // Jupiter wraps the time-based orders in `time: { ... }` — flatten for ease.
  const orders = data?.time?.orders ?? data?.orders ?? [];
  return { orders };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
