import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  /** unix ms */
  publishedAt: number;
  summary: string | null;
  thumbnail: string | null;
  /** "article" | "reddit" | "blog" */
  kind: "article" | "reddit" | "blog";
}

interface NewsResponse {
  items: NewsItem[];
  fetchedAt: number;
  sources: string[];
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const settled = await Promise.allSettled([
      fetchSolanaFoundation(),
      fetchCoinDesk(),
      fetchDecrypt(),
      fetchReddit(),
      fetchCoinGecko(),
      fetchNitterSolana(),
    ]);

    const all: NewsItem[] = [];
    const sources: string[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value.length > 0) {
        all.push(...s.value);
        const src = s.value[0]?.source;
        if (src && !sources.includes(src)) sources.push(src);
      } else if (s.status === "rejected") {
        console.warn("[solana-news] source failed:", s.reason);
      }
    }

    // Dedupe by normalized title.
    const seen = new Set<string>();
    const deduped: NewsItem[] = [];
    for (const item of all) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    deduped.sort((a, b) => b.publishedAt - a.publishedAt);
    const items = deduped.slice(0, 12);

    const body: NewsResponse = {
      items,
      fetchedAt: Date.now(),
      sources,
    };
    if (items.length === 0) body.error = "No news could be fetched right now.";
    return json(body);
  } catch (e) {
    console.error("[solana-news] fatal:", e);
    return json({
      items: [],
      fetchedAt: Date.now(),
      sources: [],
      error: "Couldn't fetch news right now. Try again in a moment.",
    }, 200);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SOLANA_KEYWORDS = [
  "solana", "sol ", "$sol", "phantom", "jupiter", "jito", "magic eden",
  "pump.fun", "pumpfun", "helium", "bonk", "raydium", "marinade", "tensor",
  "drift", "kamino", "metaplex", "anchor", "firedancer", "saga",
];

function mentionsSolana(text: string): boolean {
  const t = text.toLowerCase();
  return SOLANA_KEYWORDS.some((kw) => t.includes(kw));
}

async function fetchWithTimeout(url: string, ms = 6000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "VisionBot/1.0 (+https://ask-vision-ai.lovable.app)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

// --- Solana Foundation blog (RSS) ---
async function fetchSolanaFoundation(): Promise<NewsItem[]> {
  const resp = await fetchWithTimeout("https://solana.com/news/rss.xml");
  if (!resp.ok) return [];
  const xml = await resp.text();
  return parseRss(xml, "Solana Foundation", "blog").slice(0, 6);
}

// --- CoinDesk RSS, filtered to Solana mentions ---
async function fetchCoinDesk(): Promise<NewsItem[]> {
  const resp = await fetchWithTimeout(
    "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml",
  );
  if (!resp.ok) return [];
  const xml = await resp.text();
  const items = parseRss(xml, "CoinDesk", "article");
  return items.filter((i) => mentionsSolana(`${i.title} ${i.summary ?? ""}`)).slice(0, 6);
}

// --- Decrypt RSS, filtered to Solana mentions ---
async function fetchDecrypt(): Promise<NewsItem[]> {
  const resp = await fetchWithTimeout("https://decrypt.co/feed");
  if (!resp.ok) return [];
  const xml = await resp.text();
  const items = parseRss(xml, "Decrypt", "article");
  return items.filter((i) => mentionsSolana(`${i.title} ${i.summary ?? ""}`)).slice(0, 6);
}

// --- Reddit r/solana hot ---
async function fetchReddit(): Promise<NewsItem[]> {
  const resp = await fetchWithTimeout("https://www.reddit.com/r/solana/hot.json?limit=15");
  if (!resp.ok) return [];
  const data = await resp.json();
  const children = data?.data?.children;
  if (!Array.isArray(children)) return [];
  return children
    .map((c: any) => c?.data)
    .filter((d: any) => d && !d.stickied && !d.over_18)
    .slice(0, 6)
    .map((d: any): NewsItem => {
      const url = d.url_overridden_by_dest && /^https?:\/\//.test(d.url_overridden_by_dest)
        ? d.url_overridden_by_dest
        : `https://www.reddit.com${d.permalink}`;
      const thumb = typeof d.thumbnail === "string" && /^https?:\/\//.test(d.thumbnail)
        ? d.thumbnail
        : null;
      return {
        id: `reddit-${d.id}`,
        title: String(d.title ?? "Untitled"),
        url,
        source: "r/solana",
        publishedAt: typeof d.created_utc === "number" ? Math.floor(d.created_utc * 1000) : Date.now(),
        summary: typeof d.selftext === "string" && d.selftext.length > 0
          ? d.selftext.slice(0, 240)
          : null,
        thumbnail: thumb,
        kind: "reddit",
      };
    });
}

// --- CoinGecko news, filtered to Solana mentions ---
async function fetchCoinGecko(): Promise<NewsItem[]> {
  const resp = await fetchWithTimeout("https://api.coingecko.com/api/v3/news");
  if (!resp.ok) return [];
  const data = await resp.json();
  const arr = Array.isArray(data?.data) ? data.data : [];
  const items: NewsItem[] = arr
    .map((n: any): NewsItem | null => {
      const attrs = n?.attributes ?? n;
      const title = attrs?.title;
      const url = attrs?.url;
      if (!title || !url) return null;
      const ts = attrs?.updated_at || attrs?.created_at;
      const publishedAt = ts ? Date.parse(ts) : Date.now();
      return {
        id: `cg-${n?.id ?? url}`,
        title: String(title),
        url: String(url),
        source: attrs?.news_site ? String(attrs.news_site) : "CoinGecko",
        publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
        summary: typeof attrs?.description === "string" ? attrs.description.slice(0, 240) : null,
        thumbnail: typeof attrs?.thumb_2x === "string" ? attrs.thumb_2x : null,
        kind: "article",
      };
    })
    .filter((x: NewsItem | null): x is NewsItem =>
      !!x && mentionsSolana(`${x.title} ${x.summary ?? ""}`)
    )
    .slice(0, 6);
  return items;
}

// --- Minimal RSS parser (channel/item) ---
function parseRss(xml: string, source: string, kind: NewsItem["kind"]): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRe) ?? [];
  for (const block of matches.slice(0, 30)) {
    const title = decodeEntities(extract(block, "title"));
    const link = extract(block, "link") || extractAttr(block, "link", "href");
    if (!title || !link) continue;
    const pubDate = extract(block, "pubDate") || extract(block, "dc:date") || extract(block, "published");
    const description = decodeEntities(extract(block, "description") || extract(block, "summary") || "");
    const cleanSummary = stripHtml(description).slice(0, 240) || null;
    const thumb = extractAttr(block, "media:content", "url")
      || extractAttr(block, "media:thumbnail", "url")
      || extractAttr(block, "enclosure", "url")
      || null;
    const ts = pubDate ? Date.parse(pubDate) : NaN;
    items.push({
      id: `${source}-${link}`,
      title,
      url: link,
      source,
      publishedAt: Number.isFinite(ts) ? ts : Date.now(),
      summary: cleanSummary,
      thumbnail: thumb,
      kind,
    });
  }
  return items;
}

function extract(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function extractAttr(block: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, "i");
  const m = block.match(re);
  return m ? m[1] : "";
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
