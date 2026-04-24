import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface Props {
  /** Target price as string (output per 1 input) */
  value: string;
  onChange: (v: string) => void;
  /** Live market rate (output per 1 input). null while loading. */
  marketRate: number | null;
  marketLoading?: boolean;
  onRefreshMarket?: () => void;
  inputSymbol: string;
  outputSymbol: string;
  /** "sell" → user wants price > market (preset chips +x%); "buy" inverse */
  side?: "sell" | "buy";
}

const PRESETS_SELL = [
  { label: "Market", pct: 0 },
  { label: "+1%", pct: 1 },
  { label: "+5%", pct: 5 },
  { label: "+10%", pct: 10 },
];
const PRESETS_BUY = [
  { label: "Market", pct: 0 },
  { label: "-1%", pct: -1 },
  { label: "-5%", pct: -5 },
  { label: "-10%", pct: -10 },
];

const fmtPrice = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "";
  if (n < 0.000001) return n.toExponential(4);
  if (n < 1) return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  if (n < 1000) return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return n.toFixed(2);
};

export const LimitPriceField = ({
  value,
  onChange,
  marketRate,
  marketLoading = false,
  onRefreshMarket,
  inputSymbol,
  outputSymbol,
  side = "sell",
}: Props) => {
  const presets = side === "buy" ? PRESETS_BUY : PRESETS_SELL;
  const [activePreset, setActivePreset] = useState<number | null>(null);
  const userTouched = useRef(false);

  const numeric = useMemo(() => {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [value]);

  // Distance from market as a signed percentage.
  const deltaPct = useMemo(() => {
    if (!marketRate || numeric <= 0) return null;
    return ((numeric - marketRate) / marketRate) * 100;
  }, [numeric, marketRate]);

  // When market rate first arrives and user hasn't typed, default to market.
  useEffect(() => {
    if (marketRate && !userTouched.current && !numeric) {
      onChange(fmtPrice(marketRate));
      setActivePreset(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketRate]);

  const handleChange = (v: string) => {
    if (v === "" || /^\d*\.?\d*$/.test(v)) {
      userTouched.current = true;
      onChange(v);
      setActivePreset(null);
    }
  };

  const applyPreset = (idx: number, pct: number) => {
    if (!marketRate) return;
    const next = marketRate * (1 + pct / 100);
    userTouched.current = true;
    onChange(fmtPrice(next));
    setActivePreset(idx);
  };

  const deltaTone =
    deltaPct == null
      ? "text-muted-foreground"
      : Math.abs(deltaPct) < 0.05
        ? "text-muted-foreground"
        : (side === "sell" ? deltaPct >= 0 : deltaPct <= 0)
          ? "text-up"
          : "text-down";

  const deltaLabel =
    deltaPct == null
      ? "—"
      : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(deltaPct < 1 && deltaPct > -1 ? 2 : 1)}% vs market`;

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          When 1 {inputSymbol} =
        </span>
        <button
          type="button"
          onClick={onRefreshMarket}
          disabled={!onRefreshMarket || marketLoading}
          className="ease-vision flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <span>Mkt: {marketRate ? fmtPrice(marketRate) : "—"}</span>
          <RefreshCw className={cn("h-3 w-3", marketLoading && "animate-spin")} />
        </button>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={marketLoading ? "" : "0.00"}
          className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-light text-foreground outline-none placeholder:text-muted-foreground/40"
        />
        <span className="font-mono text-sm text-muted-foreground">{outputSymbol}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {presets.map((p, idx) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(idx, p.pct)}
              disabled={!marketRate}
              className={cn(
                "ease-vision rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors disabled:opacity-40",
                activePreset === idx
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label === "Market" && marketLoading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : p.label}
            </button>
          ))}
        </div>
        <span className={cn("font-mono text-[10px]", deltaTone)}>{deltaLabel}</span>
      </div>
    </div>
  );
};
