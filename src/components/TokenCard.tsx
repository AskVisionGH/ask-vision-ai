import { ArrowUpRight, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/TokenLogo";
import type { TokenInfoData } from "@/lib/chat-stream";

interface Props {
  data: TokenInfoData;
}

const fmtUsd = (n: number | null | undefined, opts?: { compact?: boolean }) => {
  if (n == null) return "—";
  if (opts?.compact && Math.abs(n) >= 1000) {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    });
  }
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
  return `${sign}${n.toFixed(2)}%`;
};

export const TokenCard = ({ data }: Props) => {
  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  const change24h = data.priceChange24h;
  const isUp = (change24h ?? 0) >= 0;

  return (
    <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-4">
        <TokenLogo logo={data.logo} symbol={data.symbol} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-medium text-foreground">
              ${data.symbol}
            </span>
            <span className="truncate text-xs text-muted-foreground">{data.name}</span>
          </div>
          <p className="mt-0.5 font-mono text-2xl font-light tracking-tight text-foreground">
            {fmtUsd(data.priceUsd)}
          </p>
        </div>
        {change24h != null && (
          <div
            className={cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[11px]",
              isUp
                ? "border-up/30 bg-up/10 text-up"
                : "border-down/30 bg-down/10 text-down",
            )}
          >
            {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {fmtPct(change24h)}
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 divide-x divide-y divide-border/40 [&>*]:px-5 [&>*]:py-3">
        <Stat label="Market Cap" value={fmtUsd(data.marketCapUsd, { compact: true })} />
        <Stat label="24h Volume" value={fmtUsd(data.volume24hUsd, { compact: true })} />
        <Stat label="Liquidity" value={fmtUsd(data.liquidityUsd, { compact: true })} />
        <Stat label="1h Change" value={fmtPct(data.priceChange1h)} dim />
      </div>

      {/* Footer */}
      {data.pairUrl && (
        <a
          href={data.pairUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center justify-between gap-2 border-t border-border/40 bg-secondary/30 px-5 py-2.5",
            "ease-vision hover:bg-secondary/60",
          )}
        >
          <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
            View on DexScreener
          </span>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
        </a>
      )}
    </div>
  );
};

const Stat = ({ label, value, dim }: { label: string; value: string; dim?: boolean }) => (
  <div>
    <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
      {label}
    </p>
    <p
      className={cn(
        "mt-1 font-mono text-sm",
        dim ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {value}
    </p>
  </div>
);
