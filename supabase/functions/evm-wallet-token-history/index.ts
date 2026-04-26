// EVM Wallet → single-token history.
//
// Mirrors supabase/functions/wallet-token-history (Solana) so the chat UI's
// WalletTokenHistoryCard renders the same shape. Etherscan v2's token-tx feed
// gives us the full ERC-20 (or native) movement history for one (wallet, token)
// pair in chronological order, classified per tx as buy / sell / transfer.
//
// What's intentionally simpler than the Solana version:
//   - No DB cache: Etherscan returns up to 10K records per call, so even very
//     active wallets fit in a single response. We can revisit caching once we
//     see real load.
//   - No partial-scan handling: `fullyScanned` is always true unless we hit
//     the 10K cap (rare for a single token). Kept as a field so the LLM
//     description stays consistent across chains.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

const STABLES: Record<number, Set<string>> = {
  1: new Set([
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "0xdac17f958d2ee523a2206206994597c13d831ec7",
    "0x6b175474e89094c44da98b954eedeac495271d0f",
  ]),
  8453: new Set([
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
    "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
  ]),
  42161: new Set([
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
  ]),
  10: new Set([
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    "0x7f5c764cbc14f9669b88837ca1490cca17c31607",
    "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
  ]),
  137: new Set([
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
  ]),
  56: new Set([
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    "0x55d398326f99059ff775485246999027b3197955",
  ]),
  43114: new Set([
    "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
    "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
  ]),
  59144: new Set(["0x176211869ca2b568f2a7d4ee941e073a821ee1ff"]),
  534352: new Set(["0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4"]),
  324: new Set([
    "0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4",
    "0x493257fd37edb34451f62edf8d2a0c418852ba4c",
  ]),
};

const NATIVE_SYMBOL: Record<number, string> = {
  1: "ETH", 8453: "ETH", 42161: "ETH", 10: "ETH", 137: "POL",
  56: "BNB", 43114: "AVAX", 59144: "ETH", 534352: "ETH", 324: "ETH",
};

function isQuote(chainId: number, contract: string): boolean {
  const lc = contract.toLowerCase();
  return lc === NATIVE_ADDRESS || (STABLES[chainId]?.has(lc) ?? false);
}

interface EtherscanTokenTx {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
}

interface EtherscanNormalTx {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  isError?: string;
  functionName?: string;
}

async function etherscanFetch(
  chainId: number,
  params: Record<string, string>,
  apiKey: string,
): Promise<unknown[]> {
  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("apikey", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    console.error(`etherscan ${params.action} ${resp.status}`, await resp.text().catch(() => ""));
    return [];
  }
  const data = await resp.json();
  if (!Array.isArray(data.result)) return [];
  return data.result;
}

interface HistoryEvent {
  signature: string;
  timestamp: number;
  kind: "swap" | "transfer";
  side: "buy" | "sell" | "in" | "out";
  tokenAmount: number;
  valueUsd: number | null;
  pairSymbol: string | null;
  pairAmount: number | null;
  counterparty: string | null;
  source: string | null;
  chainId: number;
}

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

  try {
    const resp = await fetch(`https://li.quest/v1/tokens?chains=${encodeURIComponent(key)}`, { headers });
    if (!resp.ok) return new Map();
    const data = await resp.json();
    const list: LifiToken[] = data.tokens?.[key] ?? [];
    const map = new Map<string, LifiToken>();
    for (const t of list) if (t.address) map.set(t.address.toLowerCase(), t);
    tokenCache.set(key, { ts: Date.now(), tokens: map });
    return map;
  } catch {
    return new Map();
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const body = await req.json();
    const wallet: string = (body.wallet ?? "").trim().toLowerCase();
    const contract: string = (body.contract ?? body.mint ?? "").trim().toLowerCase();
    const chainId: number = Number(body.chainId ?? 1);
    const maxTxs: number = Math.min(Math.max(Number(body.maxTxs ?? 3000), 100), 10000);

    if (!/^0x[a-f0-9]{40}$/.test(wallet)) return json({ error: "Invalid wallet" }, 400);
    if (!/^0x[a-f0-9]{40}$/.test(contract)) return json({ error: "Invalid contract" }, 400);
    if (!NATIVE_SYMBOL[chainId]) return json({ error: `Unsupported chainId: ${chainId}` }, 400);

    const apiKey = Deno.env.get("ETHERSCAN_API_KEY");
    if (!apiKey) return json({ error: "ETHERSCAN_API_KEY missing" }, 500);

    // Etherscan v2 supports filtering tokentx by `contractaddress` — gives us
    // every transfer of this single token to/from the wallet across the chain.
    const tokenTxs = (await etherscanFetch(
      chainId,
      {
        module: "account",
        action: "tokentx",
        address: wallet,
        contractaddress: contract,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: String(Math.min(maxTxs, 10000)),
        sort: "asc",
      },
      apiKey,
    )) as EtherscanTokenTx[];

    if (tokenTxs.length === 0) {
      return json({
        wallet,
        contract,
        mint: contract, // alias for UI compat
        tokenSymbol: null,
        firstBuy: null,
        firstAcquisition: null,
        totalBuys: 0,
        totalSells: 0,
        transfersIn: 0,
        transfersOut: 0,
        netAmount: 0,
        realizedUsd: 0,
        events: [],
        eventsTruncated: false,
        eventsTotal: 0,
        signaturesScannedThisRun: 0,
        signaturesScannedTotal: 0,
        pagesThisRun: 1,
        fullyScanned: true,
        stoppedReason: "end" as const,
        oldestScannedAt: null,
        newestScannedAt: null,
        durationMs: Date.now() - startedAt,
        chainId,
      });
    }

    const tokenSymbol = tokenTxs[0].tokenSymbol;
    const tokenDecimals = Number(tokenTxs[0].tokenDecimal ?? 18);

    // Pull every "normal" tx for the same wallet so we can pair the token
    // transfer with the other side of a swap (USDC paid in, ETH spent, etc.).
    const hashes = new Set(tokenTxs.map((t) => t.hash));
    const normalTxs = (await etherscanFetch(
      chainId,
      {
        module: "account",
        action: "txlist",
        address: wallet,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "10000",
        sort: "desc",
      },
      apiKey,
    )) as EtherscanNormalTx[];
    const normalByHash = new Map<string, EtherscanNormalTx>();
    for (const t of normalTxs) {
      if (hashes.has(t.hash)) normalByHash.set(t.hash, t);
    }

    // Pull all erc20 movements for this wallet to find the "other side" of swaps.
    const allErc20 = (await etherscanFetch(
      chainId,
      {
        module: "account",
        action: "tokentx",
        address: wallet,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "10000",
        sort: "desc",
      },
      apiKey,
    )) as EtherscanTokenTx[];
    const otherErc20ByHash = new Map<string, EtherscanTokenTx[]>();
    for (const t of allErc20) {
      if (!hashes.has(t.hash)) continue;
      if (t.contractAddress.toLowerCase() === contract) continue;
      const arr = otherErc20ByHash.get(t.hash) ?? [];
      arr.push(t);
      otherErc20ByHash.set(t.hash, arr);
    }

    const lifi = await loadLifiTokenMap(chainId);
    const nativePriceUsd = (() => {
      const m = lifi.get(NATIVE_ADDRESS);
      return m?.priceUSD ? Number(m.priceUSD) : null;
    })();

    const events: HistoryEvent[] = [];
    let netAmount = 0;
    let totalBuys = 0;
    let totalSells = 0;
    let transfersIn = 0;
    let transfersOut = 0;

    for (const tx of tokenTxs) {
      const dir: "in" | "out" = tx.to.toLowerCase() === wallet ? "in" : "out";
      const amount = Number(BigInt(tx.value || "0")) / Math.pow(10, tokenDecimals);
      if (dir === "in") netAmount += amount;
      else netAmount -= amount;

      const counterparty = dir === "in" ? tx.from : tx.to;
      const others = otherErc20ByHash.get(tx.hash) ?? [];
      const normal = normalByHash.get(tx.hash);

      // Identify the "other side" — opposite-direction token leg or native value.
      const opposite = others.find((o) => (dir === "in" ? o.from.toLowerCase() === wallet : o.to.toLowerCase() === wallet));

      let pairSymbol: string | null = null;
      let pairAmount: number | null = null;
      let pairContract: string | null = null;
      let valueUsd: number | null = null;

      if (opposite) {
        pairSymbol = opposite.tokenSymbol;
        pairContract = opposite.contractAddress.toLowerCase();
        pairAmount = Number(BigInt(opposite.value || "0")) / Math.pow(10, Number(opposite.tokenDecimal ?? 18));
        if (isQuote(chainId, pairContract)) {
          // Quote-priced: stable = $1, otherwise look up LI.FI
          if (STABLES[chainId]?.has(pairContract)) {
            valueUsd = pairAmount;
          } else {
            const meta = lifi.get(pairContract);
            const px = meta?.priceUSD ? Number(meta.priceUSD) : null;
            if (px != null) valueUsd = pairAmount * px;
          }
        }
      } else if (normal && normal.value && normal.value !== "0") {
        // Native ETH/BNB/etc paid or received alongside the token transfer.
        const nativeAmount = Number(BigInt(normal.value)) / 1e18;
        const nativeFromUser = normal.from.toLowerCase() === wallet;
        const nativeToUser = normal.to.toLowerCase() === wallet;
        if ((dir === "in" && nativeFromUser) || (dir === "out" && nativeToUser)) {
          pairSymbol = NATIVE_SYMBOL[chainId];
          pairContract = NATIVE_ADDRESS;
          pairAmount = nativeAmount;
          if (nativePriceUsd != null) valueUsd = nativeAmount * nativePriceUsd;
        }
      }

      const isSwap = pairContract != null;
      const kind: "swap" | "transfer" = isSwap ? "swap" : "transfer";
      const side: "buy" | "sell" | "in" | "out" =
        isSwap ? (dir === "in" ? "buy" : "sell") : dir;

      if (kind === "swap") {
        if (side === "buy") totalBuys += 1;
        else totalSells += 1;
      } else {
        if (side === "in") transfersIn += 1;
        else transfersOut += 1;
      }

      events.push({
        signature: tx.hash,
        timestamp: Number(tx.timeStamp),
        kind,
        side,
        tokenAmount: amount,
        valueUsd,
        pairSymbol,
        pairAmount,
        counterparty,
        source: normal?.functionName?.split("(")[0] || null,
        chainId,
      });
    }

    // Realized PnL via average cost basis (mirrors Solana version's approach).
    let unitsBought = 0;
    let costUsd = 0;
    let proceedsUsd = 0;
    let unitsSold = 0;
    for (const e of events) {
      if (e.kind !== "swap" || e.valueUsd == null) continue;
      if (e.side === "buy") {
        unitsBought += e.tokenAmount;
        costUsd += e.valueUsd;
      } else if (e.side === "sell") {
        unitsSold += e.tokenAmount;
        proceedsUsd += e.valueUsd;
      }
    }
    const avgCost = unitsBought > 0 ? costUsd / unitsBought : 0;
    const realizedUsd = proceedsUsd - avgCost * unitsSold;

    const swaps = events.filter((e) => e.kind === "swap" && e.side === "buy");
    const acquisitions = events.filter(
      (e) => (e.kind === "swap" && e.side === "buy") || (e.kind === "transfer" && e.side === "in"),
    );
    const firstBuy = swaps.length > 0 ? swaps.reduce((a, b) => (a.timestamp < b.timestamp ? a : b)) : null;
    const firstAcquisition =
      acquisitions.length > 0 ? acquisitions.reduce((a, b) => (a.timestamp < b.timestamp ? a : b)) : null;

    const fullyScanned = tokenTxs.length < Math.min(maxTxs, 10000);
    const stoppedReason: "cap" | "end" = fullyScanned ? "end" : "cap";

    return json({
      wallet,
      contract,
      mint: contract, // UI compat
      chainId,
      tokenSymbol,
      firstBuy,
      firstAcquisition,
      totalBuys,
      totalSells,
      transfersIn,
      transfersOut,
      netAmount,
      realizedUsd,
      events: events
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 50),
      eventsTruncated: events.length > 50,
      eventsTotal: events.length,
      signaturesScannedThisRun: tokenTxs.length,
      signaturesScannedTotal: tokenTxs.length,
      pagesThisRun: 1,
      fullyScanned,
      stoppedReason,
      oldestScannedAt:
        tokenTxs.length > 0 ? new Date(Number(tokenTxs[0].timeStamp) * 1000).toISOString() : null,
      newestScannedAt:
        tokenTxs.length > 0
          ? new Date(Number(tokenTxs[tokenTxs.length - 1].timeStamp) * 1000).toISOString()
          : null,
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("evm-wallet-token-history error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
