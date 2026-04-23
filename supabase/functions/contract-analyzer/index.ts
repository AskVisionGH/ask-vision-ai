import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

type Verdict = "safe" | "caution" | "risky" | "danger" | "unknown";

interface RiskCheck {
  id: string;
  label: string;
  status: "good" | "warn" | "bad" | "unknown";
  detail: string;
}

interface RiskReport {
  symbol: string;
  name: string;
  address: string;
  logo: string | null;
  score: number;
  verdict: Verdict;
  headline: string;
  checks: RiskCheck[];
  sources: string[];
  stats: {
    topHolderPct: number | null;
    top10HolderPct: number | null;
    lpLockedPct: number | null;
    holderCount: number | null;
    mintAuthorityRevoked: boolean | null;
    freezeAuthorityRevoked: boolean | null;
  };
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const raw = String(body?.query ?? "").trim().replace(/^$/, "");
  if (!raw) return json({ error: "query required (mint or ticker)" }, 400);

  const upper = raw.toUpperCase();
  let mint = KNOWN_MINTS[upper] ?? null;
  if (!mint && BASE58_RE.test(raw)) mint = raw;

  if (!mint) {
    mint = await resolveTickerToMint(raw);
  }

  if (!mint) {
    return json({ error: `Couldn't find a Solana token for "${raw}"` }, 404);
  }

  try {
    const rug = await fetchRugCheck(mint);
    const helius = await fetchHeliusMintInfo(mint).catch(() => null);
    const dex = await fetchDexBasics(mint).catch(() => null);

    const report = buildReport({ mint, rug, helius, dex });
    return json(report);
  } catch (e) {
    console.error("contract-analyzer error:", e);
    return json(
      {
        error: e instanceof Error ? e.message : "Unknown error",
      },
      500,
    );
  }
});

async function fetchRugCheck(mint: string): Promise<any | null> {
  // Full /report has holder distribution, markets, and authority info.
  // /report/summary is much thinner — only score + named risks + lpLockedPct.
  // Try full first; fall back to summary if blocked or rate-limited.
  try {
    const resp = await fetch(
      `https://api.rugcheck.xyz/v1/tokens/${mint}/report`,
      { headers: { Accept: "application/json" } },
    );
    if (resp.ok) return await resp.json();
    console.warn("RugCheck full report non-200:", resp.status);
  } catch (e) {
    console.warn("RugCheck full report fetch failed:", e);
  }
  try {
    const resp = await fetch(
      `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`,
      { headers: { Accept: "application/json" } },
    );
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function fetchHeliusMintInfo(mint: string): Promise<any | null> {
  const apiKey = Deno.env.get("HELIUS_API_KEY");
  if (!apiKey) return null;

  try {
    const resp = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mint-info",
        method: "getAsset",
        params: { id: mint },
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.result ?? null;
  } catch {
    return null;
  }
}

async function fetchDexBasics(mint: string): Promise<{
  symbol: string;
  name: string;
  logo: string | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
} | null> {
  try {
    const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const pairs = (data.pairs ?? []).filter((p: any) => p.chainId === "solana");
    if (pairs.length === 0) return null;
    pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const top = pairs[0];
    return {
      symbol: top.baseToken?.symbol ?? "?",
      name: top.baseToken?.name ?? "Unknown",
      logo: top.info?.imageUrl ?? null,
      liquidityUsd: top.liquidity?.usd ?? null,
      marketCapUsd: top.marketCap ?? null,
    };
  } catch {
    return null;
  }
}

async function resolveTickerToMint(query: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const pairs = (data.pairs ?? []).filter((p: any) => p.chainId === "solana");
    if (!pairs.length) return null;
    pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    return pairs[0].baseToken?.address ?? null;
  } catch {
    return null;
  }
}

function buildReport(args: {
  mint: string;
  rug: any | null;
  helius: any | null;
  dex: Awaited<ReturnType<typeof fetchDexBasics>>;
}): RiskReport {
  const { mint, rug, helius, dex } = args;

  const sources: string[] = [];
  if (rug) sources.push("rugcheck");
  if (helius) sources.push("helius");
  if (dex) sources.push("dexscreener");

  const symbol =
    rug?.tokenMeta?.symbol ?? dex?.symbol ?? helius?.content?.metadata?.symbol ?? "?";
  const name =
    rug?.tokenMeta?.name ?? dex?.name ?? helius?.content?.metadata?.name ?? "Unknown";
  const logo =
    rug?.fileMeta?.image ??
    dex?.logo ??
    helius?.content?.links?.image ??
    helius?.content?.files?.[0]?.cdn_uri ??
    helius?.content?.files?.[0]?.uri ??
    null;

  const mintAuthorityRevoked = readBool(
    rug?.token?.mintAuthority,
    rug?.tokenMeta?.mintAuthority,
    helius?.token_info?.mint_authority,
    helius?.authorities?.find?.((a: any) => a?.scopes?.includes?.("full"))?.address,
  );
  const freezeAuthorityRevoked = readBool(
    rug?.token?.freezeAuthority,
    rug?.tokenMeta?.freezeAuthority,
    helius?.token_info?.freeze_authority,
  );

  const topHolderPct = numOrNull(
    rug?.topHolders?.[0]?.pct,
    rug?.holders?.[0]?.pct,
  );
  const top10HolderPct = sumPct(
    (rug?.topHolders ?? rug?.holders ?? []).slice(0, 10).map((h: any) => h?.pct),
  );
  const holderCount = numOrNull(rug?.totalHolders, rug?.holders?.length);

  // LP locked %: full report has it per-market under markets[].lp.lpLockedPct;
  // summary endpoint has it at root as `lpLockedPct`. Prefer per-market average,
  // fall back to root-level value if that's all we have.
  const markets = Array.isArray(rug?.markets) ? rug.markets : [];
  const lpLockedPct =
    computeLpLockedPct(markets) ?? numOrNull(rug?.lpLockedPct, rug?.totalLPProviders);

  const checks: RiskCheck[] = [];

  if (mintAuthorityRevoked === true) {
    checks.push({
      id: "mint_authority",
      label: "Mint authority",
      status: "good",
      detail: "Revoked — no one can mint new supply.",
    });
  } else if (mintAuthorityRevoked === false) {
    checks.push({
      id: "mint_authority",
      label: "Mint authority",
      status: "bad",
      detail: "Active — the deployer can mint unlimited new supply.",
    });
  } else {
    checks.push({
      id: "mint_authority",
      label: "Mint authority",
      status: "unknown",
      detail: "Couldn't read mint authority status.",
    });
  }

  if (freezeAuthorityRevoked === true) {
    checks.push({
      id: "freeze_authority",
      label: "Freeze authority",
      status: "good",
      detail: "Revoked — your tokens can't be frozen.",
    });
  } else if (freezeAuthorityRevoked === false) {
    checks.push({
      id: "freeze_authority",
      label: "Freeze authority",
      status: "warn",
      detail: "Active — the deployer can freeze your tokens.",
    });
  } else {
    checks.push({
      id: "freeze_authority",
      label: "Freeze authority",
      status: "unknown",
      detail: "Couldn't read freeze authority status.",
    });
  }

  if (lpLockedPct == null) {
    checks.push({
      id: "lp_lock",
      label: "LP locked",
      status: "unknown",
      detail: "No LP lock data available.",
    });
  } else if (lpLockedPct >= 90) {
    checks.push({
      id: "lp_lock",
      label: "LP locked",
      status: "good",
      detail: `${lpLockedPct.toFixed(0)}% of liquidity is locked or burned.`,
    });
  } else if (lpLockedPct >= 50) {
    checks.push({
      id: "lp_lock",
      label: "LP locked",
      status: "warn",
      detail: `Only ${lpLockedPct.toFixed(0)}% of liquidity locked — partial rug risk.`,
    });
  } else {
    checks.push({
      id: "lp_lock",
      label: "LP locked",
      status: "bad",
      detail: `Only ${lpLockedPct.toFixed(0)}% locked — most liquidity could be pulled.`,
    });
  }

  if (top10HolderPct == null && topHolderPct == null) {
    checks.push({
      id: "concentration",
      label: "Holder concentration",
      status: "unknown",
      detail: "Couldn't read holder distribution.",
    });
  } else {
    const t10 = top10HolderPct ?? 0;
    const t1 = topHolderPct ?? 0;
    if (t1 >= 50 || t10 >= 80) {
      checks.push({
        id: "concentration",
        label: "Holder concentration",
        status: "bad",
        detail:
          t1 >= 50
            ? `Top wallet holds ${t1.toFixed(1)}% — extreme concentration.`
            : `Top 10 wallets hold ${t10.toFixed(1)}% — extreme concentration.`,
      });
    } else if (t1 >= 20 || t10 >= 50) {
      checks.push({
        id: "concentration",
        label: "Holder concentration",
        status: "warn",
        detail: `Top 10 wallets hold ${t10.toFixed(1)}% — meaningful concentration.`,
      });
    } else {
      checks.push({
        id: "concentration",
        label: "Holder concentration",
        status: "good",
        detail: `Top 10 wallets hold ${t10.toFixed(1)}% — well distributed.`,
      });
    }
  }

  const transferFeePct = numOrNull(
    rug?.transferFee?.pct,
    rug?.tokenMeta?.transferFeeBasisPoints
      ? rug.tokenMeta.transferFeeBasisPoints / 100
      : null,
  );
  if (transferFeePct != null && transferFeePct > 0) {
    checks.push({
      id: "transfer_tax",
      label: "Transfer tax",
      status: transferFeePct >= 5 ? "bad" : "warn",
      detail: `${transferFeePct.toFixed(1)}% tax on every transfer.`,
    });
  }

  const namedRisks: Array<{ name?: string; description?: string; level?: string }> =
    Array.isArray(rug?.risks) ? rug.risks : [];
  for (const r of namedRisks) {
    const nm = (r?.name ?? "").toLowerCase();
    if (!nm) continue;
    if (
      nm.includes("mint authority") ||
      nm.includes("freeze authority") ||
      nm.includes("lp") ||
      nm.includes("liquidity") ||
      nm.includes("holder") ||
      nm.includes("transfer fee")
    ) {
      continue;
    }
    const level = (r?.level ?? "").toLowerCase();
    const status: RiskCheck["status"] =
      level === "danger" ? "bad" : level === "warn" ? "warn" : "warn";
    checks.push({
      id: `rugcheck:${nm.replace(/\s+/g, "_")}`,
      label: r.name!,
      status,
      detail: r.description ?? "Flagged by RugCheck.",
    });
  }

  let score = 0;
  if (typeof rug?.score_normalised === "number") {
    score = clamp(Math.round(rug.score_normalised), 0, 100);
  } else if (typeof rug?.score === "number") {
    score = clamp(Math.round(rug.score / 50), 0, 100);
  } else {
    score = computeScoreFromChecks(checks);
  }

  const verdict = verdictFromScore(score, checks, !rug);
  const headline = headlineFor(verdict);

  return {
    symbol,
    name,
    address: mint,
    logo,
    score,
    verdict,
    headline,
    checks,
    sources,
    stats: {
      topHolderPct,
      top10HolderPct,
      lpLockedPct,
      holderCount,
      mintAuthorityRevoked,
      freezeAuthorityRevoked,
    },
  };
}

function readBool(...vals: any[]): boolean | null {
  for (const v of vals) {
    if (v === undefined) continue;
    if (v === null) return true;
    if (typeof v === "string") {
      if (v === "" || v === "null") return true;
      return false;
    }
    if (typeof v === "boolean") return v;
  }
  return null;
}

function numOrNull(...vals: any[]): number | null {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function sumPct(vals: any[]): number | null {
  const nums = vals.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0);
}

function computeLpLockedPct(markets: any[]): number | null {
  if (!markets.length) return null;
  const pcts: number[] = [];
  for (const m of markets) {
    const lp = m?.lp;
    const v = numOrNull(lp?.lpLockedPct, lp?.lockedPct);
    if (v != null) pcts.push(v);
  }
  if (!pcts.length) return null;
  return pcts.reduce((a, b) => a + b, 0) / pcts.length;
}

function computeScoreFromChecks(checks: RiskCheck[]): number {
  let s = 0;
  for (const c of checks) {
    if (c.status === "bad") s += 30;
    else if (c.status === "warn") s += 12;
  }
  return clamp(s, 0, 100);
}

function verdictFromScore(
  score: number,
  checks: RiskCheck[],
  noPrimarySource: boolean,
): Verdict {
  if (noPrimarySource && checks.every((c) => c.status === "unknown")) return "unknown";
  const hasBad = checks.some((c) => c.status === "bad");
  if (score >= 60 || (hasBad && score >= 35)) return "danger";
  if (score >= 35 || hasBad) return "risky";
  if (score >= 15) return "caution";
  return "safe";
}

function headlineFor(v: Verdict): string {
  switch (v) {
    case "safe":
      return "Looks clean";
    case "caution":
      return "Minor risks";
    case "risky":
      return "Notable risks";
    case "danger":
      return "High risk";
    default:
      return "Inconclusive";
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
