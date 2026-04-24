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
  "moon","mooning","pump","pumping","bullish","bull","based","gem","ape","aping",
  "send","sending","ath","100x","10x","wagmi","lfg","lfgg","🚀","🔥","💎","👑",
  "bag","bags","accumulating","buying","loading","longing","up only","green",
  "rally","breakout","gains","jump","soar","rise","record","adoption","partnership",
  "approval","launch","wins","rebound","recovery","strength","momentum","uptrend",
  "support","holding","love","alpha",
];

const NEGATIVE_WORDS = [
  "rug","rugged","scam","scammer","dump","dumped","dumping","dead","dying","crash",
  "crashed","bearish","bear","ngmi","rekt","liq","liquidated","exit","jeet","jeets",
  "down","red","selling","sold","short","shorting","sus","fud","fake","honeypot",
  "drop","plunge","selloff","slump","hack","exploit","breach","lawsuit","fraud",
  "risk","concern","weakness","liquidation","probe","investigation","downtrend",
  "panic","fear",
];

const NOW = () => Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query } = await req.json().catch(() => ({}));
    if (!query || typeof query !== "string") {
      return json({ error: "query required" }, 400);
    }

    const resolved = await resolveToken(query);

    // Try LunarCrush first if credits are available — it's the richest signal.
    const lunarKey = Deno.env.get("LUNARCRUSH_API_KEY");
    if (lunarKey) {
      const primary = await tryLunarCrush(resolved, lunarKey);
      if (primary) return json(primary);
    }

    // Free sources, merged. Always runs.
    const merged = await buildFreeSentiment(resolved);
    return json(merged);
  } catch (e) {
    console.error("social-sentiment error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ─── Free sentiment: Pump.fun + Reddit + Farcaster + (optional) Twitter ──────

async function buildFreeSentiment(resolved: ResolvedToken): Promise<SocialSentimentData> {
  const sources: string[] = [];
  const allPosts: SocialPost[] = [];

  // Run all in parallel — any failure is silently dropped.
  const tasks: Promise<{ source: string; posts: SocialPost[] } | null>[] = [];

  if (resolved.address) {
    tasks.push(
      fetchPumpFunComments(resolved.address)
        .then((posts) => (posts.length ? { source: "Pump.fun", posts } : null))
        .catch((e) => {
          console.warn("pump.fun fetch failed:", e);
          return null;
        }),
    );
  }

  tasks.push(
    fetchRedditPosts(resolved)
      .then((posts) => (posts.length ? { source: "Reddit", posts } : null))
      .catch((e) => {
        console.warn("reddit fetch failed:", e);
        return null;
      }),
  );

  // Hacker News via Algolia search — fully open, no auth, no UA gating.
  // Great signal for major coins (BTC/ETH/SOL) which Reddit + Pump.fun miss.
  tasks.push(
    fetchHackerNewsPosts(resolved)
      .then((posts) => (posts.length ? { source: "Hacker News", posts } : null))
      .catch((e) => {
        console.warn("hn fetch failed:", e);
        return null;
      }),
  );

  const neynarKey = Deno.env.get("NEYNAR_API_KEY");
  if (neynarKey) {
    tasks.push(
      fetchFarcasterCasts(resolved, neynarKey)
        .then((posts) => (posts.length ? { source: "Farcaster", posts } : null))
        .catch((e) => {
          console.warn("farcaster fetch failed:", e);
          return null;
        }),
    );
  }

  const twitterToken = Deno.env.get("TWITTER_BEARER_TOKEN");
  if (twitterToken) {
    tasks.push(
      fetchTwitterPosts(resolved, twitterToken)
        .then((posts) => (posts.length ? { source: "Twitter/X", posts } : null))
        .catch((e) => {
          console.warn("twitter fetch failed:", e);
          return null;
        }),
    );
  }



  const settled = await Promise.all(tasks);
  for (const result of settled) {
    if (!result) continue;
    sources.push(result.source);
    allPosts.push(...result.posts);
  }

  // Upgrade sentiment with Lovable AI on the most relevant posts (last 48h, by recency).
  // Keyword scoring stays as fallback if the AI call fails.
  if (allPosts.length > 0) {
    const twoDaysAgo = NOW() - 2 * DAY;
    const recent = allPosts
      .filter((p) => p.postedAt >= twoDaysAgo)
      .sort((a, b) => b.postedAt - a.postedAt)
      .slice(0, 80);
    if (recent.length > 0) {
      try {
        const aiVerdicts = await classifyPostsWithAI(recent, resolved);
        if (aiVerdicts) {
          const byId = new Map(recent.map((p) => [p.id, p] as const));
          for (const [id, verdict] of aiVerdicts.entries()) {
            const p = byId.get(id);
            if (p) p.sentiment = verdict;
          }
        }
      } catch (e) {
        console.warn("AI sentiment classification failed, keeping keyword scores:", e);
      }
    }
  }

  if (allPosts.length === 0) {
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
      headline: `No social chatter found for $${resolved.symbol} in the last 48h`,
      series: [],
      topPosts: [],
      sources: ["Pump.fun", "Reddit", "Hacker News", neynarKey ? "Farcaster" : null].filter(Boolean) as string[],
      reportUrl: null,
      error: `No reliable social data for $${resolved.symbol} yet — too new or too quiet.`,
    };
  }

  const now = NOW();
  const dayAgo = now - DAY;
  const twoDaysAgo = now - 2 * DAY;

  const last48h = allPosts.filter((p) => p.postedAt >= twoDaysAgo);
  const last24h = last48h.filter((p) => p.postedAt >= dayAgo);
  const prev24h = last48h.filter((p) => p.postedAt < dayAgo);

  const bullishPct = computeBullishPct(last24h);
  const contributors24h = new Set(last24h.map((p) => p.creatorName).filter(Boolean)).size || null;
  const currentCount = last24h.length;
  const previousCount = prev24h.length;
  const socialVolumeChangePct = previousCount > 0
    ? ((currentCount - previousCount) / previousCount) * 100
    : currentCount > 0
      ? 100
      : 0;

  // Surface the most-engaged posts up to 8.
  const topPosts = [...last24h]
    .sort((a, b) => b.interactions24h - a.interactions24h || b.postedAt - a.postedAt)
    .slice(0, 8);

  const reportUrl = sources.includes("Pump.fun") && resolved.address
    ? `https://pump.fun/${resolved.address}`
    : `https://www.google.com/search?q=${encodeURIComponent(`${resolved.symbol} ${resolved.name} crypto`)}`;

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
      sourceName: sources.join(" + ") || "Social",
    }),
    series: buildHourlySeries(last24h, now),
    topPosts,
    sources,
    reportUrl,
  };
}

// ─── Source: Pump.fun comments ───────────────────────────────────────────────
// Public endpoint: https://frontend-api.pump.fun/replies/{mint}?limit=...
async function fetchPumpFunComments(mint: string): Promise<SocialPost[]> {
  const resp = await fetch(`https://frontend-api-v3.pump.fun/replies/${mint}?limit=200&offset=0`, {
    headers: { "User-Agent": "Mozilla/5.0 VisionBot/1.0", Accept: "application/json" },
  });
  if (!resp.ok) {
    // fallback to v2 host
    const r2 = await fetch(`https://frontend-api.pump.fun/replies/${mint}?limit=200&offset=0`, {
      headers: { "User-Agent": "Mozilla/5.0 VisionBot/1.0", Accept: "application/json" },
    });
    if (!r2.ok) {
      console.warn("pump.fun replies non-OK", resp.status, r2.status);
      return [];
    }
    return parsePumpReplies(await r2.json(), mint);
  }
  return parsePumpReplies(await resp.json(), mint);
}

function parsePumpReplies(json: any, mint: string): SocialPost[] {
  const arr = Array.isArray(json?.replies) ? json.replies : Array.isArray(json) ? json : [];
  return arr
    .map((r: any, idx: number) => {
      const text = String(r.text ?? r.content ?? "").trim();
      if (!text) return null;
      const ts = Number(r.timestamp ?? r.created_timestamp ?? r.created_at ?? 0);
      // Pump.fun timestamps are ms.
      const postedAt = ts > 1e12 ? Math.floor(ts / 1000) : ts;
      const author = r.username ?? r.user ?? r.creator ?? null;
      return {
        id: `pump-${r.id ?? idx}-${postedAt}`,
        network: "pumpfun",
        url: `https://pump.fun/${mint}`,
        title: text.slice(0, 240),
        creatorName: author ? String(author) : null,
        creatorAvatar: r.profile_image ?? null,
        interactions24h: Number(r.likes ?? 0),
        sentiment: classifyText(text),
        postedAt: Number.isFinite(postedAt) && postedAt > 0 ? postedAt : 0,
      } satisfies SocialPost;
    })
    .filter((p): p is SocialPost => !!p && p.postedAt > 0);
}

// ─── Source: Reddit search (no key required) ─────────────────────────────────
// Reddit aggressively blocks bot User-Agents (returns 403). We use a realistic
// browser UA + their old.reddit host which is more lenient. We also try the
// coin's primary subreddit when the symbol is a known major coin so we still
// get signal for BTC/ETH/etc that don't show up in general site search.
const SUBREDDIT_BY_SYMBOL: Record<string, string> = {
  BTC: "Bitcoin", ETH: "ethereum", SOL: "solana", XRP: "Ripple", DOGE: "dogecoin",
  ADA: "cardano", BNB: "binance", AVAX: "Avax", MATIC: "0xPolygon", POL: "0xPolygon",
  DOT: "Polkadot", LINK: "Chainlink", LTC: "litecoin", BCH: "Bitcoincash",
  TRX: "Tronix", ATOM: "cosmosnetwork", NEAR: "nearprotocol", ARB: "arbitrum",
  OP: "optimism", APT: "aptos", SUI: "SuiNetwork", TON: "TONcoinOfficial",
  PEPE: "pepecoin", SHIB: "Shibainucoin", UNI: "UniSwap", AAVE: "Aave_Official",
  JUP: "jupiterexchange", BONK: "Bonk", WIF: "dogwifhat",
};

async function fetchRedditPosts(resolved: ResolvedToken): Promise<SocialPost[]> {
  const term = resolved.symbol.length >= 3
    ? `"$${resolved.symbol}" OR "${resolved.name}"`
    : `"${resolved.name}"`;

  // Realistic browser UA — Reddit returns 403 for obvious bot UAs.
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const urls: string[] = [
    `https://www.reddit.com/search.json?q=${encodeURIComponent(term)}&sort=new&t=week&limit=50`,
  ];
  // Pull from the coin's flagship subreddit too if we know it.
  const subreddit = SUBREDDIT_BY_SYMBOL[resolved.symbol.toUpperCase()];
  if (subreddit) {
    urls.push(`https://www.reddit.com/r/${subreddit}/new.json?limit=50`);
  }

  const collected: any[] = [];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.warn("reddit non-OK", resp.status, url);
        continue;
      }
      const j = await resp.json();
      const children = j?.data?.children ?? [];
      collected.push(...children);
    } catch (e) {
      console.warn("reddit fetch error:", e);
    }
  }

  if (!collected.length) return [];

  // Dedupe by id.
  const seen = new Set<string>();
  return collected
    .map((child: any, idx: number) => {
      const d = child?.data ?? {};
      const title = String(d.title ?? "").trim();
      const body = String(d.selftext ?? "").trim();
      const text = [title, body].filter(Boolean).join(" — ");
      if (!text) return null;
      const postedAt = Number(d.created_utc ?? 0);
      return {
        id: `reddit-${d.id ?? idx}`,
        network: "reddit",
        url: `https://reddit.com${d.permalink ?? ""}`,
        title: text.slice(0, 240),
        creatorName: d.author ? `u/${d.author}` : null,
        creatorAvatar: null,
        interactions24h: Number(d.score ?? 0) + Number(d.num_comments ?? 0),
        sentiment: classifyText(text),
        postedAt,
      } satisfies SocialPost;
    })
    .filter((p: SocialPost | null): p is SocialPost => {
      if (!p || p.postedAt <= 0) return false;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
}

// ─── Source: Hacker News (Algolia) — fully open, no auth ─────────────────────
// Algolia HN search returns stories + comments mentioning the query. We pull
// the last week and let the 48h filter downstream do its job.
async function fetchHackerNewsPosts(resolved: ResolvedToken): Promise<SocialPost[]> {
  // Build a query that matches symbol or full name. Algolia treats space as AND
  // so we use the API's `query` param which does keyword search.
  const term = resolved.symbol.length >= 3
    ? `${resolved.symbol} ${resolved.name}`
    : resolved.name;
  const since = NOW() - 7 * DAY;
  const url =
    `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(term)}` +
    `&tags=(story,comment)&numericFilters=created_at_i>${since}&hitsPerPage=50`;

  const resp = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "VisionBot/1.0" },
  });
  if (!resp.ok) {
    console.warn("hn non-OK", resp.status);
    return [];
  }
  const json = await resp.json();
  const hits = (json?.hits ?? []) as any[];

  const symLower = resolved.symbol.toLowerCase();
  const nameLower = resolved.name.toLowerCase();

  return hits
    .map((h: any, idx: number) => {
      const title = String(h.title ?? h.story_title ?? "").trim();
      const text = String(h.comment_text ?? h.story_text ?? "")
        .replace(/<[^>]+>/g, " ")
        .trim();
      const combined = [title, text].filter(Boolean).join(" — ");
      if (!combined) return null;
      // Loose relevance gate — require either the symbol or the name to appear
      // in the combined text. Algolia's keyword search isn't strict enough on
      // its own (e.g. "BTC" can match unrelated acronyms).
      const lower = combined.toLowerCase();
      if (!lower.includes(symLower) && !lower.includes(nameLower)) return null;
      const postedAt = Number(h.created_at_i ?? 0);
      const objId = h.objectID ?? `${idx}`;
      return {
        id: `hn-${objId}`,
        network: "hackernews",
        url: `https://news.ycombinator.com/item?id=${objId}`,
        title: combined.slice(0, 240),
        creatorName: h.author ? `@${h.author}` : null,
        creatorAvatar: null,
        interactions24h: Number(h.points ?? 0) + Number(h.num_comments ?? 0),
        sentiment: classifyText(combined),
        postedAt,
      } satisfies SocialPost;
    })
    .filter((p: SocialPost | null): p is SocialPost => !!p && p.postedAt > 0);
}


async function fetchFarcasterCasts(resolved: ResolvedToken, apiKey: string): Promise<SocialPost[]> {
  const term = resolved.address ?? resolved.symbol;
  const url =
    `https://api.neynar.com/v2/farcaster/cast/search?q=${encodeURIComponent(term)}&limit=50`;

  const resp = await fetch(url, {
    headers: { "x-api-key": apiKey, Accept: "application/json" },
  });
  if (!resp.ok) {
    console.warn("neynar non-OK", resp.status, await resp.text().catch(() => ""));
    return [];
  }
  const json = await resp.json();
  const casts = json?.result?.casts ?? json?.casts ?? [];
  return casts
    .map((c: any, idx: number) => {
      const text = String(c.text ?? "").trim();
      if (!text) return null;
      const postedAt = Math.floor(new Date(c.timestamp ?? 0).getTime() / 1000);
      const reactions = Number(c.reactions?.likes_count ?? 0)
        + Number(c.reactions?.recasts_count ?? 0)
        + Number(c.replies?.count ?? 0);
      const username = c.author?.username ? `@${c.author.username}` : null;
      return {
        id: `fc-${c.hash ?? idx}`,
        network: "farcaster",
        url: c.author?.username
          ? `https://warpcast.com/${c.author.username}/${String(c.hash ?? "").slice(0, 10)}`
          : "https://warpcast.com",
        title: text.slice(0, 240),
        creatorName: username,
        creatorAvatar: c.author?.pfp_url ?? null,
        interactions24h: reactions,
        sentiment: classifyText(text),
        postedAt,
      } satisfies SocialPost;
    })
    .filter((p: SocialPost | null): p is SocialPost => !!p && p.postedAt > 0);
}

// ─── Source: Twitter/X (placeholder) ─────────────────────────────────────────
// Only runs if TWITTER_BEARER_TOKEN is configured. Free read access requires
// the X API Basic plan ($200/mo) at the moment, so this is wired but inert
// unless/until a key is added.
async function fetchTwitterPosts(resolved: ResolvedToken, bearer: string): Promise<SocialPost[]> {
  const term = resolved.address ?? `$${resolved.symbol}`;
  const url =
    `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(term)}&max_results=50` +
    `&tweet.fields=created_at,public_metrics,author_id&expansions=author_id` +
    `&user.fields=username,profile_image_url`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
  });
  if (!resp.ok) {
    console.warn("twitter non-OK", resp.status, await resp.text().catch(() => ""));
    return [];
  }
  const json = await resp.json();
  const tweets = json?.data ?? [];
  const users = new Map<string, any>();
  for (const u of json?.includes?.users ?? []) users.set(u.id, u);

  return tweets
    .map((t: any, idx: number) => {
      const text = String(t.text ?? "").trim();
      if (!text) return null;
      const postedAt = Math.floor(new Date(t.created_at ?? 0).getTime() / 1000);
      const m = t.public_metrics ?? {};
      const reactions = Number(m.like_count ?? 0)
        + Number(m.retweet_count ?? 0)
        + Number(m.reply_count ?? 0)
        + Number(m.quote_count ?? 0);
      const author = users.get(t.author_id);
      const username = author?.username ? `@${author.username}` : null;
      return {
        id: `tw-${t.id ?? idx}`,
        network: "twitter",
        url: author?.username
          ? `https://x.com/${author.username}/status/${t.id}`
          : `https://x.com/i/status/${t.id}`,
        title: text.slice(0, 240),
        creatorName: username,
        creatorAvatar: author?.profile_image_url ?? null,
        interactions24h: reactions,
        sentiment: classifyText(text),
        postedAt,
      } satisfies SocialPost;
    })
    .filter((p: SocialPost | null): p is SocialPost => !!p && p.postedAt > 0);
}

// ─── LunarCrush (kept as primary if key works) ───────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function classifyText(text: string): SocialPost["sentiment"] {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of POSITIVE_WORDS) if (lower.includes(word)) score += 1;
  for (const word of NEGATIVE_WORDS) if (lower.includes(word)) score -= 1;
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}

// Batch-classify posts with Lovable AI (Gemini Flash Lite) — fast, ~free, far
// more accurate than keyword scoring on sarcasm, slang, mixed signals, etc.
// Returns null on any failure so the caller falls back to keyword scores.
async function classifyPostsWithAI(
  posts: SocialPost[],
  resolved: ResolvedToken,
): Promise<Map<string, SocialPost["sentiment"]> | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey || posts.length === 0) return null;

  // Trim each post to a reasonable length to keep the prompt compact.
  const items = posts.map((p, i) => ({
    i,
    text: (p.title || "").replace(/\s+/g, " ").trim().slice(0, 280),
  }));

  const system =
    `You are a crypto social-sentiment classifier. For each post, decide whether it expresses ` +
    `bullish/positive, bearish/negative, or neutral sentiment about $${resolved.symbol} (${resolved.name}). ` +
    `Treat sarcasm, irony, and mixed sentiment carefully. Posts that are off-topic, spam, or unrelated to ` +
    `$${resolved.symbol} should be marked "neutral". Return one verdict per post.`;

  const user = JSON.stringify({ symbol: resolved.symbol, posts: items });

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "classify_posts",
            description: "Return a sentiment verdict for each input post by index.",
            parameters: {
              type: "object",
              properties: {
                verdicts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      i: { type: "integer" },
                      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
                    },
                    required: ["i", "sentiment"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["verdicts"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "classify_posts" } },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    console.warn("AI classify gateway error:", resp.status, t.slice(0, 200));
    return null;
  }

  const data = await resp.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  const argStr = call?.function?.arguments;
  if (typeof argStr !== "string") return null;

  let parsed: any;
  try {
    parsed = JSON.parse(argStr);
  } catch {
    return null;
  }

  const verdicts = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
  if (verdicts.length === 0) return null;

  const out = new Map<string, SocialPost["sentiment"]>();
  for (const v of verdicts) {
    const idx = Number(v?.i);
    const s = v?.sentiment;
    if (!Number.isInteger(idx) || idx < 0 || idx >= posts.length) continue;
    if (s === "positive" || s === "negative" || s === "neutral") {
      out.set(posts[idx].id, s);
    }
  }
  return out.size > 0 ? out : null;
}

function sentimentToScore(sentiment: SocialPost["sentiment"]): number {
  if (sentiment === "positive") return 100;
  if (sentiment === "negative") return 0;
  return 50;
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
        ? `chatter +${args.socialVolumeChangePct.toFixed(0)}% vs prior day`
        : `chatter ${args.socialVolumeChangePct.toFixed(0)}% vs prior day`,
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
