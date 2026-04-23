import { useEffect, useState } from "react";
import { Loader2, Sparkles, TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react";
import { Bar, ComposedChart, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/TokenLogo";
import type { ChartInterval, TaResponse, TokenChartData } from "@/lib/chat-stream";

interface Props {
  data: TokenChartData;
}

const INTERVALS: ChartInterval[] = ["5m", "15m", "1h", "4h", "1d"];

const TA_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/token-ta`;
const CHART_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/token-chart`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const fmtPrice = (n: number | null): string => {
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

const fmtPct = (n: number | null): string => {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
};

const fmtTime = (t: number, interval: ChartInterval): string => {
  const d = new Date(t * 1000);
  if (interval === "1d") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (interval === "4h" || interval === "1h") {
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
};

export const TokenChartCard = ({ data: initial }: Props) => {
  const [data, setData] = useState<TokenChartData>(initial);
  const [interval, setIntervalState] = useState<ChartInterval>(initial.interval);
  const [loadingInterval, setLoadingInterval] = useState(false);

  const [ta, setTa] = useState<TaResponse | null>(null);
  const [loadingTa, setLoadingTa] = useState(false);
  const [taError, setTaError] = useState<string | null>(null);

  // Refetch when the user picks a new interval.
  useEffect(() => {
    if (interval === data.interval) return;
    let cancelled = false;
    setLoadingInterval(true);
    fetch(CHART_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ query: data.address || data.symbol, interval }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.error) return; // keep old data, surface nothing — interval stays unchanged
        setData(j as TokenChartData);
        setTa(null); // TA was for previous interval; invalidate
        setTaError(null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingInterval(false);
      });
    return () => {
      cancelled = true;
    };
  }, [interval, data.address, data.symbol, data.interval]);

  const isUp = (data.priceChangePct ?? 0) >= 0;
  const upColor = "hsl(var(--up))";
  const downColor = "hsl(var(--down))";

  if (initial.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {initial.error}
      </div>
    );
  }

  // Each candle becomes a bar from low → high (wick) plus a body from open → close.
  // Recharts only paints positive bar heights, so we encode body + wick as ranges.
  const chartData = data.candles.map((c) => ({
    t: c.t,
    o: c.o,
    h: c.h,
    l: c.l,
    c: c.c,
    // wick range [low, high]
    wick: [c.l, c.h] as [number, number],
    // body range [min(o,c), max(o,c)] with color baked in
    body: [Math.min(c.o, c.c), Math.max(c.o, c.c)] as [number, number],
    up: c.c >= c.o,
  }));

  const runTa = async () => {
    if (loadingTa) return;
    if (ta) {
      setTa(null); // toggle off
      return;
    }
    setLoadingTa(true);
    setTaError(null);
    try {
      const resp = await fetch(TA_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          symbol: data.symbol,
          interval: data.interval,
          candles: data.candles,
        }),
      });
      const json = await resp.json();
      if (!resp.ok || json?.error) {
        setTaError(json?.error ?? "Couldn't load TA");
      } else {
        setTa(json as TaResponse);
      }
    } catch (e) {
      setTaError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoadingTa(false);
    }
  };

  return (
    <div className="ease-vision animate-fade-up flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-4">
          <TokenLogo logo={data.logo} symbol={data.symbol} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-sm font-medium text-foreground">${data.symbol}</span>
              <span className="truncate text-xs text-muted-foreground">{data.name}</span>
            </div>
            <p className="mt-0.5 font-mono text-2xl font-light tracking-tight text-foreground">
              {fmtPrice(data.priceUsd)}
            </p>
          </div>
          {data.priceChangePct != null && (
            <div
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[11px]",
                isUp
                  ? "border-up/30 bg-up/10 text-up"
                  : "border-down/30 bg-down/10 text-down",
              )}
            >
              {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {fmtPct(data.priceChangePct)}
            </div>
          )}
        </div>

        {/* Interval switcher */}
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-2">
          <div className="flex items-center gap-1">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setIntervalState(iv)}
                className={cn(
                  "ease-vision rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider",
                  interval === iv
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {iv}
              </button>
            ))}
          </div>
          {loadingInterval && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>

        {/* Candlestick chart */}
        <div className="h-44 w-full px-2 py-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 6, right: 12, left: 12, bottom: 6 }}>
              <YAxis
                hide
                domain={[
                  (dataMin: number) => dataMin * 0.995,
                  (dataMax: number) => dataMax * 1.005,
                ]}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as {
                    t: number;
                    o: number;
                    h: number;
                    l: number;
                    c: number;
                  };
                  return (
                    <div className="rounded-md border border-border bg-popover px-2 py-1.5 font-mono text-[10px] text-foreground shadow-soft">
                      <div className="text-muted-foreground">{fmtTime(p.t, interval)}</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1">
                        <span className="text-muted-foreground">O</span><span>{fmtPrice(p.o)}</span>
                        <span className="text-muted-foreground">H</span><span>{fmtPrice(p.h)}</span>
                        <span className="text-muted-foreground">L</span><span>{fmtPrice(p.l)}</span>
                        <span className="text-muted-foreground">C</span><span>{fmtPrice(p.c)}</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="wick"
                shape={(props: any) => <CandleShape {...props} kind="wick" upColor={upColor} downColor={downColor} />}
                isAnimationActive={false}
              />
              <Bar
                dataKey="body"
                shape={(props: any) => <CandleShape {...props} kind="body" upColor={upColor} downColor={downColor} />}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Range row */}
        <div className="grid grid-cols-2 divide-x divide-border/40 border-t border-border/40 [&>*]:px-5 [&>*]:py-2.5">
          <div>
            <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
              Range high
            </p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{fmtPrice(data.high)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
              Range low
            </p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{fmtPrice(data.low)}</p>
          </div>
        </div>

        {/* Footer: TA + DexScreener */}
        <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-secondary/30 px-5 py-2.5">
          <button
            type="button"
            onClick={runTa}
            disabled={loadingTa}
            className={cn(
              "ease-vision flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase text-muted-foreground",
              "hover:border-primary/30 hover:text-foreground",
              ta && "border-primary/30 text-foreground",
            )}
          >
            {loadingTa ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className={cn("h-3 w-3", ta ? "text-primary" : "text-muted-foreground")} />
            )}
            {ta ? "Hide Analysis" : "Analyze"}
          </button>

          {data.pairUrl && (
            <a
              href={data.pairUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ease-vision flex items-center gap-1 font-mono text-[10px] tracking-wider uppercase text-muted-foreground hover:text-foreground"
            >
              DexScreener
              <ArrowUpRight className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* TA panel */}
      {(ta || taError) && (
        <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/80">
              AI Technical Read · {data.interval}
            </span>
          </div>
          {taError ? (
            <p className="px-5 py-4 text-sm text-destructive">{taError}</p>
          ) : ta ? (
            <>
              <p className="px-5 py-4 text-sm leading-relaxed text-foreground">{ta.commentary}</p>
              <div className="grid grid-cols-3 divide-x divide-border/40 border-t border-border/40 [&>*]:px-5 [&>*]:py-2.5">
                <Stat label="RSI(14)" value={ta.indicators.rsi.toFixed(1)} />
                <Stat label="Volatility" value={`${ta.indicators.atrPct.toFixed(2)}%`} />
                <Stat
                  label="Vol vs avg"
                  value={`${ta.indicators.volRatio.toFixed(2)}x`}
                />
              </div>
            </>
          ) : null}
        </div>
      )}
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

interface CandleShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { up: boolean };
  kind: "wick" | "body";
  upColor: string;
  downColor: string;
}

// Custom shape for both the wick (thin vertical line) and body (filled rect)
// of a candle. Recharts gives us the bar's bounding box for the [low, high]
// or [openMin, closeMax] range, which we then style accordingly.
const CandleShape = ({ x, y, width, height, payload, kind, upColor, downColor }: CandleShapeProps) => {
  if (x == null || y == null || width == null || height == null) return null;
  const color = payload?.up ? upColor : downColor;
  if (kind === "wick") {
    const cx = x + width / 2;
    return <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />;
  }
  // body — clamp width and ensure at least 1px tall so doji candles still render
  const bodyW = Math.max(2, Math.min(width * 0.7, 14));
  const bodyX = x + (width - bodyW) / 2;
  const bodyH = Math.max(1, height);
  return <rect x={bodyX} y={y} width={bodyW} height={bodyH} fill={color} rx={1} />;
};
