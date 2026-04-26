// EVM equivalent of `wallet-token-history` — drill into a single ERC-20 on a
// specific chain. Returns a buy/sell timeline, first-acquisition info, and
// realized PnL for that one token.
//
// We narrow the Etherscan query to `contractaddress=` so we only pay for
// transfers that touch the token of interest, then pair them with the
// matching native txlist row to recover what the wallet paid/received on the
// other side of each swap. This is the EVM analogue to wallet-token-history's
// per-mint Helius scan.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";
const ETH_LOGO =
  "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png";

interface ChainCfg {
  id: number;
  key: string;
  nativeSymbol: string;
  nativeCgId: string;
  nativeLogo: string;
  explorerTxBase: string;
}

const CHAINS: Record<number, ChainCfg> = {
  1: { id: 1, key: "ethereum", nativeSymbol: "ETH", nativeCgId: "ethereum", nativeLogo: ETH_LOGO, explorerTxBase: "https://etherscan.io/tx/" },
  10: { id: 10, key: "optimism", nativeSymbol: "ETH", nativeCgId: "ethereum", nativeLogo: ETH_LOGO, explorerTxBase: "https://optimistic.etherscan.io/tx/" },
  56: { id: 56, key: "bsc", nativeSymbol: "BNB", nativeCgId: "binancecoin", nativeLogo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png", explorerTxBase: "https://bscscan.com/tx/" },
  137: { id: 137, key: "polygon", nativeSymbol: "MATIC", nativeCgId: "matic-network", nativeLogo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png", explorerTxBase: "https://polygonscan.com/tx/" },
  324: { id: 324, key: "zksync", nativeSymbol: "ETH", nativeCgId: "ethereum", nativeLogo: ETH_LOGO, explorerTxBase: "https://explorer.zksync.io/tx/" },
  8453: { id: 8453, key: "base", nativeSymbol: "ETH", nativeCgId: "ethereum", nativeLogo: ETH_LOGO, explorerTxBase: "https://basescan.org/tx/" },
  42161: { id: 42161, key: "arbitrum", nativeSymbol: "ETH", nativeCgId: "ethereum", nativeLogo: ETH_LOGO, explorerTxBase: "https://arbiscan.io/tx/" },
  43114: { id: 43114, key: "avalanche", nativeSymbol: "AVAX", nativeCgId: "avalanche-2", nativeLogo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png", explorerTxBase: "https://snowtrace.io/tx/" },
  59144: { id: 59144, key: "linea", nativeSymbol: "ETH", nativeCgId: "ethereum", nativeLogo: ETH_LOGO, explorerTxBase: "https://lineascan.build/tx/" },
  534352: { id: 534352, key: "scroll", nativeSymbol: "ETH", nativeCgId: "ethereum", nativeLogo: ETH_LOGO, explorerTxBase: "https://scrollscan.com/tx/" },
};

const STABLE_SYMBOLS = new Set([
  "USDC", "USDC.E", "USDT", "USDT.E", "DAI", "DAI.E",
  "BUSD", "FDUSD", "PYUSD", "USDP", "TUSD", "GUSD", "LUSD", "FRAX",
]);
const NATIVE_QUOTE_SYMBOLS = new Set(["ETH", "WETH", "BNB", "WBNB", "MATIC", "WMATIC", "AVAX", "WAVAX"]);

const MAX_PAGES = 5;
const PAGE_SIZE = 1000;

interface LifiToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string | null;
  priceUSD?: string | null;
}

interface EtherscanTransfer {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  contractAddress?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
}

interface HistoryEvent {
  signature: string;       // tx hash (we keep the field name to match Solana shape)
  blockTime: number;
  side: "buy" | "sell" | "transfer_in" | "transfer_out";
  tokenAmount: number;     // positive = inflow, negative = outflow
  pairAddress: string | null;
  pairSymbol: string | null;
  pairAmount: number | null;
  valueUsd: number | null;
  explorerUrl: string;
}

const tokenCache = new Map<string, { ts: number; tokens: Map<string, LifiToken> }>();
const TOKEN_TTL_MS = 5 * 60 * 1000;

async function loadLifi(chainId: number): Promise<Map<string, LifiToken>> {
  const key = String(chainId);
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.ts < TOKEN_TTL_MS) return hit.tokens;
  const apiKey = Deno.env.get("LIFI_API_KEY");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-lifi-api-key"] = apiKey;
  const map = new Map<string, LifiToken>();
  try {
    const r = await fetch(`https://li.quest/v1/tokens?chains=${encodeURIComponent(key)}`, { headers });
    if (r.ok) {
      const data = await r.json();
      const list: LifiToken[] = data.tokens?.[key] ?? [];
      for (const t of list) if (t?.address) map.set(t.address.toLowerCase(), t);
    }
  } catch (e) {
    console.error("LI.FI fetch failed:", e);
  }
  tokenCache.set(key, { ts: Date.now(), tokens: map });
  return map;
}

async function etherscan<T = any>(
  chainId: number,
  module: string,
  action: string,
  params: Record<string, string>,
): Promise<T[]> {
  const apiKey = Deno.env.get("ETHERSCAN_API_KEY");
  if (!apiKey) throw new Error("ETHERSCAN_API_KEY missing");
  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", module);
  url.searchParams.set("action", action);
  url.searchParams.set("apikey", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString());
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d?.result) ? (d.result as T[]) : [];
}

function asBig(s: string | undefined): bigint {
  if (!s) return 0n;
  try { return BigInt(s); } catch { return 0n; }
}

const isStable = (sym: string) => STABLE_SYMBOLS.has(sym.toUpperCase());
const isNativeQuote = (sym: string) => NATIVE_QUOTE_SYMBOLS.has(sym.toUpperCase());
const isQuote = (sym: string) => isStable(sym) || isNativeQuote(sym);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const wallet: string = String(body.wallet ?? "").trim();
    const tokenAddr: string = String(body.token ?? body.mint ?? "").trim().toLowerCase();
    const chainId: number = Number(body.chainId ?? 1);
    const maxPages: number = Math.min(Math.max(Number(body.maxPages ?? 3), 1), MAX_PAGES);

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return json({ error: "Invalid wallet" }, 400);
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddr)) return json({ error: "Invalid token address" }, 400);
    const chain = CHAINS[chainId];
    if (!chain) return json({ error: `Unsupported chainId: ${chainId}` }, 400);

    const lifi = await loadLifi(chainId);
    const ownerLower = wallet.toLowerCase();

    // 1) Pull all transfers of the target token for this wallet (paginated).
    const tokenTransfers: EtherscanTransfer[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await etherscan<EtherscanTransfer>(chainId, "account", "tokentx", {
        contractaddress: tokenAddr,
        address: wallet,
        page: String(page),
        offset: String(PAGE_SIZE),
        sort: "desc",
      });
      tokenTransfers.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }

    if (tokenTransfers.length === 0) {
      return json({
        wallet,
        chainId,
        chain: chain.key,
        token: tokenAddr,
        events: [],
        firstAcquisition: null,
        netAmount: 0,
        realizedUsd: 0,
        totalBuys: 0,
        totalSells: 0,
      });
    }

    // 2) For each unique tx hash, fetch the matching txlist + tokentx rows so
    //    we can recover the "other side" of any swap. Etherscan exposes a
    //    per-hash endpoint via `txhash=` on `proxy/eth_getTransactionByHash`,
    //    but pulling the full tokentx + txlist over the same window is much
    //    cheaper than 1 RPC call per hash. We already have most rows; for
    //    efficiency, batch-fetch the ERC-20-only mirror once and union.
    const hashes = new Set(tokenTransfers.map((t) => t.hash));
    const oldestTs = Number(tokenTransfers[tokenTransfers.length - 1]?.timeStamp ?? 0);

    // Bound the secondary scans to the same time window.
    const startblock = "0";
    const endblock = "99999999";

    const [allTokenTx, allNativeTx] = await Promise.all([
      etherscan<EtherscanTransfer>(chainId, "account", "tokentx", {
        address: wallet,
        startblock,
        endblock,
        page: "1",
        offset: String(PAGE_SIZE),
        sort: "desc",
      }),
      etherscan<EtherscanTransfer>(chainId, "account", "txlist", {
        address: wallet,
        startblock,
        endblock,
        page: "1",
        offset: String(PAGE_SIZE),
        sort: "desc",
      }),
    ]);

    // Index counter-leg rows by hash.
    type Row = { t: EtherscanTransfer; isNative: boolean };
    const otherByHash = new Map<string, Row[]>();
    const indexRow = (t: EtherscanTransfer, isNative: boolean) => {
      if (!hashes.has(t.hash)) return;
      // Skip the target token rows — those are already in `tokenTransfers`.
      if (!isNative && (t.contractAddress ?? "").toLowerCase() === tokenAddr) return;
      const arr = otherByHash.get(t.hash) ?? [];
      arr.push({ t, isNative });
      otherByHash.set(t.hash, arr);
    };
    for (const t of allTokenTx) indexRow(t, false);
    for (const t of allNativeTx) indexRow(t, true);

    // 3) Build a HistoryEvent per tx hash from this wallet's perspective.
    const events: HistoryEvent[] = [];
    let netAmount = 0;
    let totalBuys = 0;
    let totalSells = 0;
    let realizedUsd = 0;
    let firstAcquisition: HistoryEvent | null = null;

    // First, aggregate target-token movement per hash so multi-leg swaps net out.
    const tokenNetByHash = new Map<string, { amount: number; ts: number; decimals: number; symbol: string }>();
    for (const t of tokenTransfers) {
      const decimals = Number(t.tokenDecimal ?? 18);
      const symbol = (t.tokenSymbol ?? "?").toUpperCase();
      const raw = asBig(t.value);
      if (raw === 0n) continue;
      const human = Number(raw) / Math.pow(10, decimals);
      const from = (t.from ?? "").toLowerCase();
      const to = (t.to ?? "").toLowerCase();
      let signed = 0;
      if (to === ownerLower && from !== ownerLower) signed = +human;
      else if (from === ownerLower && to !== ownerLower) signed = -human;
      else continue;
      const prev = tokenNetByHash.get(t.hash);
      const ts = Number(t.timeStamp);
      if (prev) {
        prev.amount += signed;
        if (ts > prev.ts) prev.ts = ts;
      } else {
        tokenNetByHash.set(t.hash, { amount: signed, ts, decimals, symbol });
      }
    }

    for (const [hash, info] of tokenNetByHash.entries()) {
      if (Math.abs(info.amount) < 1e-12) continue;

      // Find the "other side" of the swap, if any: the largest counter-leg
      // moving in the opposite direction of `info.amount`.
      const others = otherByHash.get(hash) ?? [];
      let pair: { addr: string; symbol: string; amount: number; price: number | null } | null = null;
      let bestScore = 0;

      for (const { t, isNative } of others) {
        const raw = asBig(t.value);
        if (raw === 0n) continue;
        const from = (t.from ?? "").toLowerCase();
        const to = (t.to ?? "").toLowerCase();
        const incoming = to === ownerLower && from !== ownerLower;
        const outgoing = from === ownerLower && to !== ownerLower;
        if (!incoming && !outgoing) continue;
        // For a BUY of the target, we expect the counter-leg to be OUTGOING.
        if (info.amount > 0 && !outgoing) continue;
        if (info.amount < 0 && !incoming) continue;

        let addr: string;
        let symbol: string;
        let amount: number;
        if (isNative) {
          addr = NATIVE_ADDRESS;
          symbol = chain.nativeSymbol;
          amount = Number(raw) / 1e18;
        } else {
          addr = (t.contractAddress ?? "").toLowerCase();
          symbol = (t.tokenSymbol ?? "?").toUpperCase();
          const decimals = Number(t.tokenDecimal ?? 18);
          amount = Number(raw) / Math.pow(10, decimals);
        }

        const meta = lifi.get(addr);
        const price = meta?.priceUSD ? Number(meta.priceUSD) : null;
        const score = price && price > 0 ? amount * price : amount;
        // Prefer recognized quote assets so we always book USD when possible.
        const bonus = isQuote(symbol) ? 1e6 : 0;
        if (score + bonus > bestScore) {
          bestScore = score + bonus;
          pair = { addr, symbol, amount, price };
        }
      }

      let valueUsd: number | null = null;
      if (pair) {
        if (isStable(pair.symbol)) valueUsd = pair.amount;
        else if (pair.price != null) valueUsd = pair.amount * pair.price;
      }

      const isSwap = !!pair;
      const side: HistoryEvent["side"] =
        info.amount > 0
          ? isSwap ? "buy" : "transfer_in"
          : isSwap ? "sell" : "transfer_out";

      const ev: HistoryEvent = {
        signature: hash,
        blockTime: info.ts,
        side,
        tokenAmount: info.amount,
        pairAddress: pair?.addr ?? null,
        pairSymbol: pair?.symbol ?? null,
        pairAmount: pair?.amount ?? null,
        valueUsd,
        explorerUrl: chain.explorerTxBase + hash,
      };
      events.push(ev);

      netAmount += info.amount;
      if (side === "buy") totalBuys += 1;
      if (side === "sell") totalSells += 1;
      if (side === "buy" && valueUsd != null) realizedUsd -= valueUsd;
      if (side === "sell" && valueUsd != null) realizedUsd += valueUsd;
    }

    // Native-price backfill for events we couldn't price (e.g. LI.FI missing
    // a long-tail chain's native). Identical pattern to wallet-pnl.
    const needsBackfill = events.some(
      (e) => e.valueUsd == null && e.pairAddress === NATIVE_ADDRESS && (e.pairAmount ?? 0) > 0,
    );
    if (needsBackfill) {
      let nativePrice: number | null = null;
      const nativeMeta = lifi.get(NATIVE_ADDRESS);
      const lifiPrice = nativeMeta?.priceUSD ? Number(nativeMeta.priceUSD) : NaN;
      if (Number.isFinite(lifiPrice) && lifiPrice > 0) nativePrice = lifiPrice;
      else {
        try {
          const r = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${chain.nativeCgId}&vs_currencies=usd`,
          );
          if (r.ok) {
            const d = await r.json();
            const p = Number(d?.[chain.nativeCgId]?.usd);
            if (Number.isFinite(p) && p > 0) nativePrice = p;
          }
        } catch (e) {
          console.error("native price backfill failed:", e);
        }
      }
      if (nativePrice != null) {
        for (const ev of events) {
          if (ev.valueUsd != null) continue;
          if (ev.pairAddress !== NATIVE_ADDRESS) continue;
          if (!ev.pairAmount) continue;
          ev.valueUsd = ev.pairAmount * nativePrice;
          if (ev.side === "buy") realizedUsd -= ev.valueUsd;
          if (ev.side === "sell") realizedUsd += ev.valueUsd;
        }
      }
    }

    // Sort newest first; first acquisition is the OLDEST inflow.
    events.sort((a, b) => b.blockTime - a.blockTime);
    const inflows = events.filter((e) => e.tokenAmount > 0);
    if (inflows.length > 0) {
      firstAcquisition = inflows[inflows.length - 1];
    }

    // Token meta (prefer LI.FI, fall back to first observed transfer)
    const meta = lifi.get(tokenAddr);
    const sample = tokenTransfers[0];
    const tokenMeta = {
      address: tokenAddr,
      symbol: meta?.symbol ?? sample?.tokenSymbol ?? "?",
      name: meta?.name ?? sample?.tokenSymbol ?? "Token",
      decimals: Number(meta?.decimals ?? sample?.tokenDecimal ?? 18),
      logo: meta?.logoURI ?? null,
      priceUsd: meta?.priceUSD ? Number(meta.priceUSD) : null,
    };

    return json({
      wallet,
      chainId,
      chain: chain.key,
      token: tokenMeta,
      events: events.slice(0, 50), // cap response size
      firstAcquisition,
      netAmount,
      realizedUsd,
      totalBuys,
      totalSells,
      scannedTransfers: tokenTransfers.length,
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
