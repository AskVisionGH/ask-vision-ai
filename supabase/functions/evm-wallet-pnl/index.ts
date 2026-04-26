// EVM Wallet PnL & recent activity using Etherscan v2 (multichain) + LI.FI prices.
//
// Mirrors supabase/functions/wallet-pnl (Solana) so the chat UI's existing
// PnL cards render the same shape. The main differences from the Solana side:
//   - Chain-aware: takes a `chainId` (1, 8453, 42161, …) and scopes the window
//     to that single chain. Most users trade on one chain at a time so this
//     keeps the UX focused; the chat tool description tells the model to pick.
//   - Tx parsing: we use Etherscan v2's normal + erc20 transfer endpoints to
//     reconstruct swaps. A "swap" = same hash with one ERC-20 (or native) IN
//     and one OUT to/from the user. Anything else is a transfer or "other".
//   - Cost basis: stables (USDC, USDT, DAI, …) and the chain's native token
//     (ETH, BNB, MATIC, …) count as the "money side". Native USD value is
//     backfilled from LI.FI's current price (close enough for a 30-day window;
//     full historical EVM pricing would require a paid feed).
//
// Window: last 30 days, capped to ~1000 txs per chain.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const WINDOW_DAYS = 30;
const MAX_TXS = 1000;

// Native pseudo-address used by LI.FI for ETH/BNB/MATIC/etc.
const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

// Per-chain stable contracts (lowercased). These count as quote assets for
// cost-basis math. Add more as we see them in the wild.
const STABLES: Record<number, Set<string>> = {
  1: new Set([
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
    "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  ]),
  8453: new Set([
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC
    "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT
  ]),
  42161: new Set([
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC
    "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8", // USDC.e
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // USDT
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
  ]),
  10: new Set([
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85", // USDC
    "0x7f5c764cbc14f9669b88837ca1490cca17c31607", // USDC.e
    "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", // USDT
  ]),
  137: new Set([
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // USDC
    "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC.e
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // USDT
    "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", // DAI
  ]),
  56: new Set([
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
    "0x55d398326f99059ff775485246999027b3197955", // USDT
  ]),
  43114: new Set([
    "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", // USDC
    "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7", // USDT
  ]),
  59144: new Set([
    "0x176211869ca2b568f2a7d4ee941e073a821ee1ff", // USDC
  ]),
  534352: new Set([
    "0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4", // USDC
  ]),
  324: new Set([
    "0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4", // USDC
    "0x493257fd37edb34451f62edf8d2a0c418852ba4c", // USDT
  ]),
};

const NATIVE_BY_CHAIN: Record<number, { symbol: string; coingeckoId: string }> = {
  1: { symbol: "ETH", coingeckoId: "ethereum" },
  8453: { symbol: "ETH", coingeckoId: "ethereum" },
  42161: { symbol: "ETH", coingeckoId: "ethereum" },
  10: { symbol: "ETH", coingeckoId: "ethereum" },
  137: { symbol: "POL", coingeckoId: "matic-network" },
  56: { symbol: "BNB", coingeckoId: "binancecoin" },
  43114: { symbol: "AVAX", coingeckoId: "avalanche-2" },
  59144: { symbol: "ETH", coingeckoId: "ethereum" },
  534352: { symbol: "ETH", coingeckoId: "ethereum" },
  324: { symbol: "ETH", coingeckoId: "ethereum" },
};

interface ParsedTx {
  signature: string; // tx hash (UI re-uses this field name)
  timestamp: number;
  type: "swap" | "transfer_in" | "transfer_out" | "other";
  description: string | null;
  source: string | null;
  fee: number;
  inToken?: { mint: string; symbol: string; amount: number };
  outToken?: { mint: string; symbol: string; amount: number };
  solChange?: number; // unused for EVM, kept for shape compat
  counterparty?: string | null;
  valueUsd: number | null;
  chainId?: number;
}

interface TokenPnL {
  mint: string; // contract address (UI field name)
  symbol: string;
  name: string;
  logo: string | null;
  buys: number;
  sells: number;
  costUsd: number;
  proceedsUsd: number;
  unitsBought: number;
  unitsSold: number;
  currentUnits: number;
  currentPriceUsd: number | null;
  currentValueUsd: number | null;
  realizedUsd: number;
  unrealizedUsd: number;
  pairUrl: string | null;
}

// ----- LI.FI token meta + price (cached per chain) -----

interface LifiToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string | null;
  priceUSD?: string | null;
}

const tokenCache = new Map<string, { ts: number; tokens: Map<string, LifiToken> }>();
const TOKEN_TTL_MS = 5 * 60 * 1000;

async function loadLifiTokenMap(chainId: number): Promise<Map<string, LifiToken>> {
  const key = String(chainId);
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.ts < TOKEN_TTL_MS) return hit.tokens;

  const apiKey = Deno.env.get("LIFI_API_KEY");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-lifi-api-key"] = apiKey;

  const resp = await fetch(
    `https://li.quest/v1/tokens?chains=${encodeURIComponent(key)}`,
    { headers },
  );
  if (!resp.ok) throw new Error(`LI.FI tokens ${resp.status}`);
  const data = await resp.json();
  const list: LifiToken[] = data.tokens?.[key] ?? [];
  const map = new Map<string, LifiToken>();
  for (const t of list) {
    if (t.address) map.set(t.address.toLowerCase(), t);
  }
  tokenCache.set(key, { ts: Date.now(), tokens: map });
  return map;
}

// ----- Etherscan v2 multichain helpers -----

interface EtherscanTx {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  gasUsed?: string;
  gasPrice?: string;
  isError?: string;
  contractAddress?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  functionName?: string;
  methodId?: string;
}

async function etherscanList(
  chainId: number,
  address: string,
  action: "txlist" | "tokentx",
  apiKey: string,
): Promise<EtherscanTx[]> {
  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "account");
  url.searchParams.set("action", action);
  url.searchParams.set("address", address);
  url.searchParams.set("startblock", "0");
  url.searchParams.set("endblock", "99999999");
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", "1000");
  url.searchParams.set("sort", "desc");
  url.searchParams.set("apikey", apiKey);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    console.error(`etherscan ${action} ${resp.status}`, await resp.text().catch(() => ""));
    return [];
  }
  const data = await resp.json();
  // Etherscan returns { status: "0", message: "No transactions found", result: [] }
  // for empty wallets — that's fine, just hand back an empty array.
  if (!Array.isArray(data.result)) return [];
  return data.result as EtherscanTx[];
}

// ----- Tx normalisation -----

function isStable(chainId: number, contract: string): boolean {
  return STABLES[chainId]?.has(contract.toLowerCase()) ?? false;
}

function isQuote(chainId: number, contract: string): boolean {
  return contract.toLowerCase() === NATIVE_ADDRESS || isStable(chainId, contract);
}

function tokenMeta(
  contract: string,
  fallback: { symbol?: string; name?: string; decimals?: number },
  lifi: Map<string, LifiToken>,
  chainId: number,
): { symbol: string; name: string; decimals: number; logo: string | null; priceUsd: number | null; pairUrl: string | null } {
  const key = contract.toLowerCase();
  const meta = lifi.get(key);
  const isNative = key === NATIVE_ADDRESS;
  const symbol =
    meta?.symbol ??
    fallback.symbol ??
    (isNative ? NATIVE_BY_CHAIN[chainId]?.symbol ?? "ETH" : "TOKEN");
  return {
    symbol,
    name: meta?.name ?? fallback.name ?? symbol,
    decimals: meta?.decimals ?? Number(fallback.decimals ?? 18),
    logo: meta?.logoURI ?? null,
    priceUsd: meta?.priceUSD ? Number(meta.priceUSD) : null,
    pairUrl: isNative ? null : `https://dexscreener.com/${chainSlug(chainId)}/${contract}`,
  };
}

function chainSlug(chainId: number): string {
  switch (chainId) {
    case 1: return "ethereum";
    case 8453: return "base";
    case 42161: return "arbitrum";
    case 10: return "optimism";
    case 137: return "polygon";
    case 56: return "bsc";
    case 43114: return "avalanche";
    case 59144: return "linea";
    case 534352: return "scroll";
    case 324: return "zksync";
    default: return "ethereum";
  }
}

interface TokenLeg {
  contract: string; // lowercased; NATIVE_ADDRESS for ETH/BNB/etc.
  symbol: string;
  decimals: number;
  rawDelta: bigint; // signed wrt user (positive = received)
}

/** Aggregate one transaction's token movements relative to the user. */
function aggregateTx(
  hash: string,
  user: string,
  normal: EtherscanTx | undefined,
  erc20s: EtherscanTx[],
  chainId: number,
): {
  legs: TokenLeg[];
  timestamp: number;
  fee: number;
  counterparty: string | null;
  source: string | null;
  isError: boolean;
} {
  const userLc = user.toLowerCase();
  const legs = new Map<string, TokenLeg>();

  // Native value flow comes from the normal tx.
  if (normal && normal.value && normal.value !== "0") {
    const raw = BigInt(normal.value);
    const sign = normal.to.toLowerCase() === userLc ? 1n : normal.from.toLowerCase() === userLc ? -1n : 0n;
    if (sign !== 0n) {
      legs.set(NATIVE_ADDRESS, {
        contract: NATIVE_ADDRESS,
        symbol: NATIVE_BY_CHAIN[chainId]?.symbol ?? "ETH",
        decimals: 18,
        rawDelta: raw * sign,
      });
    }
  }

  for (const ev of erc20s) {
    const contract = (ev.contractAddress ?? "").toLowerCase();
    if (!contract) continue;
    const raw = BigInt(ev.value || "0");
    const sign = ev.to.toLowerCase() === userLc ? 1n : ev.from.toLowerCase() === userLc ? -1n : 0n;
    if (sign === 0n) continue;
    const existing = legs.get(contract);
    if (existing) {
      existing.rawDelta += raw * sign;
    } else {
      legs.set(contract, {
        contract,
        symbol: ev.tokenSymbol || "TOKEN",
        decimals: Number(ev.tokenDecimal ?? 18),
        rawDelta: raw * sign,
      });
    }
  }

  const timestamp = Number(normal?.timeStamp ?? erc20s[0]?.timeStamp ?? 0);
  const fee =
    normal?.gasUsed && normal?.gasPrice
      ? Number(BigInt(normal.gasUsed) * BigInt(normal.gasPrice)) / 1e18
      : 0;

  // Counterparty heuristic: the "other side" of the dominant erc20 transfer,
  // or the to/from of the native tx.
  let counterparty: string | null = null;
  const dominant = erc20s.find((e) => e.to.toLowerCase() === userLc || e.from.toLowerCase() === userLc);
  if (dominant) {
    counterparty = dominant.to.toLowerCase() === userLc ? dominant.from : dominant.to;
  } else if (normal) {
    counterparty = normal.to.toLowerCase() === userLc ? normal.from : normal.to;
  }

  const source = normal?.functionName?.split("(")[0] || null;

  return {
    legs: Array.from(legs.values()).filter((l) => l.rawDelta !== 0n),
    timestamp,
    fee,
    counterparty,
    source,
    isError: normal?.isError === "1",
  };
}

function classifyAndPrice(
  hash: string,
  agg: ReturnType<typeof aggregateTx>,
  lifi: Map<string, LifiToken>,
  chainId: number,
  nativePriceUsd: number | null,
): ParsedTx | null {
  if (agg.isError) return null;
  if (agg.legs.length === 0) return null;

  const inLegs = agg.legs.filter((l) => l.rawDelta > 0n);
  const outLegs = agg.legs.filter((l) => l.rawDelta < 0n);

  const legAmount = (l: TokenLeg) => Number(l.rawDelta < 0n ? -l.rawDelta : l.rawDelta) / Math.pow(10, l.decimals);

  const buildSide = (l: TokenLeg) => {
    const meta = tokenMeta(l.contract, { symbol: l.symbol, decimals: l.decimals }, lifi, chainId);
    return {
      contract: l.contract,
      symbol: meta.symbol,
      amount: legAmount(l),
      priceUsd:
        l.contract === NATIVE_ADDRESS ? nativePriceUsd ?? meta.priceUsd : meta.priceUsd,
    };
  };

  // Swap: at least one IN and one OUT leg (the gas-only native debit
  // accompanying an erc20 → erc20 swap doesn't count as a real OUT leg
  // because we filtered the legs map to non-zero token deltas only — the
  // native fee is tracked separately under `fee`).
  if (inLegs.length >= 1 && outLegs.length >= 1) {
    // Pick the largest leg on each side as the "headline" pair.
    const inSorted = inLegs.map(buildSide).sort((a, b) => (b.amount * (b.priceUsd ?? 0)) - (a.amount * (a.priceUsd ?? 0)));
    const outSorted = outLegs.map(buildSide).sort((a, b) => (b.amount * (b.priceUsd ?? 0)) - (a.amount * (a.priceUsd ?? 0)));
    const inSide = inSorted[0];
    const outSide = outSorted[0];

    // USD value: prefer the quote side. If neither side is a quote we fall
    // back to whichever has a price.
    const outIsQuote = isQuote(chainId, outSide.contract);
    const inIsQuote = isQuote(chainId, inSide.contract);
    let valueUsd: number | null = null;
    if (outIsQuote && outSide.priceUsd != null) valueUsd = outSide.amount * outSide.priceUsd;
    else if (inIsQuote && inSide.priceUsd != null) valueUsd = inSide.amount * inSide.priceUsd;
    else if (outSide.priceUsd != null) valueUsd = outSide.amount * outSide.priceUsd;
    else if (inSide.priceUsd != null) valueUsd = inSide.amount * inSide.priceUsd;

    return {
      signature: hash,
      timestamp: agg.timestamp,
      type: "swap",
      description: `Swap ${outSide.symbol} → ${inSide.symbol}`,
      source: agg.source,
      fee: agg.fee,
      outToken: { mint: outSide.contract, symbol: outSide.symbol, amount: outSide.amount },
      inToken: { mint: inSide.contract, symbol: inSide.symbol, amount: inSide.amount },
      counterparty: agg.counterparty,
      valueUsd,
      chainId,
    };
  }

  // Single direction → transfer
  if (inLegs.length === 1 && outLegs.length === 0) {
    const side = buildSide(inLegs[0]);
    return {
      signature: hash,
      timestamp: agg.timestamp,
      type: "transfer_in",
      description: `Received ${side.symbol}`,
      source: agg.source,
      fee: agg.fee,
      inToken: { mint: side.contract, symbol: side.symbol, amount: side.amount },
      counterparty: agg.counterparty,
      valueUsd: side.priceUsd != null ? side.amount * side.priceUsd : null,
      chainId,
    };
  }
  if (outLegs.length === 1 && inLegs.length === 0) {
    const side = buildSide(outLegs[0]);
    return {
      signature: hash,
      timestamp: agg.timestamp,
      type: "transfer_out",
      description: `Sent ${side.symbol}`,
      source: agg.source,
      fee: agg.fee,
      outToken: { mint: side.contract, symbol: side.symbol, amount: side.amount },
      counterparty: agg.counterparty,
      valueUsd: side.priceUsd != null ? side.amount * side.priceUsd : null,
      chainId,
    };
  }

  return {
    signature: hash,
    timestamp: agg.timestamp,
    type: "other",
    description: agg.source ? `Contract call: ${agg.source}` : "Contract interaction",
    source: agg.source,
    fee: agg.fee,
    counterparty: agg.counterparty,
    valueUsd: null,
    chainId,
  };
}

// ----- PnL math -----

function computeTokenPnL(
  parsed: ParsedTx[],
  holdings: Map<string, { amount: number; priceUsd: number | null; symbol: string; name: string; logo: string | null }>,
  chainId: number,
  lifi: Map<string, LifiToken>,
): TokenPnL[] {
  const map = new Map<string, TokenPnL>();

  const ensure = (contract: string, fallbackSymbol: string) => {
    const key = contract.toLowerCase();
    let row = map.get(key);
    if (!row) {
      const meta = tokenMeta(contract, { symbol: fallbackSymbol }, lifi, chainId);
      row = {
        mint: contract,
        symbol: meta.symbol,
        name: meta.name,
        logo: meta.logo,
        buys: 0,
        sells: 0,
        costUsd: 0,
        proceedsUsd: 0,
        unitsBought: 0,
        unitsSold: 0,
        currentUnits: 0,
        currentPriceUsd: meta.priceUsd,
        currentValueUsd: null,
        realizedUsd: 0,
        unrealizedUsd: 0,
        pairUrl: meta.pairUrl,
      };
      map.set(key, row);
    }
    return row;
  };

  for (const tx of parsed) {
    if (tx.type !== "swap" || tx.valueUsd == null) continue;
    if (!tx.inToken || !tx.outToken) continue;

    // Buy: paid quote → received non-quote
    if (isQuote(chainId, tx.outToken.mint) && !isQuote(chainId, tx.inToken.mint)) {
      const row = ensure(tx.inToken.mint, tx.inToken.symbol);
      row.buys += 1;
      row.costUsd += tx.valueUsd;
      row.unitsBought += tx.inToken.amount;
    }
    // Sell: received quote ← sent non-quote
    else if (isQuote(chainId, tx.inToken.mint) && !isQuote(chainId, tx.outToken.mint)) {
      const row = ensure(tx.outToken.mint, tx.outToken.symbol);
      row.sells += 1;
      row.proceedsUsd += tx.valueUsd;
      row.unitsSold += tx.outToken.amount;
    }
    // Token-for-token: treat as sell of the OUT side and buy of the IN side
    // (using the swap's USD value as the bridge price for both halves).
    else if (!isQuote(chainId, tx.inToken.mint) && !isQuote(chainId, tx.outToken.mint)) {
      const sellRow = ensure(tx.outToken.mint, tx.outToken.symbol);
      sellRow.sells += 1;
      sellRow.proceedsUsd += tx.valueUsd;
      sellRow.unitsSold += tx.outToken.amount;
      const buyRow = ensure(tx.inToken.mint, tx.inToken.symbol);
      buyRow.buys += 1;
      buyRow.costUsd += tx.valueUsd;
      buyRow.unitsBought += tx.inToken.amount;
    }
  }

  // Merge in current holdings to compute unrealized.
  for (const [contract, h] of holdings) {
    const key = contract.toLowerCase();
    const row =
      map.get(key) ??
      ensure(contract, h.symbol);
    row.currentUnits = h.amount;
    row.currentPriceUsd = h.priceUsd ?? row.currentPriceUsd;
    row.currentValueUsd = row.currentPriceUsd != null ? h.amount * row.currentPriceUsd : null;
    if (h.logo && !row.logo) row.logo = h.logo;
    if (h.name && row.name === row.symbol) row.name = h.name;
  }

  // Realized: avg cost basis × units sold.
  // Unrealized: current value − avg cost basis × units held.
  for (const row of map.values()) {
    const avgCost = row.unitsBought > 0 ? row.costUsd / row.unitsBought : 0;
    row.realizedUsd = row.proceedsUsd - avgCost * row.unitsSold;
    if (row.currentValueUsd != null) {
      row.unrealizedUsd = row.currentValueUsd - avgCost * row.currentUnits;
    }
  }

  return Array.from(map.values()).filter(
    (r) => !isQuote(chainId, r.mint), // never PnL the stablecoins themselves
  );
}

// ----- Holdings snapshot via internal evm-wallet-balance -----

async function fetchHoldings(
  address: string,
  chainId: number,
  req: Request,
): Promise<Map<string, { amount: number; priceUsd: number | null; symbol: string; name: string; logo: string | null }>> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/evm-wallet-balance`;
  const auth = req.headers.get("Authorization") ?? `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ address, chainId }),
  });
  const map = new Map<string, { amount: number; priceUsd: number | null; symbol: string; name: string; logo: string | null }>();
  if (!resp.ok) return map;
  const data = await resp.json().catch(() => null);
  for (const h of data?.holdings ?? []) {
    map.set(String(h.address).toLowerCase(), {
      amount: Number(h.amount ?? 0),
      priceUsd: h.priceUsd ?? null,
      symbol: h.symbol ?? "TOKEN",
      name: h.name ?? h.symbol ?? "TOKEN",
      logo: h.logo ?? null,
    });
  }
  return map;
}

// ----- Main handler -----

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const address: string = (body.address ?? "").trim().toLowerCase();
    const chainId: number = Number(body.chainId ?? 1);
    const slice: "recent_txs" | "token_pnl" | "wallet_pnl" = body.slice ?? "wallet_pnl";
    const tokenFilter: string | null = body.tokenFilter ?? null;
    const limit: number = Math.min(Math.max(body.limit ?? 25, 5), 50);

    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return json({ error: "Invalid EVM address" }, 400);
    }
    if (!NATIVE_BY_CHAIN[chainId]) {
      return json({ error: `Unsupported chainId: ${chainId}` }, 400);
    }

    const apiKey = Deno.env.get("ETHERSCAN_API_KEY");
    if (!apiKey) return json({ error: "ETHERSCAN_API_KEY missing" }, 500);

    const cutoff = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;

    const [normal, erc20, lifi, holdings] = await Promise.all([
      etherscanList(chainId, address, "txlist", apiKey),
      etherscanList(chainId, address, "tokentx", apiKey),
      loadLifiTokenMap(chainId),
      fetchHoldings(address, chainId, req),
    ]);

    // Group both feeds by tx hash and keep only those within the window.
    const byHash = new Map<string, { normal?: EtherscanTx; erc20s: EtherscanTx[] }>();
    for (const t of normal) {
      if (Number(t.timeStamp) < cutoff) continue;
      const slot = byHash.get(t.hash) ?? { erc20s: [] };
      slot.normal = t;
      byHash.set(t.hash, slot);
    }
    for (const t of erc20) {
      if (Number(t.timeStamp) < cutoff) continue;
      const slot = byHash.get(t.hash) ?? { erc20s: [] };
      slot.erc20s.push(t);
      byHash.set(t.hash, slot);
    }

    // Native price for USD valuation of legs that touch ETH/BNB/etc.
    const nativeMeta = lifi.get(NATIVE_ADDRESS);
    const nativePriceUsd = nativeMeta?.priceUSD ? Number(nativeMeta.priceUSD) : null;

    const parsed: ParsedTx[] = [];
    for (const [hash, group] of byHash) {
      const agg = aggregateTx(hash, address, group.normal, group.erc20s, chainId);
      const tx = classifyAndPrice(hash, agg, lifi, chainId, nativePriceUsd);
      if (tx) parsed.push(tx);
    }
    parsed.sort((a, b) => b.timestamp - a.timestamp);
    parsed.splice(MAX_TXS);

    const tokenPnL = computeTokenPnL(parsed, holdings, chainId, lifi);

    const totals = {
      totalRealizedUsd: tokenPnL.reduce((s, t) => s + t.realizedUsd, 0),
      totalUnrealizedUsd: tokenPnL.reduce((s, t) => s + t.unrealizedUsd, 0),
      totalCostUsd: tokenPnL.reduce((s, t) => s + t.costUsd, 0),
      totalProceedsUsd: tokenPnL.reduce((s, t) => s + t.proceedsUsd, 0),
      currentPortfolioUsd: Array.from(holdings.values()).reduce(
        (s, h) => s + (h.priceUsd != null ? h.amount * h.priceUsd : 0),
        0,
      ),
      txCount: parsed.length,
    };

    if (slice === "recent_txs") {
      return json({
        address,
        windowDays: WINDOW_DAYS,
        txs: parsed.slice(0, limit),
        totalCount: parsed.length,
      });
    }

    if (slice === "token_pnl" && tokenFilter) {
      const target = tokenFilter.toLowerCase().replace(/^\$/, "");
      const match = tokenPnL.find(
        (t) => t.mint.toLowerCase() === target || t.symbol.toLowerCase() === target,
      );
      return json({
        address,
        windowDays: WINDOW_DAYS,
        token: match ?? null,
        recentTxs: parsed
          .filter(
            (p) =>
              (p.inToken && p.inToken.mint.toLowerCase() === (match?.mint.toLowerCase() ?? "")) ||
              (p.outToken && p.outToken.mint.toLowerCase() === (match?.mint.toLowerCase() ?? "")),
          )
          .slice(0, 10),
      });
    }

    return json({
      address,
      windowDays: WINDOW_DAYS,
      totals,
      tokens: tokenPnL
        .filter((t) => Math.abs(t.realizedUsd) + Math.abs(t.unrealizedUsd) + (t.currentValueUsd ?? 0) > 0.5)
        .sort(
          (a, b) =>
            Math.abs(b.realizedUsd + b.unrealizedUsd) - Math.abs(a.realizedUsd + a.unrealizedUsd),
        )
        .slice(0, 12),
      recentTxs: parsed.slice(0, 10),
    });
  } catch (e) {
    console.error("evm-wallet-pnl error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
