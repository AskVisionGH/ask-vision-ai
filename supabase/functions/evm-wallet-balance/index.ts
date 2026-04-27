import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createPublicClient,
  http,
  fallback,
  erc20Abi,
  type Address,
  type Chain,
} from "https://esm.sh/viem@2.21.55";
import {
  mainnet,
  arbitrum,
  optimism,
  base,
  polygon,
  bsc,
  avalanche,
  linea,
  scroll,
  zksync,
} from "https://esm.sh/viem@2.21.55/chains";

/**
 * Returns the user's holdings on a given EVM chain.
 *
 * Strategy:
 *   1. Pull the chain's verified token list from LI.FI (same source the
 *      picker uses, so prices line up exactly).
 *   2. Cap to TOP_N tokens by combined "verified + has logo + has price"
 *      ranking — multicalling 400 tokens per request would be wasteful
 *      and the picker only needs the wallet's "Your tokens" section.
 *   3. Read the wallet's native balance + multicall ERC-20 `balanceOf` for
 *      the candidate set.
 *   4. Map to UI-friendly amounts + USD value, drop dust below $1.
 *
 * Why server-side (vs wagmi useBalance loops in the client): a single
 * multicall is faster, doesn't spam the user's RPC, and lets us cache the
 * LI.FI token list across requests.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CHAIN_BY_ID: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
  [base.id]: base,
  [polygon.id]: polygon,
  [bsc.id]: bsc,
  [avalanche.id]: avalanche,
  [linea.id]: linea,
  [scroll.id]: scroll,
  [zksync.id]: zksync,
};

const TOP_N = 80;
const MIN_USD = 0.5;
const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

// LI.FI tokens cache (per chain). Keep a few minutes — token lists move slowly.
const tokenCache = new Map<string, { ts: number; tokens: LifiToken[] }>();
const TTL_MS = 5 * 60 * 1000;

interface LifiToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string | null;
  priceUSD?: string | null;
  coinKey?: string | null;
}

const CANONICAL_SYMBOLS = new Set([
  "ETH", "WETH", "BTC", "WBTC", "USDC", "USDT", "DAI", "MATIC", "WMATIC",
  "BNB", "WBNB", "AVAX", "WAVAX", "SOL", "WSOL", "ARB", "OP", "BASE",
  "LINK", "UNI", "AAVE", "CRV", "LDO", "MKR", "SNX", "FRAX", "LUSD",
  "PYUSD", "USDE", "SUSDE", "TUSD", "USDP", "GUSD", "EURC", "EURS",
  "STETH", "WSTETH", "RETH", "CBETH", "EZETH",
]);

const isCanonical = (t: LifiToken) =>
  CANONICAL_SYMBOLS.has((t.symbol ?? "").toUpperCase()) ||
  (t.coinKey != null && CANONICAL_SYMBOLS.has(t.coinKey.toUpperCase()));

async function loadLifiTokens(chainId: number): Promise<LifiToken[]> {
  const key = String(chainId);
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.tokens;

  const apiKey = Deno.env.get("LIFI_API_KEY");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-lifi-api-key"] = apiKey;

  const resp = await fetch(
    `https://li.quest/v1/tokens?chains=${encodeURIComponent(key)}`,
    { headers },
  );
  if (!resp.ok) {
    throw new Error(`LI.FI tokens ${resp.status}`);
  }
  const data = await resp.json();
  const list: LifiToken[] = data.tokens?.[key] ?? [];
  tokenCache.set(key, { ts: Date.now(), tokens: list });
  return list;
}

/**
 * Pick the top N candidates to balance-check. Verified canonical tokens
 * always make the cut; the rest are ranked by metadata richness so we
 * prioritize tokens the user is likely to actually hold.
 */
function pickCandidates(tokens: LifiToken[]): LifiToken[] {
  const seen = new Set<string>();
  const ranked = tokens
    .filter((t) => !!t.address && !!t.symbol)
    .map((t) => {
      const score =
        (isCanonical(t) ? 100 : 0) +
        (t.logoURI ? 10 : 0) +
        (t.priceUSD ? 5 : 0);
      return { t, score };
    })
    .sort((a, b) => b.score - a.score);

  const out: LifiToken[] = [];
  for (const { t } of ranked) {
    const k = t.address.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= TOP_N) break;
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const address = String(body?.address ?? "").trim();
    const chainId = Number(body?.chainId);

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return json({ error: "Invalid EVM address" }, 400);
    }
    const chain = CHAIN_BY_ID[chainId];
    if (!chain) {
      return json({ error: `Unsupported chainId: ${chainId}` }, 400);
    }

    const lifiTokens = await loadLifiTokens(chainId);
    const candidates = pickCandidates(lifiTokens);

    const client = createPublicClient({
      chain,
      transport: http(undefined, { batch: true, timeout: 15_000 }),
    });

    // Native balance is a separate eth_getBalance call.
    const native = lifiTokens.find(
      (t) => t.address.toLowerCase() === NATIVE_ADDRESS.toLowerCase(),
    );
    const nativePromise = client.getBalance({ address: address as Address });

    // ERC-20 balanceOf — Multicall3 batches these into one RPC round-trip
    // (viem auto-batches when batch:true on the transport AND the chain has
    // multicall3 in its definition, which all our supported chains do).
    const erc20Tokens = candidates.filter(
      (t) => t.address.toLowerCase() !== NATIVE_ADDRESS.toLowerCase(),
    );

    const balanceCalls = client.multicall({
      contracts: erc20Tokens.map((t) => ({
        address: t.address as Address,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [address as Address] as const,
      })),
      allowFailure: true,
    });

    const [nativeRaw, balanceResults] = await Promise.all([
      nativePromise,
      balanceCalls,
    ]);

    type Holding = {
      address: string;
      symbol: string;
      name: string;
      decimals: number;
      logo: string | null;
      priceUsd: number | null;
      amount: number;
      valueUsd: number | null;
    };

    const holdings: Holding[] = [];

    if (native && nativeRaw > 0n) {
      const decimals = native.decimals ?? 18;
      const amount = Number(nativeRaw) / Math.pow(10, decimals);
      const priceUsd = native.priceUSD ? Number(native.priceUSD) : null;
      holdings.push({
        address: NATIVE_ADDRESS,
        symbol: native.symbol,
        name: native.name,
        decimals,
        logo: native.logoURI ?? null,
        priceUsd,
        amount,
        valueUsd: priceUsd != null ? amount * priceUsd : null,
      });
    }

    erc20Tokens.forEach((tok, i) => {
      const r = balanceResults[i];
      if (!r || r.status !== "success") return;
      const raw = r.result as bigint;
      if (!raw || raw === 0n) return;
      const amount = Number(raw) / Math.pow(10, tok.decimals);
      const priceUsd = tok.priceUSD ? Number(tok.priceUSD) : null;
      const valueUsd = priceUsd != null ? amount * priceUsd : null;
      holdings.push({
        address: tok.address,
        symbol: tok.symbol,
        name: tok.name,
        decimals: tok.decimals,
        logo: tok.logoURI ?? null,
        priceUsd,
        amount,
        valueUsd,
      });
    });

    // Filter dust + sort by USD value desc (unknown-price tokens go last).
    const filtered = holdings
      .filter((h) => (h.valueUsd ?? 0) >= MIN_USD || h.priceUsd == null)
      .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

    return json({ holdings: filtered, scanned: candidates.length });
  } catch (e) {
    console.error("evm-wallet-balance error:", e);
    return json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
