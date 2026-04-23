import { ExternalLink, Newspaper } from "lucide-react";
import type { SolanaNewsData, NewsItem } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

interface Props {
  data: SolanaNewsData;
}

export const NewsCard = ({ data }: Props) => {
  if (data.error && (!data.items || data.items.length === 0)) {
    return (
      <div className="w-full max-w-[88%] rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground sm:max-w-[78%]">
        {data.error}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[88%] overflow-hidden rounded-2xl border border-border bg-card sm:max-w-[78%]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Newspaper className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Solana ecosystem news</span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {data.items.length} headlines
        </span>
      </div>

      <ul className="divide-y divide-border">
        {data.items.map((item) => (
          <NewsRow key={item.id} item={item} />
        ))}
      </ul>

      {data.sources.length > 0 && (
        <div className="border-t border-border bg-secondary/30 px-4 py-2 text-[11px] text-muted-foreground">
          Sources: {data.sources.join(" · ")}
        </div>
      )}
    </div>
  );
};

const NewsRow = ({ item }: { item: NewsItem }) => {
  return (
    <li>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex gap-3 px-4 py-3 transition-colors hover:bg-secondary/50"
      >
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            loading="lazy"
            className="h-14 w-14 flex-none rounded-md object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div
            className={cn(
              "flex h-14 w-14 flex-none items-center justify-center rounded-md",
              item.kind === "reddit" ? "bg-orange-500/10" : "bg-primary/10",
            )}
          >
            <Newspaper
              className={cn(
                "h-5 w-5",
                item.kind === "reddit" ? "text-orange-500" : "text-primary",
              )}
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="truncate">{item.source}</span>
            <span>·</span>
            <span className="flex-none">{formatRelative(item.publishedAt)}</span>
            <ExternalLink className="ml-auto h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-foreground">
            {item.title}
          </p>
          {item.summary && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
              {item.summary}
            </p>
          )}
        </div>
      </a>
    </li>
  );
};

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(ts).toLocaleDateString();
}
