import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SocialPost {
  id: string;
  network: string;
  url: string;
  title: string;
  creatorName: string | null;
  creatorAvatar: string | null;
  interactions24h: number;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  postedAt: number;
}

interface SentimentPoint {
  t: number;
  socialVolume: number;
  sentimentPct: number;
}

interface SocialSentimentData {
  symbol: string;
  name: string;
  topic: string;
  bullishPct: number | null;
  galaxyScore: number | null;
  altRank: number | null;
  socialVolume24h: number | null;
  socialVolumeChangePct: number | null;
  contributors24h: number | null;
  sentimentVerdict: "very_bullish" | "bullish" | "neutral" | "bearish" | "very_bearish" | "unknown";
  headline: string;
  series: SentimentPoint[];
  topPosts: SocialPost[];
  sources: string[];
  reportUrl?: string | null;
  error?: string;
}

interface ResolvedToken {
  symbol: string;
  name: string;
  topic: string;
  address: string | null;
}

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
};

const POSITIVE_WORDS = [
  "surge",
  "rally",
  "bullish",
  "breakout",
  "gain",
  "gains",
  "jump",
  "jumps",
  "soar",
  "soars",
  "rise",
  "rises",
  "record",
  "adoption",
  "partnership",
  "approval",
  "launch",
  "wins",
  "rebound",
  "recovery",
  "strength",
  "momentum",
  "uptrend",
  "outperform",
  "accumulate",
];

const NEGATIVE_WORDS = [
  "drop",
  "drops",
  "plunge",
  "plunges",
  "crash",
  "crashes",
  "bearish",
  "selloff",
  "slump",
  "hack",
  "exploit",
  "breach",
  "lawsuit",
  "fraud",
  "scam",
  "risk",
  "risks",
  "concern",
  "concerns",
  "dump",
  "weakness",
  "liquidation",
  "probe",
  "investigation",
  "downtrend",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query } = await req.json().catch(() => ({}));
    if (!query || typeof query !== "string") {
      return json({ error: "query required" }, 400);
    }

    const resolved = await resolveToken(query);

    const apiKey = Deno.env.get("LUNARCRUSH_API_KEY");
    if (apiKey) {
      const primary = await tryLunarCrush(resolved, apiKey);
      if (primary) return json(primary);
    }

    const fallback = await buildGoogleNewsFallback(resolved);
    return json(fallback);
  } catch (e) {
    console.error("social-sentiment error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function tryLunarCrush(resolved: ResolvedToken, apiKey: string): Promise<SocialSentimentData | null> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const metricsResp = await fetch(
    `https://lunarcrush.com/api4/public/coins/${encodeURIComponent(resolved.symbol)}/v1`,
    { headers },
  );

  if (!metricsResp.ok) {
    const body = await metricsResp.text().catch(() => "");
    console.warn("LunarCrush unavailable, falling back", { status: metricsResp.status, body: body.slice(0, 200) });
    return null;
  }

  const metrics = await metricsResp.json();
  const m = metrics.data ?? metrics;

  let series: SentimentPoint[] = [];
  try {
    const tsResp = await fetch(
      `https://lunarcrush.com/api4/public/coins/${encodeURIComponent(resolved.symbol)}/time-series/v2?bucket=hour&interval=1d`,
      { headers },
    );
    if (tsResp.ok) {
      const tsJson = await tsResp.json();
      const arr = (tsJson.data ?? []) as any[];
      series = arr
        .map((p) => ({
          t: Number(p.time ?? p.timestamp ?? 0),
          socialVolume: Number(p.social_volume ?? p.interactions ?? 0),
          sentimentPct: Number(p.sentiment ?? p.bullish_sentiment ?? 50),
        }))
        .filter((p) => p.t > 0);
    }
  } catch (e) {
    console.error("time-series fetch failed:", e);
  }

  let topPosts: SocialPost[] = [];
  try {
    const postsResp = await fetch(
      `https://lunarcrush.com/api4/public/topic/${encodeURIComponent(resolved.topic.toLowerCase())}/posts/v1`,
      { headers },
    );
    if (postsResp.ok) {
      const postsJson = await postsResp.json();
      const arr = (postsJson.data ?? []) as any[];
      topPosts = arr
        .slice(0, 8)
        .map((p) => {
          const interactions = Number(p.interactions_24h ?? p.interactions ?? 0);
          const sentScore = Number(p.post_sentiment ?? p.sentiment ?? 3);
          let sent: SocialPost["sentiment"] = "neutral";
          if (sentScore >= 4) sent = "positive";
          else if (sentScore <= 2) sent = "negative";
          return {
            id: String(p.id ?? p.post_link ?? Math.random()),
            network: String(p.post_type ?? p.network ?? "twitter"),
            url: String(p.post_link ?? p.url ?? ""),
            title: String(p.post_title ?? p.title ?? "").slice(0, 240),
            creatorName: p.creator_display_name ?? p.creator_name ?? null,
            creatorAvatar: p.creator_avatar ?? null,
            interactions24h: interactions,
            sentiment: sent,
            postedAt: Number(p.post_created ?? 0),
          };
        })
        .filter((p) => p.url && p.title);
    }
  } catch (e) {
    console.error("posts fetch failed:", e);
  }

  const sentimentRaw = numOrNull(m.sentiment);
  return {
    symbol: resolved.symbol,
    name: String(m.name ?? resolved.name),
    topic: resolved.topic.toLowerCase(),
    bullishPct: sentimentRaw,
    galaxyScore: numOrNull(m.galaxy_score),
    altRank: numOrNull(m.alt_rank),
    socialVolume24h: numOrNull(m.interactions_24h ?? m.social_volume_24h),
    socialVolumeChangePct: numOrNull(m.percent_change_24h ?? m.social_volume_change_24h),
    contributors24h: numOrNull(m.contributors_active ?? m.contributors_24h),
    sentimentVerdict: bucketSentiment(sentimentRaw),
    headline: buildHeadline({
      symbol: resolved.symbol,
      bullishPct: sentimentRaw,
      socialVolumeChangePct: numOrNull(m.percent_change_24h ?? m.social_volume_change_24h),
      galaxyScore: numOrNull(m.galaxy_score),
      sourceName: "LunarCrush",
    }),
    series,
    topPosts,
    sources: ["LunarCrush"],
    reportUrl: `https://lunarcrush.com/coins/${encodeURIComponent(resolved.topic.toLowerCase())}`,
  };
}

async function buildGoogleNewsFallback(resolved: ResolvedToken): Promise<SocialSentimentData> {
  if (resolved.address) {
    return {
      symbol: resolved.symbol,
      name: resolved.name,
      topic: resolved.topic,
      bullishPct: null,
      galaxyScore: null,
      altRank: null,
      socialVolume24h: null,
      socialVolumeChangePct: null,
      contributors24h: null,
      sentimentVerdict: "unknown",
      headline: `No reliable public news match for $${resolved.symbol} yet`,
      series: [],
      topPosts: [],
      sources: ["Google News"],
      reportUrl: null,
      error: "No reliable public social source found for this token yet.",
    };
  }

  const searchTerms = [resolved.symbol, resolved.name]
    .filter(Boolean)
    .map((term) => `\"${term}\"`)
    .join(" OR ");
  const rssQuery = `${searchTerms} crypto when:2d`;
  const reportUrl = `https://news.google.com/search?q=${encodeURIComponent(`${resolved.symbol} ${resolved.name} crypto`)}`;
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(rssQuery)}&hl=en-US&gl=US&ceid=US:en`;

  const resp = await fetch(rssUrl, {
    headers: { "User-Agent": "Mozilla/5.0 VisionBot/1.0" },
  });
  if (!resp.ok) {
    return {
      symbol: resolved.symbol,
      name: resolved.name,
      topic: resolved.topic,
      bullishPct: null,
      galaxyScore: null,
      altRank: null,
      socialVolume24h: null,
      socialVolumeChangePct: null,
      contributors24h: null,
      sentimentVerdict: "unknown",
      headline: `No sentiment source available for $${resolved.symbol}`,
      series: [],
      topPosts: [],
      sources: ["Google News"],
      reportUrl,
      error: "Couldn't reach fallback sentiment data",
    };
  }

  const xml = await resp.text();
  const items = parseGoogleNewsItems(xml);
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 24 * 60 * 60;
  const twoDaysAgo = now - 48 * 60 * 60;

  const last48h = items.filter((item) => item.postedAt >= twoDaysAgo);
  const last24h = last48h.filter((item) => item.postedAt >= dayAgo);
  const prev24h = last48h.filter((item) => item.postedAt < dayAgo);

  const bullishPct = computeBullishPct(last24h);
  const contributors24h = new Set(last24h.map((item) => item.creatorName).filter(Boolean)).size || null;
  const currentCount = last24h.length;
  const previousCount = prev24h.length;
  const socialVolumeChangePct = previousCount > 0
    ? ((currentCount - previousCount) / previousCount) * 100
    : currentCount > 0
      ? 100
      : 0;

  return {
    symbol: resolved.symbol,
    name: resolved.name,
    topic: resolved.topic,
    bullishPct,
    galaxyScore: null,
    altRank: null,
    socialVolume24h: currentCount,
    socialVolumeChangePct,
    contributors24h,
    sentimentVerdict: bucketSentiment(bullishPct),
    headline: buildHeadline({
      symbol: resolved.symbol,
      bullishPct,
      socialVolumeChangePct,
      galaxyScore: null,
      sourceName: "Google News",
    }),
    series: buildHourlySeries(last24h, now),
    topPosts: last24h.slice(0, 8),
    sources: ["Google News"],
    reportUrl,
  };
}

async function resolveToken(queryRaw: string): Promise<ResolvedToken> {
  const cleaned = queryRaw.trim().replace(/^\$/, "");
  const upper = cleaned.toUpperCase();
  const looksLikeMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleaned);
  const knownMint = KNOWN_MINTS[upper];

  try {
    let resp: Response;
    if (looksLikeMint || knownMint) {
      resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${knownMint ?? cleaned}`);
    } else {
      resp = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(cleaned)}`);
    }
    if (resp.ok) {
      const json = await resp.json();
      let pairs = (json.pairs ?? []).filter((p: any) => p.chainId === "solana");
      if (looksLikeMint || knownMint) {
        const expected = (knownMint ?? cleaned).toLowerCase();
        pairs = pairs.filter((p: any) => String(p.baseToken?.address ?? "").toLowerCase() === expected);
      }
      if (pairs.length) {
        pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        const top = pairs[0];
        return {
          symbol: String(top.baseToken?.symbol ?? upper).toUpperCase(),
          name: String(top.baseToken?.name ?? cleaned),
          topic: String(top.baseToken?.symbol ?? upper).toLowerCase(),
          address: String(top.baseToken?.address ?? "") || null,
        };
      }
    }
  } catch (e) {
    console.warn("token resolution failed:", e);
  }

  return {
    symbol: upper,
    name: cleaned,
    topic: cleaned.toLowerCase(),
    address: looksLikeMint ? cleaned : null,
  };
}

function parseGoogleNewsItems(xml: string): SocialPost[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  return items.map((item, idx) => {
    const title = decodeXml(extractTag(item, "title") ?? "").replace(/^<!\[CDATA\[|\]\]>$/g, "");
    const url = decodeXml(extractTag(item, "link") ?? "");
    const source = decodeXml(extractSource(item) ?? "Google News");
    const postedAt = Math.floor(new Date(extractTag(item, "pubDate") ?? 0).getTime() / 1000);
    return {
      id: `${postedAt}-${idx}-${title.slice(0, 24)}`,
      network: "news",
      url,
      title: title.replace(/\s+-\s+[^-]+$/, "").slice(0, 240),
      creatorName: source,
      creatorAvatar: null,
      interactions24h: 0,
      sentiment: classifyHeadline(title),
      postedAt: Number.isFinite(postedAt) ? postedAt : 0,
    } satisfies SocialPost;
  }).filter((item) => item.url && item.title && item.postedAt > 0);
}

function buildHourlySeries(posts: SocialPost[], now: number): SentimentPoint[] {
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const end = now - (23 - i) * 3600;
    return { t: end, socialVolume: 0, sentimentSum: 0, sentimentCount: 0 };
  });

  for (const post of posts) {
    const idx = Math.floor((post.postedAt - (now - 24 * 3600)) / 3600);
    if (idx < 0 || idx >= buckets.length) continue;
    buckets[idx].socialVolume += 1;
    buckets[idx].sentimentSum += sentimentToScore(post.sentiment);
    buckets[idx].sentimentCount += 1;
  }

  return buckets.map((bucket) => ({
    t: bucket.t,
    socialVolume: bucket.socialVolume,
    sentimentPct: bucket.sentimentCount ? bucket.sentimentSum / bucket.sentimentCount : 50,
  }));
}

function computeBullishPct(posts: SocialPost[]): number | null {
  if (!posts.length) return null;
  const score = posts.reduce((sum, post) => sum + sentimentToScore(post.sentiment), 0) / posts.length;
  return Math.max(0, Math.min(100, score));
}

function classifyHeadline(text: string): SocialPost["sentiment"] {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of POSITIVE_WORDS) if (lower.includes(word)) score += 1;
  for (const word of NEGATIVE_WORDS) if (lower.includes(word)) score -= 1;
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}

function sentimentToScore(sentiment: SocialPost["sentiment"]): number {
  if (sentiment === "positive") return 100;
  if (sentiment === "negative") return 0;
  return 50;
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ?? null;
}

function extractSource(xml: string): string | null {
  const match = xml.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
  return match?.[1] ?? null;
}

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bucketSentiment(pct: number | null): SocialSentimentData["sentimentVerdict"] {
  if (pct == null) return "unknown";
  if (pct >= 80) return "very_bullish";
  if (pct >= 60) return "bullish";
  if (pct >= 40) return "neutral";
  if (pct >= 20) return "bearish";
  return "very_bearish";
}

function buildHeadline(args: {
  symbol: string;
  bullishPct: number | null;
  socialVolumeChangePct: number | null;
  galaxyScore: number | null;
  sourceName: string;
}): string {
  const parts: string[] = [];
  if (args.bullishPct != null) {
    if (args.bullishPct >= 70) parts.push(`${args.sourceName} looks bullish (${args.bullishPct.toFixed(0)}% positive)`);
    else if (args.bullishPct >= 55) parts.push(`${args.sourceName} leans positive (${args.bullishPct.toFixed(0)}%)`);
    else if (args.bullishPct <= 30) parts.push(`${args.sourceName} looks bearish (${args.bullishPct.toFixed(0)}% positive)`);
    else if (args.bullishPct <= 45) parts.push(`${args.sourceName} leans negative (${args.bullishPct.toFixed(0)}%)`);
    else parts.push(`${args.sourceName} is mixed (${args.bullishPct.toFixed(0)}%)`);
  }
  if (args.socialVolumeChangePct != null && Math.abs(args.socialVolumeChangePct) >= 25) {
    parts.push(
      args.socialVolumeChangePct > 0
        ? `coverage +${args.socialVolumeChangePct.toFixed(0)}% vs prior day`
        : `coverage ${args.socialVolumeChangePct.toFixed(0)}% vs prior day`,
    );
  }
  if (args.galaxyScore != null && args.galaxyScore >= 70) {
    parts.push(`high Galaxy Score ${args.galaxyScore.toFixed(0)}`);
  }
  return parts.length ? parts.join(", ") : `Limited signal for $${args.symbol}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
