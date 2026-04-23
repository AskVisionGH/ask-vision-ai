import { useEffect, useRef, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/TokenLogo";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SwapQuoteData } from "@/lib/chat-stream";

interface Props {
  data: SwapQuoteData;
}

const REFRESH_MS = 15000;
const SWAP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/swap-quote`;
const AUTH_TOKEN = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toExponential(2)}`;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
};

const fmtAmount = (n: number) => {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.000001) return n.toExponential(3);
  if (Math.abs(n) < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (Math.abs(n) < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const impactBucket = (pct: number | null) => {
  if (pct == null) return { label: "—", color: "text-muted-foreground", dot: "bg-muted-foreground" };
  const a = Math.abs(pct);
  if (a < 1) return { label: "low", color: "text-up", dot: "bg-up" };
  if (a < 3) return { label: "medium", color: "text-amber-400", dot: "bg-amber-400" };
  return { label: "high", color: "text-down", dot: "bg-down" };
};

export const SwapPreviewCard = ({ data: initial }: Props) => {
  const [data, setData] = useState<SwapQuoteData>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (data.error || dismissed) return;
    const timer = setInterval(async () => {
      if (!mounted.current) return;
      setRefreshing(true);
      try {
        const resp = await fetch(SWAP_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${AUTH_TOKEN}`,
          },
          body: JSON.stringify({
            inputToken: data.input.address,
            outputToken: data.output.address,
            amount: data.input.amountUi,
            slippageBps: data.slippageBps,
          }),
        });
        if (resp.ok) {
          const fresh = await resp.json();
          if (mounted.current && !fresh.error) setData(fresh);
        }
      } catch {
        /* silent — keep last good quote */
      } finally {
        if (mounted.current) setRefreshing(false);
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [data.error, dismissed, data.input.address, data.output.address, data.input.amountUi, data.slippageBps]);

  if (dismissed) return null;

  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  const impact = impactBucket(data.priceImpactPct);
  const routeLabels = data.route.length > 0
    ? Array.from(new Set(data.route.map((r) => r.label))).join(" → ")
    : "Direct";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Swap preview
          </span>
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/70">
            <RefreshCw
              className={cn("h-3 w-3", refreshing && "animate-spin text-primary")}
            />
            <span>refreshes 15s</span>
          </div>
        </div>

        {/* Amounts */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-5">
          <Side side={data.input} align="left" />
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Side side={data.output} align="right" approx />
        </div>

        {/* Stats */}
        <div className="border-t border-border/40 px-5 py-3">
          <Row
            label="Rate"
            value={
              <span className="font-mono text-[13px] text-foreground">
                1 {data.input.symbol} = {fmtAmount(data.rate)} {data.output.symbol}
              </span>
            }
          />
          <Row
            label="Impact"
            value={
              <div className="flex items-center gap-2">
                <span className={cn("font-mono text-[13px]", impact.color)}>
                  {data.priceImpactPct != null ? `${data.priceImpactPct.toFixed(2)}%` : "—"}
                </span>
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className={cn("h-1.5 w-1.5 rounded-full", impact.dot)} />
                  {impact.label}
                </span>
              </div>
            }
          />
          <Row
            label="Slippage"
            value={
              <span className="font-mono text-[13px] text-foreground">
                {(data.slippageBps / 100).toFixed(2)}%{" "}
                <span className="text-muted-foreground">(auto)</span>
              </span>
            }
          />
          <Row
            label="Route"
            value={
              <span className="font-mono text-[13px] text-foreground">
                {data.input.symbol} → {data.output.symbol}{" "}
                <span className="text-muted-foreground">via {routeLabels}</span>
              </span>
            }
          />
          <Row
            label="Fee"
            value={
              <span className="font-mono text-[13px] text-muted-foreground">
                ~{data.estNetworkFeeSol.toFixed(6)} SOL network
              </span>
            }
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border/40 bg-secondary/30 px-5 py-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex-1">
                <Button
                  disabled
                  className="ease-vision w-full font-mono text-[11px] tracking-wider uppercase"
                >
                  Confirm & sign
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              Signing ships in the next update.
            </TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            onClick={() => setDismissed(true)}
            className="ease-vision font-mono text-[11px] tracking-wider uppercase text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
};

const Side = ({
  side,
  align,
  approx,
}: {
  side: SwapQuoteData["input"];
  align: "left" | "right";
  approx?: boolean;
}) => (
  <div className={cn("flex flex-col gap-1.5", align === "right" && "items-end text-right")}>
    <div className={cn("flex items-center gap-2", align === "right" && "flex-row-reverse")}>
      <TokenLogo logo={side.logo} symbol={side.symbol} size={28} />
      <span className="font-mono text-[11px] text-muted-foreground">${side.symbol}</span>
    </div>
    <p className="font-mono text-lg font-light tracking-tight text-foreground">
      {approx && "~"}
      {fmtAmount(side.amountUi)}
    </p>
    <p className="font-mono text-[11px] text-muted-foreground">≈ {fmtUsd(side.valueUsd)}</p>
  </div>
);

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3 py-1.5">
    <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
      {label}
    </span>
    {value}
  </div>
);
