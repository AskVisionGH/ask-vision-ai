import { ArrowUpRight, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/TokenLogo";
import type { TrendingData } from "@/lib/chat-stream";

interface Props {
  data: TrendingData;
}

const fmtCompact = (n: number | null | undefined) => {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  });
};

const fmtPrice = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) < 0.0001 && n !== 0) return `$${n.toExponential(2)}`;
  if (Math.abs(n) < 1) {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 6,
    });
  }
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
};

const fmtPct = (n: number | null | undefined) => {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  // Cap displayed change to keep layout calm — show "+999%+" for absurd pumps
  if (n > 999) return "+999%+";
  if (n < -99) return "-99%";
  return `${sign}${n.toFixed(n >= 100 || n <= -100 ? 0 : 1)}%`;
};

export const TrendingCard = ({ data }: Props) => {
  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  const tokens = data.tokens ?? [];
  if (tokens.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        No trending tokens right now.
      </div>
    );
  }

  const tfLabel = ({ "5m": "5m", "1h": "1h", "6h": "6h", "24h": "24h" } as const)[
    data.timeframe ?? "24h"
  ];

  return (
    <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3.5">
        <Flame className="h-3.5 w-3.5 text-primary" />
        <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/80">
          Trending on Solana · {tfLabel}
        </p>
      </div>

      <ul className="divide-y divide-border/40">
        {tokens.map((t, i) => {
          const isUp = (t.priceChange ?? 0) >= 0;
          return (
            <li key={t.address}>
              <a
                href={t.pairUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "flex items-center gap-3 px-5 py-3 ease-vision",
                  "hover:bg-secondary/40",
                )}
              >
                <span className="w-4 font-mono text-[11px] text-muted-foreground/60">
                  {i + 1}
                </span>
                <TokenLogo logo={t.logo} symbol={t.symbol} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-[13px] font-medium text-foreground">
                      ${t.symbol}
                    </span>
                    <span className="truncate text-xs text-muted-foreground/80">
                      {t.name}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    Vol {fmtCompact(t.volumeUsd)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[12px] text-foreground">
                    {fmtPrice(t.priceUsd)}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 font-mono text-[11px]",
                      isUp ? "text-up" : "text-down",
                    )}
                  >
                    {fmtPct(t.priceChange)}
                  </p>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
