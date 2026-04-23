import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const KNOWN_MINTS: Record<string, string> = {
  SOL: "SOL",
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

const isBase58Pubkey = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const isMintFormat = (s: string) => isBase58Pubkey(s);

interface TokenMeta {
  symbol: string;
  name: string;
  address: string;
  mint: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
  isNative: boolean;
  tokenProgram: string;
}

async function resolveToken(input: string): Promise<TokenMeta | null> {
  const cleaned = input.trim().replace(/^\$/, "");
  const upper = cleaned.toUpperCase();

  if (upper === "SOL" || cleaned === SOL_MINT) {
    const priceUsd = await fetchSolPrice();
    return {
      symbol: "SOL",
      name: "Solana",
      address: "SOL",
      mint: SOL_MINT,
      decimals: 9,
      logo:
        "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
      priceUsd,
      isNative: true,
      tokenProgram: TOKEN_PROGRAM_ID,
    };
  }

  const mint = KNOWN_MINTS[upper] ?? (isMintFormat(cleaned) ? cleaned : null);
  if (!mint) return null;

  return await fetchSplMeta(mint);
}

async function fetchSolPrice(): Promise<number | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`);
    if (!r.ok) return null;
    const d = await r.json();
    const ps = ((d.pairs ?? []) as any[]).filter((p) => p.chainId === "solana");
    ps.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    return ps[0]?.priceUsd ? Number(ps[0].priceUsd) : null;
  } catch {
    return null;
  }
}

async function fetchSplMeta(mint: string): Promise<TokenMeta | null> {
  let decimals = 6;
  let symbol = "?";
  let name = "Unknown";
  let logo: string | null = null;
  let tokenProgram = TOKEN_PROGRAM_ID;

  try {
    const jupResp = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
    if (jupResp.ok) {
      const arr = await jupResp.json();
      const tok = Array.isArray(arr) ? arr.find((t: any) => t.id === mint) ?? arr[0] : null;
      if (tok) {
        decimals = tok.decimals ?? 6;
        symbol = tok.symbol ?? symbol;
        name = tok.name ?? name;
        logo = tok.icon ?? null;
        if (tok.tokenProgram) tokenProgram = tok.tokenProgram;
      }
    }
  } catch {
    /* ignore */
  }

  let priceUsd: number | null = null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (r.ok) {
      const d = await r.json();
      const ps = ((d.pairs ?? []) as any[]).filter((p) => p.chainId === "solana");
      ps.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      const top = ps[0];
      if (top) {
        priceUsd = top.priceUsd ? Number(top.priceUsd) : null;
        if (!logo) logo = top.info?.imageUrl ?? null;
        if (symbol === "?") symbol = top.baseToken?.symbol ?? symbol;
        if (name === "Unknown") name = top.baseToken?.name ?? name;
      }
    }
  } catch {
    /* ignore */
  }

  return {
    symbol,
    name,
    address: mint,
    mint,
    decimals,
    logo,
    priceUsd,
    isNative: false,
    tokenProgram,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const fromAddress: string = body.fromAddress ?? "";
    const tokenInput: string = body.token ?? "";
    const recipientInput: string = body.recipient ?? "";
    const resolvedAddress: string = body.resolvedAddress ?? "";
    const displayName: string | null = body.displayName ?? null;
    const amount = Number(body.amount);

    if (!fromAddress) return json({ error: "No wallet connected. Connect your wallet first." }, 400);
    if (!tokenInput) return json({ error: "token required" }, 400);
    if (!recipientInput) return json({ error: "recipient required" }, 400);
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ error: "amount must be a positive number" }, 400);
    }

    const tokenMeta = await resolveToken(tokenInput);
    if (!tokenMeta) {
      return json({ error: `Couldn't find token "${tokenInput}".` }, 404);
    }

    const toAddress = (resolvedAddress || recipientInput).trim();
    if (!isBase58Pubkey(toAddress)) {
      return json({ error: "Recipient must be a wallet address or .sol name." }, 400);
    }

    if (toAddress === fromAddress) {
      return json({ error: "You can't send to your own wallet." }, 400);
    }

    const amountAtomic = Math.floor(amount * Math.pow(10, tokenMeta.decimals));
    if (amountAtomic <= 0) {
      return json({ error: "Amount too small for this token's precision." }, 400);
    }

    const valueUsd = tokenMeta.priceUsd != null ? amount * tokenMeta.priceUsd : null;
    const estNetworkFeeSol = 0.000005;
    const needsAtaCreation = !tokenMeta.isNative;
    const ataCreationFeeSol = tokenMeta.isNative ? 0 : 0.00203928;

    return json({
      from: { address: fromAddress },
      to: { address: toAddress, displayName, isOnCurve: true },
      token: {
        symbol: tokenMeta.symbol,
        name: tokenMeta.name,
        mint: tokenMeta.mint,
        decimals: tokenMeta.decimals,
        logo: tokenMeta.logo,
        priceUsd: tokenMeta.priceUsd,
        isNative: tokenMeta.isNative,
        tokenProgram: tokenMeta.tokenProgram,
      },
      amountUi: amount,
      amountAtomic,
      valueUsd,
      needsAtaCreation,
      ataCreationFeeSol,
      estNetworkFeeSol,
      quotedAt: Date.now(),
    });
  } catch (e) {
    console.error("transfer-quote error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
