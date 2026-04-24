import { Link } from "react-router-dom";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TokenLogo } from "@/components/TokenLogo";
import { fmtAmount, fmtUsd } from "@/lib/chat-trade-utils";
import type { LadderQuoteData } from "@/lib/chat-stream";

interface Props {
  data: LadderQuoteData;
}

export const LadderPreviewCard = ({ data }: Props) => {
  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  return (
    <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Ladder — {data.side === "buy" ? "buy" : "sell"} {data.asset.symbol}
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {data.rungCount} rungs
        </span>
      </div>

      <div className="px-5 py-4">
        <div className="flex items-center gap-3">
          <TokenLogo logo={data.asset.logo} symbol={data.asset.symbol} size={28} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] text-foreground">
              {data.side === "buy" ? "Spend" : "Sell"}{" "}
              <span className="font-medium">
                {fmtAmount(data.totalAmountUi)} {data.side === "buy" ? data.quote.symbol : data.asset.symbol}
              </span>
            </p>
            {data.totalUsd != null && (
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                ≈ {fmtUsd(data.totalUsd)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border/40 px-5 py-3">
        <Row
          label="Range"
          value={
            <span className="font-mono text-[13px] text-foreground">
              {fmtUsd(data.minPriceUsd)} → {fmtUsd(data.maxPriceUsd)}
            </span>
          }
        />
        <Row
          label="Avg fill"
          value={
            <span className="font-mono text-[13px] text-foreground">
              {fmtUsd(data.averagePriceUsd)} per {data.asset.symbol}
            </span>
          }
        />
      </div>

      {/* Rung visualisation */}
      <div className="border-t border-border/40 px-5 py-3 space-y-1.5">
        {data.rungs.slice(0, 8).map((r, i) => {
          const widthPct = data.rungs.length > 0
            ? Math.max(
                12,
                Math.min(100, (r.spendUi / Math.max(...data.rungs.map((x) => x.spendUi))) * 100),
              )
            : 0;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                {fmtUsd(r.priceUsd)}
              </span>
              <div className="relative h-1.5 flex-1 rounded-full bg-secondary/40">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                {fmtAmount(r.spendUi)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border/40 bg-secondary/30 px-5 py-3">
        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
          Ladder orders place {data.rungCount} separate limit orders — each
          one needs its own wallet signature. Open Trade to confirm and sign
          them with your inputs pre-filled.
        </p>
        <Button asChild className="ease-vision mt-3 w-full font-mono text-[11px] tracking-wider uppercase">
          <Link to={data.tradeUrl}>Open in Trade →</Link>
        </Button>
      </div>
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between py-1">
    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {label}
    </span>
    <div>{value}</div>
  </div>
);
