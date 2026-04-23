import { ArrowUpRight, MessageCircle, TrendingUp, TrendingDown, Minus, Twitter, type LucideIcon } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/TokenLogo";
import type { SentimentVerdict, SocialSentimentData } from "@/lib/chat-stream";

interface Props {
  data: SocialSentimentData;
}

const VERDICT_STYLE: Record<
  SentimentVerdict,
  { ring: string; bg: string; text: string; Icon: LucideIcon; label: string }
> = {
  very_bullish: {
    ring: "border-up/40",
    bg: "bg-up/15",
    text: "text-up",
    Icon: TrendingUp,
    label: "Very bullish",
  },
  bullish: {
    ring: "border-up/30",
    bg: "bg-up/10",
    text: "text-up",
    Icon: TrendingUp,
    label: "Bullish",
  },
  neutral: {
    ring: "border-border",
    bg: "bg-muted/30",
    text: "text-muted-foreground",
    Icon: Minus,
    label: "Mixed",
  },
  bearish: {
    ring: "border-down/30",
    bg: "bg-down/10",
    text: "text-down",
    Icon: TrendingDown,
    label: "Bearish",
  },
  very_bearish: {
    ring: "border-down/40",
    bg: "bg-down/15",
    text: "text-down",
    Icon: TrendingDown,
    label: "Very bearish",
  },
  unknown: {
    ring: "border-border",
    bg: "bg-muted/20",
    text: "text-muted-foreground",
    Icon: Minus,
    label: "No signal",
  },
};

const fmtCount = (n: number | null): string => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1000) {
    return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
  }
  return n.toLocaleString("en-US");
};

const fmtPct = (n: number | null): string => {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}%`;
};

const POST_SENTIMENT_STYLE = {
  positive: "border-up/30 bg-up/10 text-up",
  negative: "border-down/30 bg-down/10 text-down",
  neutral: "border-border bg-secondary/40 text-muted-foreground",
  unknown: "border-border bg-secondary/40 text-muted-foreground",
} as const;

export const SocialSentimentCard = ({ data }: Props) => {
  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  const v = VERDICT_STYLE[data.sentimentVerdict];
  const VerdictIcon = v.Icon;
  const bullishPct = data.bullishPct ?? 50;
  const series = data.series.slice(-24).map((p) => ({ x: p.t, y: p.socialVolume }));
  const sparkColor = data.sentimentVerdict.includes("bullish")
    ? "hsl(var(--up))"
    : data.sentimentVerdict.includes("bearish")
      ? "hsl(var(--down))"
      : "hsl(var(--muted-foreground))";

  const volChange = data.socialVolumeChangePct ?? 0;
  const volIsUp = volChange >= 0;

  return (
    <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-4">
        <TokenLogo logo={null} symbol={data.symbol} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-medium text-foreground">${data.symbol}</span>
            <span className="truncate text-xs text-muted-foreground">{data.name}</span>
          </div>
          <p className="mt-0.5 font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
            Social sentiment
          </p>
        </div>
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]",
            v.ring,
            v.bg,
            v.text,
          )}
        >
          <VerdictIcon className="h-3 w-3" />
          {v.label}
        </div>
      </div>

      {/* Sentiment gauge */}
      <div className="border-b border-border/40 px-5 py-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
            Bullish sentiment
          </span>
          <span className={cn("font-mono text-sm", v.text)}>
            {data.bullishPct != null ? `${data.bullishPct.toFixed(0)}%` : "—"}
          </span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-all",
              data.sentimentVerdict.includes("bullish") && "bg-up",
              data.sentimentVerdict.includes("bearish") && "bg-down",
              (data.sentimentVerdict === "neutral" || data.sentimentVerdict === "unknown") &&
                "bg-muted-foreground/40",
            )}
            style={{ width: `${Math.max(0, Math.min(100, bullishPct))}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{data.headline}.</p>
      </div>

      {/* Stats + sparkline */}
      <div className="grid grid-cols-3 divide-x divide-border/40 border-b border-border/40 [&>*]:px-5 [&>*]:py-3">
        <Stat label="Galaxy Score" value={data.galaxyScore != null ? data.galaxyScore.toFixed(0) : "—"} />
        <Stat label="Alt Rank" value={data.altRank != null ? `#${data.altRank}` : "—"} />
        <Stat label="Contributors" value={fmtCount(data.contributors24h)} />
      </div>

      {/* Social volume sparkline */}
      <div className="border-b border-border/40 px-5 py-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
            Social volume · 24h
          </span>
          <span
            className={cn(
              "font-mono text-[11px]",
              data.socialVolumeChangePct == null
                ? "text-muted-foreground"
                : volIsUp
                  ? "text-up"
                  : "text-down",
            )}
          >
            {fmtCount(data.socialVolume24h)} · {fmtPct(data.socialVolumeChangePct)}
          </span>
        </div>
        {series.length >= 2 && (
          <div className="h-10 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke={sparkColor}
                  strokeWidth={1.25}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top posts */}
      {data.topPosts.length > 0 && (
        <ul className="divide-y divide-border/40">
          {data.topPosts.slice(0, 5).map((post) => {
            const NetIcon = post.network.toLowerCase().includes("twitter") ? Twitter : MessageCircle;
            return (
              <li key={post.id}>
                <a
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ease-vision flex items-start gap-3 px-5 py-3 hover:bg-secondary/30"
                >
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <NetIcon className="h-3 w-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-foreground">{post.title}</p>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                      {post.creatorName && <span>{post.creatorName}</span>}
                      {post.creatorName && <span>·</span>}
                      <span>{fmtCount(post.interactions24h)} interactions</span>
                      <span
                        className={cn(
                          "rounded-full border px-1.5 py-px text-[9px]",
                          POST_SENTIMENT_STYLE[post.sentiment],
                        )}
                      >
                        {post.sentiment}
                      </span>
                    </div>
                  </div>
                  <ArrowUpRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-secondary/30 px-5 py-2.5">
        <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
          Source: {data.sources.join(" + ") || "—"}
        </span>
        <a
          href={`https://lunarcrush.com/coins/${encodeURIComponent(data.topic)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground hover:text-foreground"
        >
          Full report →
        </a>
      </div>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
      {label}
    </p>
    <p className="mt-0.5 font-mono text-sm text-foreground">{value}</p>
  </div>
);
