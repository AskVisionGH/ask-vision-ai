import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Quotes/previews for the four chat-driven order types: limit, dca, bracket, ladder.
// Returns a UI-shaped payload that maps 1:1 to the *_quote ToolEvent types in chat-stream.
// No transactions are built here — the preview cards call the existing build functions
// when the user clicks "Place".
//
// Body: { kind: "limit"|"dca"|"bracket"|"ladder", inputToken, outputToken, ... }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const KNOWN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  WSOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  ORCA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
};

interface TokenMeta {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
}

const isMint = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

async function resolveToken(input: string): Promise<TokenMeta | null> {
  const cleaned = (input ?? "").trim().replace(/^\$/, "");
  if (!cleaned) return null;
  const upper = cleaned.toUpperCase();
  const mint = KNOWN_MINTS[upper] ?? (isMint(cleaned) ? cleaned : null);
  if (mint) return await fetchMeta(mint);

  const resp = await fetch(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(cleaned)}`,
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const pairs = ((data.pairs ?? []) as any[]).filter((p) => p.chainId === "solana");
  if (pairs.length === 0) return null;
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const top = pairs[0];
  const addr = top.baseToken?.address;
  if (!addr) return null;
  return await fetchMeta(addr, top);
}

async function fetchMeta(mint: string, dexPair?: any): Promise<TokenMeta | null> {
  let decimals = 9;
  let symbol = "?";
  let name = "Unknown";
  let logo: string | null = null;

  try {
    const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
    if (r.ok) {
      const arr = await r.json();
      const tok = Array.isArray(arr) ? arr.find((t: any) => t.id === mint) ?? arr[0] : null;
      if (tok) {
        decimals = tok.decimals ?? 9;
        symbol = tok.symbol ?? symbol;
        name = tok.name ?? name;
        logo = tok.icon ?? null;
      }
    }
  } catch (_) { /* ignore */ }

  let priceUsd: number | null = null;
  try {
    const pair = dexPair ?? await (async () => {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      if (!r.ok) return null;
      const d = await r.json();
      const ps = ((d.pairs ?? []) as any[]).filter((p) => p.chainId === "solana");
      ps.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      return ps[0] ?? null;
    })();
    if (pair) {
      priceUsd = pair.priceUsd ? Number(pair.priceUsd) : null;
      if (!logo) logo = pair.info?.imageUrl ?? null;
      if (symbol === "?") symbol = pair.baseToken?.symbol ?? symbol;
      if (name === "Unknown") name = pair.baseToken?.name ?? name;
    }
  } catch (_) { /* ignore */ }

  return { symbol, name, address: mint, decimals, logo, priceUsd };
}

const stripToken = ({ priceUsd: _p, ...rest }: TokenMeta) => ({ ...rest, priceUsd: _p });

// ----- Duration parsing helpers (e.g. "7d", "1 week", "12h", "30 min") -----

const SECONDS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
const fmtDuration = (sec: number) => {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const kind: string = body.kind ?? "";
    if (!kind) return json({ error: "kind required" }, 400);

    if (kind === "limit") return await handleLimit(body);
    if (kind === "dca") return await handleDca(body);
    if (kind === "bracket") return await handleBracket(body);
    if (kind === "ladder") return await handleLadder(body);

    return json({ error: `Unknown kind: ${kind}` }, 400);
  } catch (e) {
    console.error("chat-order-quote error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ============================================================================
// LIMIT
// ============================================================================
//
// Body: { inputToken, outputToken, sellAmount, limitPrice, expirySeconds? }
//   limitPrice = OUTPUT per 1 INPUT (e.g. selling SOL → USDC at 250 means
//   "I want 250 USDC for each 1 SOL").
async function handleLimit(body: any) {
  const sellAmount = Number(body.sellAmount);
  const limitPrice = Number(body.limitPrice);
  const expirySeconds = body.expirySeconds == null ? null : Number(body.expirySeconds);

  if (!Number.isFinite(sellAmount) || sellAmount <= 0) {
    return json({ error: "sellAmount must be > 0" }, 400);
  }
  if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
    return json({ error: "limitPrice must be > 0" }, 400);
  }

  const [inMeta, outMeta] = await Promise.all([
    resolveToken(body.inputToken ?? ""),
    resolveToken(body.outputToken ?? ""),
  ]);
  if (!inMeta) return json({ error: `Couldn't find token "${body.inputToken}"` }, 404);
  if (!outMeta) return json({ error: `Couldn't find token "${body.outputToken}"` }, 404);
  if (inMeta.address === outMeta.address) {
    return json({ error: "Input and output tokens are the same" }, 400);
  }

  const receiveAmountUi = sellAmount * limitPrice;
  const sellValueUsd = inMeta.priceUsd != null ? sellAmount * inMeta.priceUsd : null;
  const receiveValueUsd = outMeta.priceUsd != null ? receiveAmountUi * outMeta.priceUsd : null;

  // Market price = OUTPUT per 1 INPUT, derived from USD prices when both are known.
  const marketPrice = inMeta.priceUsd != null && outMeta.priceUsd != null && outMeta.priceUsd > 0
    ? inMeta.priceUsd / outMeta.priceUsd
    : null;
  const deltaPct = marketPrice != null
    ? ((limitPrice - marketPrice) / marketPrice) * 100
    : null;
  // "Will fill instantly" = limit is at least 0.5% worse than market for the seller.
  const willFillInstantly = deltaPct != null && deltaPct <= -0.5;

  const expiryLabel = expirySeconds == null ? "Good till cancelled" : fmtDuration(expirySeconds);

  return json({
    input: stripToken(inMeta),
    output: stripToken(outMeta),
    sellAmountUi: sellAmount,
    limitPrice,
    receiveAmountUi,
    marketPrice,
    deltaPct,
    expirySeconds,
    expiryLabel,
    sellValueUsd,
    receiveValueUsd,
    willFillInstantly,
  });
}

// ============================================================================
// DCA
// ============================================================================
//
// Body: { inputToken, outputToken, totalAmount, numberOfOrders, intervalSeconds,
//         minPriceUsd?, maxPriceUsd? }
async function handleDca(body: any) {
  const totalAmount = Number(body.totalAmount);
  const numberOfOrders = Number(body.numberOfOrders);
  const intervalSeconds = Number(body.intervalSeconds);

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return json({ error: "totalAmount must be > 0" }, 400);
  }
  if (!Number.isFinite(numberOfOrders) || numberOfOrders < 2 || numberOfOrders > 1000) {
    return json({ error: "numberOfOrders must be between 2 and 1000" }, 400);
  }
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 60) {
    return json({ error: "intervalSeconds must be ≥ 60" }, 400);
  }

  const [inMeta, outMeta] = await Promise.all([
    resolveToken(body.inputToken ?? ""),
    resolveToken(body.outputToken ?? ""),
  ]);
  if (!inMeta) return json({ error: `Couldn't find token "${body.inputToken}"` }, 404);
  if (!outMeta) return json({ error: `Couldn't find token "${body.outputToken}"` }, 404);

  const perOrderUi = totalAmount / numberOfOrders;
  const perOrderUsd = inMeta.priceUsd != null ? perOrderUi * inMeta.priceUsd : null;
  const totalUsd = inMeta.priceUsd != null ? totalAmount * inMeta.priceUsd : null;
  const totalDurationSeconds = intervalSeconds * (numberOfOrders - 1);
  const intervalLabel = fmtDuration(intervalSeconds);

  return json({
    input: stripToken(inMeta),
    output: stripToken(outMeta),
    totalAmountUi: totalAmount,
    numberOfOrders,
    intervalSeconds,
    intervalLabel,
    perOrderUi,
    perOrderUsd,
    totalUsd,
    totalDurationSeconds,
    minPriceUsd: body.minPriceUsd != null ? Number(body.minPriceUsd) : null,
    maxPriceUsd: body.maxPriceUsd != null ? Number(body.maxPriceUsd) : null,
  });
}

// ============================================================================
// BRACKET (TP + SL) — chat preview only; user finalises in /trade.
// ============================================================================
//
// Body: { inputToken, outputToken, sellAmount, tpPriceUsd, slPriceUsd,
//         entryMode?: "market"|"limit", entryPriceUsd? }
async function handleBracket(body: any) {
  const sellAmount = Number(body.sellAmount);
  const tpPriceUsd = Number(body.tpPriceUsd);
  const slPriceUsd = Number(body.slPriceUsd);
  if (!Number.isFinite(sellAmount) || sellAmount <= 0) {
    return json({ error: "sellAmount must be > 0" }, 400);
  }
  if (!Number.isFinite(tpPriceUsd) || tpPriceUsd <= 0) {
    return json({ error: "tpPriceUsd must be > 0" }, 400);
  }
  if (!Number.isFinite(slPriceUsd) || slPriceUsd <= 0) {
    return json({ error: "slPriceUsd must be > 0" }, 400);
  }

  const [inMeta, outMeta] = await Promise.all([
    resolveToken(body.inputToken ?? ""),
    resolveToken(body.outputToken ?? ""),
  ]);
  if (!inMeta) return json({ error: `Couldn't find token "${body.inputToken}"` }, 404);
  if (!outMeta) return json({ error: `Couldn't find token "${body.outputToken}"` }, 404);

  const entryMode: "market" | "limit" = body.entryMode === "limit" ? "limit" : "market";
  const entryPriceUsd = entryMode === "limit" && body.entryPriceUsd != null
    ? Number(body.entryPriceUsd) : null;
  const marketPriceUsd = outMeta.priceUsd ?? null;
  const entrySide: "above" | "below" | null = entryPriceUsd != null && marketPriceUsd != null
    ? (entryPriceUsd >= marketPriceUsd ? "above" : "below")
    : null;
  const sellValueUsd = inMeta.priceUsd != null ? sellAmount * inMeta.priceUsd : null;

  // Build prefill URL — Trade page reads these in step 4.
  const params = new URLSearchParams({
    tab: "pro",
    inMint: inMeta.address,
    outMint: outMeta.address,
    sell: String(sellAmount),
    tp: String(tpPriceUsd),
    sl: String(slPriceUsd),
    entryMode,
  });
  if (entryPriceUsd != null) params.set("entry", String(entryPriceUsd));
  const tradeUrl = `/trade?${params.toString()}`;

  return json({
    input: stripToken(inMeta),
    output: stripToken(outMeta),
    sellAmountUi: sellAmount,
    sellValueUsd,
    entryMode,
    entryPriceUsd,
    entrySide,
    tpPriceUsd,
    slPriceUsd,
    marketPriceUsd,
    tradeUrl,
  });
}

// ============================================================================
// LADDER — multiple limit orders across a price range. Preview only.
// ============================================================================
//
// Body: { side: "buy"|"sell", asset, quote, totalAmount, rungCount,
//         minPriceUsd, maxPriceUsd }
//   asset = the token being bought/sold. quote = the funding token.
//   For "buy", totalAmount is in QUOTE units; for "sell", in ASSET units.
async function handleLadder(body: any) {
  const side: "buy" | "sell" = body.side === "sell" ? "sell" : "buy";
  const totalAmount = Number(body.totalAmount);
  const rungCount = Number(body.rungCount);
  const minPriceUsd = Number(body.minPriceUsd);
  const maxPriceUsd = Number(body.maxPriceUsd);

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return json({ error: "totalAmount must be > 0" }, 400);
  }
  if (!Number.isFinite(rungCount) || rungCount < 2 || rungCount > 20) {
    return json({ error: "rungCount must be between 2 and 20" }, 400);
  }
  if (!Number.isFinite(minPriceUsd) || minPriceUsd <= 0) {
    return json({ error: "minPriceUsd must be > 0" }, 400);
  }
  if (!Number.isFinite(maxPriceUsd) || maxPriceUsd <= minPriceUsd) {
    return json({ error: "maxPriceUsd must be greater than minPriceUsd" }, 400);
  }

  const [assetMeta, quoteMeta] = await Promise.all([
    resolveToken(body.asset ?? ""),
    resolveToken(body.quote ?? "USDC"),
  ]);
  if (!assetMeta) return json({ error: `Couldn't find token "${body.asset}"` }, 404);
  if (!quoteMeta) return json({ error: `Couldn't find quote token "${body.quote}"` }, 404);

  const step = (maxPriceUsd - minPriceUsd) / (rungCount - 1);
  const perRung = totalAmount / rungCount;
  const rungs = Array.from({ length: rungCount }, (_, i) => {
    const priceUsd = minPriceUsd + step * i;
    if (side === "buy") {
      // Spend = quote tokens / rung; receive = asset units at that price.
      const receiveUi = perRung / priceUsd;
      return { priceUsd, spendUi: perRung, receiveUi };
    } else {
      // Sell asset / rung; receive = quote at that price.
      const receiveUi = perRung * priceUsd;
      return { priceUsd, spendUi: perRung, receiveUi };
    }
  });
  const averagePriceUsd = rungs.reduce((a, r) => a + r.priceUsd, 0) / rungs.length;
  const totalUsd = side === "buy"
    ? totalAmount * (quoteMeta.priceUsd ?? 1) // quote is usually a stable
    : totalAmount * averagePriceUsd;

  const params = new URLSearchParams({
    tab: "limit",
    side,
    asset: assetMeta.address,
    quote: quoteMeta.address,
    total: String(totalAmount),
    rungs: String(rungCount),
    min: String(minPriceUsd),
    max: String(maxPriceUsd),
    ladder: "1",
  });
  const tradeUrl = `/trade?${params.toString()}`;

  return json({
    asset: stripToken(assetMeta),
    quote: stripToken(quoteMeta),
    side,
    totalAmountUi: totalAmount,
    totalUsd,
    rungCount,
    minPriceUsd,
    maxPriceUsd,
    averagePriceUsd,
    rungs,
    tradeUrl,
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
