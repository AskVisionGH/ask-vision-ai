import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// LunarCrush v4 API.
// Docs: https://lunarcrush.com/developers/api/endpoints
// Auth: Bearer token in Authorization header.
//
// We hit two endpoints:
//   /coins/{symbol}/v1                   → metrics (galaxy_score, alt_rank, sentiment %, social_volume, etc)
//   /coins/{symbol}/time-series/v2       → 24-72h sparkline of social_volume, contributors, sentiment
//   /topic/{topic}/posts/v1              → top recent posts (X, Reddit, news) about the symbol
//
// Sentiment from LunarCrush is bullish_pct 0-100. We map to a 5-bucket verdict.

interface SocialPost {
  id: string;
  network: string;            // "twitter" | "reddit" | "news" | ...
  url: string;
  title: string;
  creatorName: string | null;
  creatorAvatar: string | null;
  interactions24h: number;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  postedAt: number;           // unix seconds
}

interface SentimentPoint {
  t: number;                  // unix seconds
  socialVolume: number;
  sentimentPct: number;       // 0-100
}

interface SocialSentimentData {
  symbol: string;
  name: string;
  topic: string;
  bullishPct: number | null;          // 0-100
  galaxyScore: number | null;          // 0-100, LunarCrush composite
  altRank: number | null;              // lower = better
  socialVolume24h: number | null;
  socialVolumeChangePct: number | null;
  contributors24h: number | null;
  sentimentVerdict: "very_bullish" | "bullish" | "neutral" | "bearish" | "very_bearish" | "unknown";
  headline: string;
  series: SentimentPoint[];
  topPosts: SocialPost[];
  sources: string[];
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query } = await req.json().catch(() => ({}));
    if (!query || typeof query !== "string") {
      return json({ error: "query required" }, 400);
    }

    const apiKey = Deno.env.get("LUNARCRUSH_API_KEY");
    if (!apiKey) return json({ error: "LunarCrush not configured" }, 500);

    const cleaned = query.trim().replace(/^\$/, "").toUpperCase();

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    // 1. Coin metrics
    const metricsResp = await fetch(
      `https://lunarcrush.com/api4/public/coins/${encodeURIComponent(cleaned)}/v1`,
      { headers },
    );

    if (!metricsResp.ok) {
      if (metricsResp.status === 404) {
        return json({ error: `No social data for "${cleaned}"` }, 404);
      }
      if (metricsResp.status === 401 || metricsResp.status === 403) {
        return json({ error: "LunarCrush API key invalid" }, 502);
      }
      return json({ error: "Couldn't reach social data" }, 502);
    }

    const metrics = await metricsResp.json();
    const m = metrics.data ?? metrics;

    // 2. Time series (24h, hourly buckets)
    let series: SentimentPoint[] = [];
    try {
      const tsResp = await fetch(
        `https://lunarcrush.com/api4/public/coins/${encodeURIComponent(cleaned)}/time-series/v2?bucket=hour&interval=1d`,
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

    // 3. Top posts (topic endpoint takes lowercase topic slug)
    let topPosts: SocialPost[] = [];
    try {
      const topic = cleaned.toLowerCase();
      const postsResp = await fetch(
        `https://lunarcrush.com/api4/public/topic/${encodeURIComponent(topic)}/posts/v1`,
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
            // LunarCrush post_sentiment: 1=very bearish, 5=very bullish.
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

    const bullishPct = numOrNull(m.percent_change_24h_bullish_sentiment ?? m.sentiment);
    const galaxyScore = numOrNull(m.galaxy_score);
    const altRank = numOrNull(m.alt_rank);
    const socialVolume24h = numOrNull(m.interactions_24h ?? m.social_volume_24h);
    const socialVolumeChangePct = numOrNull(m.percent_change_24h ?? m.social_volume_change_24h);
    const contributors24h = numOrNull(m.contributors_active ?? m.contributors_24h);
    const sentimentRaw = numOrNull(m.sentiment); // 0-100

    const verdict = bucketSentiment(sentimentRaw);
    const headline = buildHeadline({
      symbol: cleaned,
      bullishPct: sentimentRaw,
      socialVolumeChangePct,
      galaxyScore,
    });

    const out: SocialSentimentData = {
      symbol: cleaned,
      name: String(m.name ?? cleaned),
      topic: cleaned.toLowerCase(),
      bullishPct: sentimentRaw,
      galaxyScore,
      altRank,
      socialVolume24h,
      socialVolumeChangePct,
      contributors24h,
      sentimentVerdict: verdict,
      headline,
      series,
      topPosts,
      sources: ["LunarCrush"],
    };

    return json(out);
  } catch (e) {
    console.error("social-sentiment error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

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
}): string {
  const parts: string[] = [];
  if (args.bullishPct != null) {
    if (args.bullishPct >= 70) parts.push(`Crowd is bullish (${args.bullishPct.toFixed(0)}% positive)`);
    else if (args.bullishPct >= 55) parts.push(`Mildly positive (${args.bullishPct.toFixed(0)}%)`);
    else if (args.bullishPct <= 30) parts.push(`Crowd is bearish (${args.bullishPct.toFixed(0)}% positive)`);
    else if (args.bullishPct <= 45) parts.push(`Mildly negative (${args.bullishPct.toFixed(0)}%)`);
    else parts.push(`Mixed sentiment (${args.bullishPct.toFixed(0)}%)`);
  }
  if (args.socialVolumeChangePct != null && Math.abs(args.socialVolumeChangePct) >= 25) {
    parts.push(
      args.socialVolumeChangePct > 0
        ? `social volume +${args.socialVolumeChangePct.toFixed(0)}% in 24h`
        : `social volume ${args.socialVolumeChangePct.toFixed(0)}% in 24h`,
    );
  }
  if (args.galaxyScore != null && args.galaxyScore >= 70) {
    parts.push(`high Galaxy Score ${args.galaxyScore.toFixed(0)}`);
  }
  return parts.length ? parts.join(", ") : `Limited social signal for $${args.symbol}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
