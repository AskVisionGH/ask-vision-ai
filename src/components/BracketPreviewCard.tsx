import { Link } from "react-router-dom";
import { ArrowRight, Shield, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TokenLogo } from "@/components/TokenLogo";
import { fmtAmount, fmtUsd } from "@/lib/chat-trade-utils";
import type { BracketQuoteData } from "@/lib/chat-stream";

interface Props {
  data: BracketQuoteData;
}

export const BracketPreviewCard = ({ data }: Props) => {
  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  const tpDelta = data.marketPriceUsd
    ? ((data.tpPriceUsd - data.marketPriceUsd) / data.marketPriceUsd) * 100
    : null;
  const slDelta = data.marketPriceUsd
    ? ((data.slPriceUsd - data.marketPriceUsd) / data.marketPriceUsd) * 100
    : null;

  return (
    <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Bracket order — TP / SL
          </span>
        </div>
        <span className="rounded-full border border-border/60 bg-secondary/60 px-2 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {data.entryMode === "limit" ? "OTOCO" : "OCO"}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-5">
        <div className="min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Spend
          </span>
          <div className="mt-1 flex items-center gap-2">
            <TokenLogo logo={data.input.logo} symbol={data.input.symbol} size={20} />
            <span className="truncate font-mono text-base text-foreground">
              {fmtAmount(data.sellAmountUi)} {data.input.symbol}
            </span>
          </div>
          {data.sellValueUsd != null && (
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              ≈ {fmtUsd(data.sellValueUsd)}
            </div>
          )}
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 text-right">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Buy
          </span>
          <div className="mt-1 flex items-center justify-end gap-2">
            <span className="truncate font-mono text-base text-foreground">
              {data.output.symbol}
            </span>
            <TokenLogo logo={data.output.logo} symbol={data.output.symbol} size={20} />
          </div>
          {data.marketPriceUsd != null && (
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              market {fmtUsd(data.marketPriceUsd)}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border/40 px-5 py-3">
        {data.entryMode === "limit" && data.entryPriceUsd != null && (
          <Row
            label={`Entry ${data.entrySide ?? ""}`}
            value={
              <span className="font-mono text-[13px] text-foreground">
                {fmtUsd(data.entryPriceUsd)}
              </span>
            }
          />
        )}
        <Row
          label="Take profit"
          value={
            <span className="flex items-center gap-2 font-mono text-[13px] text-up">
              <TrendingUp className="h-3 w-3" />
              {fmtUsd(data.tpPriceUsd)}
              {tpDelta != null && (
                <span className="text-[11px] text-muted-foreground">
                  ({tpDelta >= 0 ? "+" : ""}{tpDelta.toFixed(1)}%)
                </span>
              )}
            </span>
          }
        />
        <Row
          label="Stop loss"
          value={
            <span className="flex items-center gap-2 font-mono text-[13px] text-down">
              <TrendingDown className="h-3 w-3" />
              {fmtUsd(data.slPriceUsd)}
              {slDelta != null && (
                <span className="text-[11px] text-muted-foreground">
                  ({slDelta >= 0 ? "+" : ""}{slDelta.toFixed(1)}%)
                </span>
              )}
            </span>
          }
        />
      </div>

      <div className="border-t border-border/40 bg-secondary/30 px-5 py-3">
        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
          Bracket orders use Jupiter's vault flow and need an extra
          authentication signature. Open the Trade page to confirm and sign —
          your inputs are pre-filled.
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
