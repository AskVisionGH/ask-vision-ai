import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Lists active/historic Jupiter Trigger orders for a wallet, OR builds a
// cancelOrder transaction that the client signs and submits via
// limit-order-execute.
//
// Actions:
//   { action: "list", wallet, status?: "active" | "history" }
//   { action: "cancel", maker, order }   // order = order PDA (base58)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action: string = body.action ?? "list";

    if (action === "list") {
      const wallet: string = body.wallet ?? "";
      const status: string = body.status === "history" ? "history" : "active";
      if (!wallet) return json({ error: "wallet required" }, 400);

      const url = new URL("https://lite-api.jup.ag/trigger/v1/getTriggerOrders");
      url.searchParams.set("user", wallet);
      url.searchParams.set("orderStatus", status);

      const resp = await fetch(url.toString());
      if (!resp.ok) {
        const t = await resp.text();
        console.error("Jupiter getTriggerOrders error:", resp.status, t);
        return json({ error: "Couldn't fetch orders" }, 502);
      }
      const data = await resp.json();
      const orders: any[] = data.orders ?? [];

      // Collect all unique mints across orders so we can enrich missing
      // symbol/decimals/logo metadata in a single batch.
      const mints = new Set<string>();
      for (const o of orders) {
        const a = o.account ?? o;
        if (a.inputMint) mints.add(a.inputMint);
        if (a.outputMint) mints.add(a.outputMint);
      }

      const metaMap: Record<string, { symbol: string; decimals: number; logo: string | null }> = {};
      if (mints.size > 0) {
        try {
          const q = Array.from(mints).join(",");
          const r = await fetch(`https://api.jup.ag/tokens/v2/search?query=${q}`);
          if (r.ok) {
            const arr: any[] = await r.json();
            for (const t of arr) {
              if (!t?.id) continue;
              metaMap[t.id] = {
                symbol: t.symbol ?? String(t.id).slice(0, 4),
                decimals: typeof t.decimals === "number" ? t.decimals : 9,
                logo: t.icon ?? null,
              };
            }
          }
        } catch (e) {
          console.error("token enrichment failed:", e);
        }
      }

      // Inject enriched metadata into each order so the client can render
      // symbols + properly scaled amounts without extra round-trips.
      const enriched = orders.map((o) => {
        const a = o.account ?? o;
        const inMeta = metaMap[a.inputMint] ?? null;
        const outMeta = metaMap[a.outputMint] ?? null;
        return {
          ...o,
          account: {
            ...(o.account ?? {}),
            inputMint: a.inputMint,
            outputMint: a.outputMint,
            makingAmount: a.makingAmount,
            takingAmount: a.takingAmount,
            expiredAt: a.expiredAt,
            createdAt: a.createdAt,
            inputMintInfo: inMeta ?? a.inputMintInfo,
            outputMintInfo: outMeta ?? a.outputMintInfo,
          },
        };
      });

      return json({ orders: enriched });
    }

    if (action === "cancel") {
      const maker: string = body.maker ?? "";
      const order: string = body.order ?? "";
      if (!maker) return json({ error: "maker required" }, 400);
      if (!order) return json({ error: "order required" }, 400);

      const resp = await fetch("https://lite-api.jup.ag/trigger/v1/cancelOrder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maker,
          order,
          computeUnitPrice: "auto",
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        console.error("Jupiter cancelOrder error:", resp.status, t);
        return json({ error: "Couldn't build cancel transaction" }, 502);
      }
      const data = await resp.json();
      return json({
        requestId: data.requestId,
        transaction: data.transaction,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("limit-order-manage error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
