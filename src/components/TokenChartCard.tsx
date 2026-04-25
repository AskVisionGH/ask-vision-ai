import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, TrendingUp, TrendingDown, ArrowUpRight, Minus, Plus } from "lucide-react";
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

const MIN_VISIBLE = 20;
const MAX_VISIBLE = 240;
const DEFAULT_VISIBLE = 80;

const fmtPrice = (n: number | null | undefined): string => {
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

const fmtPriceCompact = (n: number | null | undefined): string => {
  if (n == null) return "—";
  if (Math.abs(n) < 0.0001 && n !== 0) return n.toExponential(1);
  if (Math.abs(n) < 1) return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 100) return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
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

interface ViewState {
  /** Index of the right-most visible candle (exclusive). */
  end: number;
  /** Number of candles visible on screen. */
  count: number;
}

export const TokenChartCard = ({ data: initial }: Props) => {
  const [data, setData] = useState<TokenChartData>(initial);
  const [interval, setIntervalState] = useState<ChartInterval>(initial.interval);
  const [loadingInterval, setLoadingInterval] = useState(false);

  const [ta, setTa] = useState<TaResponse | null>(null);
  const [loadingTa, setLoadingTa] = useState(false);
  const [taError, setTaError] = useState<string | null>(null);

  const [view, setView] = useState<ViewState>(() => ({
    end: initial.candles.length,
    count: Math.min(DEFAULT_VISIBLE, initial.candles.length || DEFAULT_VISIBLE),
  }));

  useEffect(() => {
    setData(initial);
    setIntervalState(initial.interval);
    setTa(null);
    setTaError(null);
    setView({
      end: initial.candles.length,
      count: Math.min(DEFAULT_VISIBLE, initial.candles.length || DEFAULT_VISIBLE),
    });
  }, [initial]);

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
        if (j?.error) return;
        const next = j as TokenChartData;
        setData(next);
        setView({
          end: next.candles.length,
          count: Math.min(DEFAULT_VISIBLE, next.candles.length || DEFAULT_VISIBLE),
        });
        setTa(null);
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

  const zoom = useCallback(
    (delta: number) => {
      setView((v) => {
        const total = data.candles.length;
        if (!total) return v;
        const nextCount = Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, Math.min(total, v.count + delta)));
        const nextEnd = Math.min(total, Math.max(nextCount, v.end));
        return { end: nextEnd, count: nextCount };
      });
    },
    [data.candles.length],
  );

  if (initial.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {initial.error}
      </div>
    );
  }

  const runTa = async () => {
    if (loadingTa) return;
    if (ta) {
      setTa(null);
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

        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2 sm:px-5">
          <div className="flex items-center gap-1">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setIntervalState(iv)}
                className={cn(
                  "ease-vision rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-all",
                  interval === iv
                    ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {iv}
              </button>
            ))}
            {loadingInterval && <Loader2 className="ml-2 h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => zoom(10)}
              className="ease-vision flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              aria-label="Zoom out"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70 min-w-[2.5rem] text-center">
              {view.count}
            </span>
            <button
              type="button"
              onClick={() => zoom(-10)}
              className="ease-vision flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              aria-label="Zoom in"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        <CandleChart
          candles={data.candles}
          interval={interval}
          view={view}
          setView={setView}
          isUp={isUp}
        />

        <div className="grid grid-cols-2 divide-x divide-border/40 border-t border-border/40 [&>*]:px-5 [&>*]:py-2.5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
              Range high
            </p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{fmtPrice(data.high)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
              Range low
            </p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{fmtPrice(data.low)}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-secondary/30 px-5 py-2.5">
          <button
            type="button"
            onClick={runTa}
            disabled={loadingTa}
            className={cn(
              "ease-vision flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground",
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
              className="ease-vision flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {data.source === "coingecko" ? "CoinGecko" : "DexScreener"}
              <ArrowUpRight className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {(ta || taError) && (
        <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/80">
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
                <Stat label="Vol vs avg" value={`${ta.indicators.volRatio.toFixed(2)}x`} />
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
    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
      {label}
    </p>
    <p className="mt-0.5 font-mono text-sm text-foreground">{value}</p>
  </div>
);

// ---------- Custom SVG candle chart ----------

interface ChartProps {
  candles: TokenChartData["candles"];
  interval: ChartInterval;
  view: ViewState;
  setView: React.Dispatch<React.SetStateAction<ViewState>>;
  isUp: boolean;
}

const PRICE_AXIS_W = 56;
const TIME_AXIS_H = 20;
const PAD_TOP = 12;
const PAD_RIGHT = 8;

const CandleChart = ({ candles, interval, view, setView, isUp }: ChartProps) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 600, h: 280 });
  const [hover, setHover] = useState<{ x: number; y: number; idx: number } | null>(null);
  const dragRef = useRef<{ startX: number; startEnd: number; dragged: boolean } | null>(null);
  const pinchRef = useRef<{ startDist: number; startCount: number } | null>(null);

  // Track size with ResizeObserver.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ w: Math.max(320, r.width), h: Math.max(220, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = candles.length;
  const start = Math.max(0, Math.min(total - view.count, view.end - view.count));
  const end = Math.min(total, start + view.count);
  const visible = useMemo(() => candles.slice(start, end), [candles, start, end]);

  const plotW = Math.max(0, box.w - PRICE_AXIS_W - PAD_RIGHT);
  const plotH = Math.max(0, box.h - PAD_TOP - TIME_AXIS_H);

  const { minP, maxP } = useMemo(() => {
    if (!visible.length) return { minP: 0, maxP: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of visible) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    const pad = (hi - lo) * 0.08 || hi * 0.01 || 1;
    return { minP: lo - pad, maxP: hi + pad };
  }, [visible]);

  const yFor = useCallback(
    (price: number) => {
      if (maxP === minP) return PAD_TOP + plotH / 2;
      return PAD_TOP + (1 - (price - minP) / (maxP - minP)) * plotH;
    },
    [minP, maxP, plotH],
  );

  const slot = visible.length ? plotW / visible.length : 0;
  const candleW = Math.max(1, Math.min(18, slot * 0.7));

  const xFor = useCallback((i: number) => i * slot + slot / 2, [slot]);

  const last = visible[visible.length - 1];
  const lastY = last ? yFor(last.c) : 0;
  const lastUp = last ? last.c >= last.o : true;

  // Grid + price-axis labels (5 levels).
  const gridLevels = useMemo(() => {
    const levels = 5;
    return Array.from({ length: levels }, (_, i) => {
      const t = i / (levels - 1);
      const price = maxP - t * (maxP - minP);
      return { y: PAD_TOP + t * plotH, price };
    });
  }, [minP, maxP, plotH]);

  // Time-axis labels (4 ticks).
  const timeLabels = useMemo(() => {
    if (!visible.length) return [] as { x: number; label: string }[];
    const ticks = 4;
    return Array.from({ length: ticks }, (_, i) => {
      const idx = Math.round((i / (ticks - 1)) * (visible.length - 1));
      return { x: xFor(idx), label: fmtTime(visible[idx].t, interval) };
    });
  }, [visible, xFor, interval]);

  // Hover -> nearest candle.
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * box.w;
    const y = ((e.clientY - rect.top) / rect.height) * box.h;

    if (dragRef.current) {
      const dx = x - dragRef.current.startX;
      const candlesShift = Math.round(-dx / Math.max(1, slot));
      if (candlesShift !== 0) dragRef.current.dragged = true;
      const nextEnd = Math.max(view.count, Math.min(total, dragRef.current.startEnd + candlesShift));
      setView((v) => (v.end === nextEnd ? v : { ...v, end: nextEnd }));
      return;
    }

    if (x < 0 || x > plotW || y < PAD_TOP || y > PAD_TOP + plotH) {
      setHover(null);
      return;
    }
    const idx = Math.max(0, Math.min(visible.length - 1, Math.floor(x / Math.max(1, slot))));
    setHover({ x: xFor(idx), y, idx });
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch" && pinchRef.current) return;
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * box.w;
    dragRef.current = { startX: x, startEnd: view.end, dragged: false };
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    try {
      (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    dragRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (Math.abs(e.deltaY) < 1) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 6 : -6;
    setView((v) => {
      const nextCount = Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, Math.min(total, v.count + delta)));
      const nextEnd = Math.min(total, Math.max(nextCount, v.end));
      return { end: nextEnd, count: nextCount };
    });
  };

  // Touch pinch zoom.
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const handleTouchStart = (e: React.TouchEvent) => {
    for (const t of Array.from(e.touches)) {
      touchesRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (e.touches.length === 2) {
      const [a, b] = Array.from(e.touches);
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { startDist: dist, startCount: view.count };
      dragRef.current = null;
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const [a, b] = Array.from(e.touches);
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = pinchRef.current.startDist / Math.max(1, dist);
      const nextCount = Math.max(
        MIN_VISIBLE,
        Math.min(MAX_VISIBLE, Math.min(total, Math.round(pinchRef.current.startCount * ratio))),
      );
      setView((v) => ({ end: Math.min(total, Math.max(nextCount, v.end)), count: nextCount }));
    }
  };
  const handleTouchEnd = () => {
    touchesRef.current.clear();
    pinchRef.current = null;
  };

  if (!visible.length) {
    return (
      <div ref={wrapRef} className="h-64 w-full px-2 py-3 sm:h-72">
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          No data
        </div>
      </div>
    );
  }

  const hovered = hover ? visible[hover.idx] : null;

  return (
    <div ref={wrapRef} className="relative h-64 w-full select-none px-2 py-3 sm:h-72">
      <svg
        viewBox={`0 0 ${box.w} ${box.h}`}
        width="100%"
        height="100%"
        className="touch-none"
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          setHover(null);
          dragRef.current = null;
        }}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: dragRef.current ? "grabbing" : "crosshair" }}
      >
        <defs>
          <linearGradient id="chart-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.06" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
          <filter id="candle-glow-up" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="candle-glow-down" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background fill on plot area */}
        <rect x={0} y={PAD_TOP} width={plotW} height={plotH} fill="url(#chart-bg)" />

        {/* Horizontal grid lines + price axis labels */}
        {gridLevels.map((g, i) => (
          <g key={i}>
            <line
              x1={0}
              x2={plotW}
              y1={g.y}
              y2={g.y}
              stroke="hsl(var(--border))"
              strokeOpacity={0.3}
              strokeDasharray="2 4"
            />
            <text
              x={box.w - PAD_RIGHT}
              y={g.y + 3}
              textAnchor="end"
              className="fill-muted-foreground/70 font-mono"
              fontSize={10}
            >
              {fmtPriceCompact(g.price)}
            </text>
          </g>
        ))}

        {/* Time axis labels */}
        {timeLabels.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={box.h - 6}
            textAnchor="middle"
            className="fill-muted-foreground/60 font-mono"
            fontSize={9}
          >
            {t.label}
          </text>
        ))}

        {/* Candles */}
        {visible.map((c, i) => {
          const cx = xFor(i);
          const yH = yFor(c.h);
          const yL = yFor(c.l);
          const yO = yFor(c.o);
          const yC = yFor(c.c);
          const up = c.c >= c.o;
          const top = Math.min(yO, yC);
          const bodyH = Math.max(1, Math.abs(yC - yO));
          const color = up ? "hsl(var(--up))" : "hsl(var(--down))";
          const filter = up ? "url(#candle-glow-up)" : "url(#candle-glow-down)";
          return (
            <g key={`${c.t}-${i}`} filter={filter}>
              <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={color} strokeWidth={1} strokeOpacity={0.85} />
              <rect
                x={cx - candleW / 2}
                y={top}
                width={candleW}
                height={bodyH}
                fill={color}
                rx={1.5}
                opacity={0.95}
              />
            </g>
          );
        })}

        {/* Last-price horizontal line + pulse dot */}
        {last && (
          <g>
            <line
              x1={0}
              x2={plotW}
              y1={lastY}
              y2={lastY}
              stroke={lastUp ? "hsl(var(--up))" : "hsl(var(--down))"}
              strokeOpacity={0.35}
              strokeDasharray="3 3"
            />
            <circle
              cx={xFor(visible.length - 1)}
              cy={lastY}
              r={3.5}
              fill={lastUp ? "hsl(var(--up))" : "hsl(var(--down))"}
            >
              <animate attributeName="r" values="3.5;6;3.5" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0.4;1" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <rect
              x={plotW + 2}
              y={lastY - 8}
              width={PRICE_AXIS_W - 4}
              height={16}
              rx={3}
              fill={lastUp ? "hsl(var(--up))" : "hsl(var(--down))"}
              opacity={0.9}
            />
            <text
              x={box.w - PAD_RIGHT}
              y={lastY + 3.5}
              textAnchor="end"
              className="fill-background font-mono"
              fontSize={10}
              fontWeight={600}
            >
              {fmtPriceCompact(last.c)}
            </text>
          </g>
        )}

        {/* Crosshair */}
        {hover && hovered && (
          <g pointerEvents="none">
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PAD_TOP}
              y2={PAD_TOP + plotH}
              stroke="hsl(var(--foreground))"
              strokeOpacity={0.25}
              strokeDasharray="3 3"
            />
            <line
              x1={0}
              x2={plotW}
              y1={hover.y}
              y2={hover.y}
              stroke="hsl(var(--foreground))"
              strokeOpacity={0.25}
              strokeDasharray="3 3"
            />
            {/* Price tag on right axis */}
            <rect
              x={plotW + 2}
              y={hover.y - 8}
              width={PRICE_AXIS_W - 4}
              height={16}
              rx={3}
              fill="hsl(var(--foreground))"
              opacity={0.9}
            />
            <text
              x={box.w - PAD_RIGHT}
              y={hover.y + 3.5}
              textAnchor="end"
              className="fill-background font-mono"
              fontSize={10}
              fontWeight={600}
            >
              {fmtPriceCompact(
                maxP - ((hover.y - PAD_TOP) / Math.max(1, plotH)) * (maxP - minP),
              )}
            </text>
          </g>
        )}
      </svg>

      {/* Floating OHLC pill */}
      {hover && hovered && (
        <div
          className="ease-vision pointer-events-none absolute z-10 rounded-md border border-border/60 bg-popover/95 px-2.5 py-1.5 font-mono text-[10px] text-foreground shadow-soft backdrop-blur-md"
          style={{
            left: Math.min(box.w - 160, Math.max(8, (hover.x / box.w) * 100 * (box.w / 100) + 12)),
            top: 8,
          }}
        >
          <div className="text-muted-foreground">{fmtTime(hovered.t, interval)}</div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-muted-foreground">O</span>
            <span>{fmtPrice(hovered.o)}</span>
            <span className="text-muted-foreground">H</span>
            <span className="text-up">{fmtPrice(hovered.h)}</span>
            <span className="text-muted-foreground">L</span>
            <span className="text-down">{fmtPrice(hovered.l)}</span>
            <span className="text-muted-foreground">C</span>
            <span className={hovered.c >= hovered.o ? "text-up" : "text-down"}>
              {fmtPrice(hovered.c)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
