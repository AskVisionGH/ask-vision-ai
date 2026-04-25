import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Resolves natural-language bridge args ("0.5 SOL → ETH on Ethereum") into the
// concrete chain ids + token addresses LI.FI expects, then proxies to
// bridge-quote and returns a normalized payload the chat BridgePreviewCard can
// render directly. Phase 1 only supports Solana as the SOURCE chain.
//
// Body (all strings except amount):
//   inputToken      ticker or mint of the SOURCE token (must be on Solana)
//   outputToken     ticker or symbol of the DESTINATION token
//   fromChain       optional — chain name/key/id of source (defaults Solana)
//   toChain         destination chain name/key/id ("ethereum"/"eth"/"base"/1/...)
//   amount          decimal of the source token
//   fromAddress     user's connected Solana wallet
//   toAddress       optional destination wallet (required for cross-family bridges)
//   slippageBps     optional, defaults 50

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOLANA_CHAIN_ID = 1151111081099710;
const SOL_NATIVE = "11111111111111111111111111111111";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Common Solana mints — same shortcut table the swap tool uses, lets users
// say "USDC" instead of pasting the mint.
const SOLANA_KNOWN: Record<string, string> = {
  SOL: SOL_NATIVE,
  WSOL: WSOL_MINT,
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
};

interface NormalizedChain {
  id: number | string;
  key: string;
  name: string;
  logo: string | null;
  nativeSymbol: string;
  chainType: string;
}

interface NormalizedToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
}

let chainCache: { ts: number; data: NormalizedChain[] } | null = null;
const CHAIN_TTL = 10 * 60 * 1000;

async function lifiHeaders(): Promise<Record<string, string>> {
  const apiKey = Deno.env.get("LIFI_API_KEY");
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (apiKey) headers["x-lifi-api-key"] = apiKey;
  return headers;
}

async function loadChains(): Promise<NormalizedChain[]> {
  if (chainCache && Date.now() - chainCache.ts < CHAIN_TTL) return chainCache.data;
  const resp = await fetch("https://li.quest/v1/chains?chainTypes=SVM,EVM", {
    headers: await lifiHeaders(),
  });
  if (!resp.ok) throw new Error("Couldn't load LI.FI chain list");
  const data = await resp.json();
  const chains: NormalizedChain[] = (data.chains ?? []).map((c: any) => ({
    id: c.id,
    key: String(c.key ?? "").toLowerCase(),
    name: String(c.name ?? ""),
    logo: c.logoURI ?? null,
    nativeSymbol: c.nativeToken?.symbol ?? c.coin ?? "",
    chainType: c.chainType ?? "EVM",
  }));
  chainCache = { ts: Date.now(), data: chains };
  return chains;
}

// Map common spellings the AI might emit ("eth", "ethereum", "ETH mainnet")
// onto the LI.FI key. We compare lowercased against this then fall back to
// substring match against name/key.
const CHAIN_ALIASES: Record<string, string> = {
  eth: "eth",
  ether: "eth",
  ethereum: "eth",
  mainnet: "eth",
  arb: "arb",
  arbitrum: "arb",
  base: "bas",
  optimism: "opt",
  op: "opt",
  polygon: "pol",
  matic: "pol",
  bsc: "bsc",
  bnb: "bsc",
  avax: "ava",
  avalanche: "ava",
  sol: "sol",
  solana: "sol",
};

function findChain(input: string | undefined, chains: NormalizedChain[]): NormalizedChain | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  // Numeric id
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 0) {
    const byId = chains.find((c) => Number(c.id) === asNum);
    if (byId) return byId;
  }
  const lower = raw.toLowerCase();
  const aliasKey = CHAIN_ALIASES[lower];
  if (aliasKey) {
    const byKey = chains.find((c) => c.key === aliasKey);
    if (byKey) return byKey;
  }
  // Exact key match, then case-insensitive name match, then substring on name.
  return (
    chains.find((c) => c.key === lower) ??
    chains.find((c) => c.name.toLowerCase() === lower) ??
    chains.find((c) => c.name.toLowerCase().includes(lower)) ??
    null
  );
}

async function fetchSolanaMeta(mint: string): Promise<NormalizedToken | null> {
  // Same Jupiter lookup pattern swap-quote uses — gives us symbol/decimals/logo.
  try {
    const jupResp = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
    if (!jupResp.ok) return null;
    const arr = await jupResp.json();
    const tok = Array.isArray(arr) ? arr.find((t: any) => t.id === mint) ?? arr[0] : null;
    if (!tok) return null;
    return {
      address: mint,
      symbol: tok.symbol ?? "?",
      name: tok.name ?? "Unknown",
      decimals: tok.decimals ?? 9,
      logo: tok.icon ?? null,
      priceUsd: tok.usdPrice != null ? Number(tok.usdPrice) : null,
    };
  } catch {
    return null;
  }
}

async function resolveSolanaToken(input: string): Promise<NormalizedToken | null> {
  const cleaned = input.trim().replace(/^$/, "");
  const upper = cleaned.toUpperCase();
  if (SOLANA_KNOWN[upper]) {
    const mint = SOLANA_KNOWN[upper];
    const meta = await fetchSolanaMeta(mint);
    return meta ?? {
      address: mint,
      symbol: upper,
      name: upper,
      decimals: upper === "SOL" ? 9 : 6,
      logo: null,
      priceUsd: null,
    };
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleaned)) {
    return await fetchSolanaMeta(cleaned);
  }
  // Try a free-text Jupiter search.
  try {
    const jupResp = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(cleaned)}`,
    );
    if (!jupResp.ok) return null;
    const arr = await jupResp.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const tok = arr[0];
    return {
      address: tok.id,
      symbol: tok.symbol ?? "?",
      name: tok.name ?? cleaned,
      decimals: tok.decimals ?? 9,
      logo: tok.icon ?? null,
      priceUsd: tok.usdPrice != null ? Number(tok.usdPrice) : null,
    };
  } catch {
    return null;
  }
}

async function resolveLifiToken(
  chainId: number | string,
  symbolOrAddress: string,
): Promise<NormalizedToken | null> {
  // LI.FI's /token endpoint accepts either an address or a symbol per chain.
  const url = new URL("https://li.quest/v1/token");
  url.searchParams.set("chain", String(chainId));
  url.searchParams.set("token", symbolOrAddress);
  const resp = await fetch(url.toString(), { headers: await lifiHeaders() });
  if (!resp.ok) return null;
  const tok = await resp.json();
  if (!tok || !tok.address) return null;
  return {
    address: tok.address,
    symbol: tok.symbol ?? "?",
    name: tok.name ?? "Unknown",
    decimals: tok.decimals ?? 18,
    logo: tok.logoURI ?? null,
    priceUsd: tok.priceUSD != null ? Number(tok.priceUSD) : null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const inputToken: string = String(body.inputToken ?? "").trim();
    const outputToken: string = String(body.outputToken ?? "").trim();
    const fromChainArg = body.fromChain != null ? String(body.fromChain) : undefined;
    const toChainArg = body.toChain != null ? String(body.toChain) : undefined;
    const amount: number = Number(body.amount);
    const fromAddress: string = String(body.fromAddress ?? "").trim();
    const toAddressArg: string = String(body.toAddress ?? "").trim();
    const slippageBps: number = Number.isFinite(Number(body.slippageBps))
      ? Number(body.slippageBps)
      : 50;

    if (!inputToken) return json({ error: "Source token required (e.g. 'SOL', 'USDC')." });
    if (!outputToken) return json({ error: "Destination token required (e.g. 'ETH', 'USDC')." });
    if (!toChainArg) return json({ error: "Tell me which chain to bridge TO (e.g. 'Ethereum', 'Base', 'Arbitrum')." });
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Amount must be a positive number." });
    if (!fromAddress) return json({ error: "Connect a wallet so I can prepare the bridge." });

    const chains = await loadChains();
    const fromChain = fromChainArg ? findChain(fromChainArg, chains) : chains.find((c) => c.id === SOLANA_CHAIN_ID) ?? null;
    if (!fromChain) return json({ error: `I don't recognize the source chain "${fromChainArg ?? "Solana"}".` });
    if (Number(fromChain.id) !== SOLANA_CHAIN_ID) {
      // Phase 1 limitation — surfaced clearly so the AI can explain.
      return json({
        error:
          "Right now I can only bridge OUT of Solana. Bridging into Solana from another chain is coming — open the Bridge tab in /trade for the full UI.",
      });
    }

    const toChain = findChain(toChainArg, chains);
    if (!toChain) return json({ error: `I don't recognize the destination chain "${toChainArg}".` });
    if (Number(toChain.id) === Number(fromChain.id)) {
      return json({ error: "Source and destination chains are the same — no bridge needed." });
    }

    const fromToken = await resolveSolanaToken(inputToken);
    if (!fromToken) return json({ error: `Couldn't find "${inputToken}" on Solana.` });

    const toToken = await resolveLifiToken(toChain.id, outputToken);
    if (!toToken) return json({ error: `Couldn't find "${outputToken}" on ${toChain.name}.` });

    // Cross-family bridges (SOL→EVM) need a destination address on the
    // receiving chain. Same-family reuses the source.
    const sameFamily = fromChain.chainType === toChain.chainType;
    if (!sameFamily) {
      if (!toAddressArg) {
        return json({
          error:
            `To bridge to ${toChain.name} I need your ${toChain.chainType === "EVM" ? "Ethereum-style (0x…)" : "destination"} wallet address — please paste it and ask again.`,
        });
      }
      const validEvm = /^0x[a-fA-F0-9]{40}$/.test(toAddressArg);
      const validSvm = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(toAddressArg);
      if (toChain.chainType === "EVM" && !validEvm) {
        return json({ error: `That doesn't look like an Ethereum-style address. EVM addresses start with 0x and have 42 chars.` });
      }
      if (toChain.chainType === "SVM" && !validSvm) {
        return json({ error: `That doesn't look like a Solana address.` });
      }
    }
    const toAddress = sameFamily ? fromAddress : toAddressArg;

    const atomic = BigInt(Math.floor(amount * Math.pow(10, fromToken.decimals)));
    if (atomic <= 0n) return json({ error: "Amount is too small to bridge." });

    // Hand off to the existing bridge-quote function so we keep one fee path.
    const supaUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supaUrl || !anonKey) return json({ error: "Backend misconfigured" });
    const quoteResp = await fetch(`${supaUrl}/functions/v1/bridge-quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        fromChain: String(fromChain.id),
        toChain: String(toChain.id),
        fromToken: fromToken.address,
        toToken: toToken.address,
        fromAmount: atomic.toString(),
        fromAddress,
        toAddress,
        slippageBps,
      }),
    });
    if (!quoteResp.ok) {
      const t = await quoteResp.text().catch(() => "");
      let msg = "No bridge route found right now — try a different amount or chain.";
      try {
        const parsed = JSON.parse(t);
        if (parsed?.error) msg = parsed.error;
      } catch { /* ignore */ }
      return json({ error: msg });
    }
    const quote = await quoteResp.json();

    const toAmountUi = Number(quote.toAmountAtomic ?? "0") / Math.pow(10, toToken.decimals);
    const toAmountMinUi = Number(quote.toAmountMinAtomic ?? "0") / Math.pow(10, toToken.decimals);

    return json({
      fromChain: { id: fromChain.id, key: fromChain.key, name: fromChain.name, logo: fromChain.logo, chainType: fromChain.chainType },
      toChain: { id: toChain.id, key: toChain.key, name: toChain.name, logo: toChain.logo, chainType: toChain.chainType },
      fromToken: { ...fromToken, amountUi: amount, amountAtomic: atomic.toString() },
      toToken: { ...toToken, amountUi: toAmountUi, amountMinUi: toAmountMinUi },
      fromAddress,
      toAddress,
      sameFamily,
      slippageBps,
      executionDurationSec: quote.executionDurationSec ?? null,
      platformFeeUsd: quote.platformFeeUsd ?? null,
      gasFeeUsd: quote.gasFeeUsd ?? null,
      fromAmountUsd: quote.fromAmountUsd ?? null,
      toAmountUsd: quote.toAmountUsd ?? null,
      tool: quote.tool ?? null,
      toolName: quote.toolName ?? null,
      raw: quote.raw,
      quotedAt: quote.quotedAt ?? Date.now(),
    });
  } catch (e) {
    console.error("chat-bridge-quote error:", e);
    return json({ error: e instanceof Error ? e.message : "Couldn't prepare bridge." });
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
