// Shareable PnL card — landscape poster (1200×750, ~1.6:1) optimized for
// X / Telegram / Discord previews where 4:5 portraits get awkwardly cropped.
//
// The right-hand "scene" panel is procedurally generated from the PnL itself:
// profit shows an ascending fractured-glass shard column, loss shows a
// downward-pointing one with red lightning. Either way it fills the panel
// edge-to-edge so there are no empty gutters when the image is shared.
//
// Rendered off-screen and exported via html-to-image (see usePnLShare).

import { forwardRef } from "react";
import { TrendingDown, TrendingUp, Globe } from "lucide-react";
import { TokenLogo } from "@/components/TokenLogo";
import { cn } from "@/lib/utils";
import type { TokenPnL, TokenPnLData, WalletPnLData } from "@/lib/chat-stream";

const fmtUsd = (n: number | null | undefined, opts: { signed?: boolean } = {}) => {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: abs >= 100 ? 0 : 2,
  });
  if (opts.signed) {
    if (n > 0) return `+${formatted}`;
    if (n < 0) return `−${formatted}`;
  }
  if (n < 0) return `−${formatted}`;
  return formatted;
};

const fmtAmount = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs < 0.001) return n.toExponential(2);
  if (abs < 1) return n.toFixed(4);
  if (abs < 1000) return n.toFixed(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const truncate = (addr: string, head = 4, tail = 4) =>
  addr.length > head + tail + 2 ? `${addr.slice(0, head)}…${addr.slice(-tail)}` : addr;

const pnlPct = (pnl: number, basis: number) => {
  if (!basis || basis === 0) return null;
  return (pnl / Math.abs(basis)) * 100;
};

interface TokenShareProps {
  kind: "token";
  data: TokenPnLData;
}
interface WalletShareProps {
  kind: "wallet";
  data: WalletPnLData;
}

export type PnLShareProps = TokenShareProps | WalletShareProps;

// Card dimensions — landscape, matches typical social preview crop.
const CARD_W = 1200;
const CARD_H = 750;

/**
 * Off-screen 1200×750 PNG-ready card. Use a forwarded ref so html-to-image
 * can grab the DOM node without needing the parent to track its instance.
 */
export const PnLShareCard = forwardRef<HTMLDivElement, PnLShareProps>(
  (props, ref) => {
    // Determine overall tone for theming the scene panel.
    const totalPnl =
      props.kind === "token"
        ? (props.data.token?.realizedUsd ?? 0) + (props.data.token?.unrealizedUsd ?? 0)
        : props.data.totals.totalRealizedUsd + props.data.totals.totalUnrealizedUsd;
    const isProfit = totalPnl >= 0;

    // Theme variables driven by P/L sign so all child elements stay coherent.
    const theme = isProfit
      ? {
          accent: "hsl(152 76% 56%)", // emerald
          accentSoft: "hsl(152 76% 56% / 0.18)",
          glow: "hsl(152 76% 56% / 0.35)",
          haloFrom: "hsl(152 70% 60% / 0.45)",
          haloTo: "hsl(180 80% 50% / 0.05)",
        }
      : {
          accent: "hsl(0 84% 64%)", // rose
          accentSoft: "hsl(0 84% 64% / 0.18)",
          glow: "hsl(0 84% 64% / 0.4)",
          haloFrom: "hsl(0 84% 64% / 0.45)",
          haloTo: "hsl(280 70% 50% / 0.05)",
        };

    return (
      <div
        ref={ref}
        style={{
          width: CARD_W,
          height: CARD_H,
          background:
            "radial-gradient(ellipse 70% 80% at 0% 0%, hsl(258 90% 22% / 0.5), transparent 60%), linear-gradient(180deg, hsl(240 10% 4%) 0%, hsl(240 8% 7%) 100%)",
          fontFamily: "Geist, system-ui, -apple-system, sans-serif",
          color: "hsl(240 5% 96%)",
          position: "relative",
          overflow: "hidden",
          display: "flex",
        }}
      >
        {/* ---------- Left: data panel (60%) ---------- */}
        <div
          style={{
            width: "62%",
            padding: "44px 48px 36px",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            zIndex: 2,
          }}
        >
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background:
                  "linear-gradient(135deg, hsl(252 95% 85%), hsl(258 90% 66%))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "hsl(240 6% 6%)",
                fontWeight: 700,
                fontSize: 20,
                fontFamily: "'Instrument Serif', serif",
              }}
            >
              V
            </div>
            <p
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-[26px] leading-none italic"
            >
              Vision
            </p>
            <span
              className="ml-2 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest"
              style={{
                background: theme.accentSoft,
                color: theme.accent,
                border: `1px solid ${theme.accent}`,
              }}
            >
              {props.data.windowDays}d P/L
            </span>
          </div>

          {/* Body */}
          <div className="mt-8 flex-1">
            {props.kind === "token" ? (
              <TokenShare data={props.data} theme={theme} />
            ) : (
              <WalletShare data={props.data} theme={theme} />
            )}
          </div>

          {/* Footer */}
          <div className="mt-6 flex items-end justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-white/40">
                Wallet
              </p>
              <p className="mt-1 font-mono text-[14px] text-white/70">
                {truncate(props.data.address, 6, 6)}
              </p>
            </div>
            <div className="flex items-center gap-2 text-white/50">
              <Globe className="h-3.5 w-3.5" />
              <p className="font-mono text-[12px] uppercase tracking-widest">
                askvision.ai
              </p>
            </div>
          </div>
        </div>

        {/* ---------- Right: scene panel (38%) ---------- */}
        <ScenePanel isProfit={isProfit} theme={theme} />
      </div>
    );
  },
);
PnLShareCard.displayName = "PnLShareCard";

// ---------------- Scene panel (procedural graphic) ----------------

interface Theme {
  accent: string;
  accentSoft: string;
  glow: string;
  haloFrom: string;
  haloTo: string;
}

/**
 * Right-hand visual. SVG so it scales crisply at 2× pixelRatio during export.
 * Profit = ascending shards + sun-burst halo. Loss = descending shards +
 * jagged lightning streaks.
 */
const ScenePanel = ({ isProfit, theme }: { isProfit: boolean; theme: Theme }) => {
  const W = 456; // 38% of 1200
  const H = CARD_H;
  return (
    <div
      style={{
        width: "38%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, hsl(240 10% 6%) 0%, hsl(240 12% 10%) 100%)",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, display: "block" }}
      >
        <defs>
          <radialGradient id="halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={theme.haloFrom} />
            <stop offset="100%" stopColor={theme.haloTo} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="shard" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(240 8% 14%)" />
            <stop offset="100%" stopColor="hsl(240 8% 22%)" />
          </linearGradient>
          <linearGradient id="shardEdge" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme.accent} stopOpacity="0.9" />
            <stop offset="100%" stopColor={theme.accent} stopOpacity="0.2" />
          </linearGradient>
          <filter id="shardGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Halo */}
        <circle cx={W * 0.55} cy={H * 0.5} r={H * 0.5} fill="url(#halo)" />

        {/* Cracks / fracture lines */}
        {Array.from({ length: 6 }).map((_, i) => {
          const angle = (i / 6) * Math.PI * 2 + (isProfit ? 0.3 : 1.2);
          const cx = W * 0.55;
          const cy = H * 0.5;
          const len = H * 0.7;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + Math.cos(angle) * len}
              y2={cy + Math.sin(angle) * len}
              stroke={theme.accent}
              strokeOpacity={0.18}
              strokeWidth={1}
            />
          );
        })}

        {isProfit ? <ProfitGraphic w={W} h={H} theme={theme} /> : <LossGraphic w={W} h={H} theme={theme} />}
      </svg>

      {/* Top-right tag */}
      <div
        style={{
          position: "absolute",
          top: 32,
          right: 32,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 999,
          background: "hsl(240 10% 6% / 0.7)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${theme.accent}`,
        }}
      >
        {isProfit ? (
          <TrendingUp className="h-4 w-4" style={{ color: theme.accent }} />
        ) : (
          <TrendingDown className="h-4 w-4" style={{ color: theme.accent }} />
        )}
        <span
          className="font-mono text-[11px] uppercase tracking-widest"
          style={{ color: theme.accent }}
        >
          {isProfit ? "In profit" : "In drawdown"}
        </span>
      </div>
    </div>
  );
};

// Ascending stepped column with a sun behind it.
const ProfitGraphic = ({ w, h, theme }: { w: number; h: number; theme: Theme }) => {
  // 6 stacked bars climbing right.
  const bars = 6;
  const baseY = h * 0.82;
  const barW = 42;
  const gap = 10;
  const startX = w * 0.18;
  return (
    <g filter="url(#shardGlow)">
      {Array.from({ length: bars }).map((_, i) => {
        const x = startX + i * (barW + gap);
        const barH = 60 + i * 38;
        const y = baseY - barH;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill="url(#shard)"
              stroke="url(#shardEdge)"
              strokeWidth={1.5}
              rx={3}
            />
            {/* glow cap */}
            <rect
              x={x}
              y={y}
              width={barW}
              height={4}
              fill={theme.accent}
              opacity={0.85}
            />
          </g>
        );
      })}
      {/* Trajectory line */}
      <polyline
        points={Array.from({ length: bars })
          .map((_, i) => `${startX + i * (barW + gap) + barW / 2},${baseY - (60 + i * 38)}`)
          .join(" ")}
        fill="none"
        stroke={theme.accent}
        strokeWidth={2.5}
        strokeOpacity={0.9}
        strokeLinecap="round"
      />
      {/* Arrow tip */}
      <polygon
        points={`${startX + (bars - 1) * (barW + gap) + barW / 2 + 14},${baseY - (60 + (bars - 1) * 38) - 4} ${startX + (bars - 1) * (barW + gap) + barW / 2 - 6},${baseY - (60 + (bars - 1) * 38) - 18} ${startX + (bars - 1) * (barW + gap) + barW / 2 - 6},${baseY - (60 + (bars - 1) * 38) + 10}`}
        fill={theme.accent}
      />
    </g>
  );
};

// Descending column with jagged lightning.
const LossGraphic = ({ w, h, theme }: { w: number; h: number; theme: Theme }) => {
  const bars = 6;
  const baseY = h * 0.82;
  const barW = 42;
  const gap = 10;
  const startX = w * 0.18;
  return (
    <g filter="url(#shardGlow)">
      {Array.from({ length: bars }).map((_, i) => {
        const x = startX + i * (barW + gap);
        const barH = 250 - i * 38;
        const y = baseY - barH;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill="url(#shard)"
              stroke="url(#shardEdge)"
              strokeWidth={1.5}
              rx={3}
            />
            <rect
              x={x}
              y={y}
              width={barW}
              height={4}
              fill={theme.accent}
              opacity={0.85}
            />
          </g>
        );
      })}
      {/* Lightning bolt across the descent */}
      <polyline
        points={Array.from({ length: bars })
          .map((_, i) => `${startX + i * (barW + gap) + barW / 2},${baseY - (250 - i * 38)}`)
          .join(" ")}
        fill="none"
        stroke={theme.accent}
        strokeWidth={2.5}
        strokeOpacity={0.9}
        strokeLinecap="round"
      />
      {/* Down arrow */}
      <polygon
        points={`${startX + (bars - 1) * (barW + gap) + barW / 2 + 14},${baseY - (250 - (bars - 1) * 38) + 4} ${startX + (bars - 1) * (barW + gap) + barW / 2 - 6},${baseY - (250 - (bars - 1) * 38) - 10} ${startX + (bars - 1) * (barW + gap) + barW / 2 - 6},${baseY - (250 - (bars - 1) * 38) + 18}`}
        fill={theme.accent}
      />
      {/* Extra cracks for drama */}
      <path
        d={`M ${w * 0.65} ${h * 0.15} L ${w * 0.55} ${h * 0.4} L ${w * 0.7} ${h * 0.45} L ${w * 0.5} ${h * 0.75}`}
        stroke={theme.accent}
        strokeWidth={2}
        strokeOpacity={0.5}
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
};

// ---------------- Token slice ----------------

const TokenShare = ({ data, theme }: { data: TokenPnLData; theme: Theme }) => {
  const t = data.token;
  if (!t) {
    return (
      <div className="flex h-full items-center justify-center text-white/60">
        No data
      </div>
    );
  }
  const totalPnl = t.realizedUsd + t.unrealizedUsd;
  const pct = pnlPct(totalPnl, t.costUsd);
  const avgEntry = t.unitsBought > 0 ? t.costUsd / t.unitsBought : null;

  return (
    <>
      {/* Token row */}
      <div className="flex items-center gap-4">
        <div style={{ transform: "scale(1.6)", transformOrigin: "left center" }}>
          <TokenLogo logo={t.logo} symbol={t.symbol} />
        </div>
        <div className="ml-5">
          <p className="font-mono text-[24px] font-medium leading-tight">${t.symbol}</p>
          <p className="text-[15px] text-white/55 leading-tight">{t.name}</p>
        </div>
      </div>

      {/* Headline */}
      <div className="mt-7">
        <p className="font-mono text-[12px] uppercase tracking-widest text-white/45">
          Total P/L
        </p>
        <div className="mt-1 flex items-baseline gap-4">
          <p
            className="font-mono font-light tracking-tight"
            style={{ fontSize: 76, lineHeight: 1, color: theme.accent }}
          >
            {fmtUsd(totalPnl, { signed: true })}
          </p>
          {pct != null && (
            <div
              className="flex items-center gap-1 text-[22px] font-light"
              style={{ color: theme.accent }}
            >
              <span>
                {pct >= 0 ? "+" : ""}
                {pct.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
        <p className="mt-2 font-mono text-[13px] text-white/45">
          {fmtUsd(t.realizedUsd, { signed: true })} realized ·{" "}
          {fmtUsd(t.unrealizedUsd, { signed: true })} unrealized
        </p>
      </div>

      {/* Stats grid */}
      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/[0.06]">
        <ShareStat
          label="Bought"
          value={`${fmtAmount(t.unitsBought)} ${t.symbol}`}
          sub={`${t.buys} buys · ${fmtUsd(t.costUsd)}`}
        />
        <ShareStat
          label="Sold"
          value={`${fmtAmount(t.unitsSold)} ${t.symbol}`}
          sub={`${t.sells} sells · ${fmtUsd(t.proceedsUsd)}`}
        />
        <ShareStat
          label="Avg entry"
          value={avgEntry != null ? fmtUsd(avgEntry) : "—"}
          sub={t.currentPriceUsd != null ? `now ${fmtUsd(t.currentPriceUsd)}` : null}
        />
        <ShareStat
          label="Holding"
          value={`${fmtAmount(t.currentUnits)} ${t.symbol}`}
          sub={t.currentValueUsd != null ? fmtUsd(t.currentValueUsd) : null}
        />
      </div>
    </>
  );
};

// ---------------- Wallet slice ----------------

const WalletShare = ({ data, theme }: { data: WalletPnLData; theme: Theme }) => {
  const { totals, tokens } = data;
  const totalPnl = totals.totalRealizedUsd + totals.totalUnrealizedUsd;
  const pct = pnlPct(totalPnl, totals.totalCostUsd);

  // Top 3 movers fits the landscape height nicely.
  const top = [...tokens]
    .sort(
      (a, b) =>
        Math.abs(b.realizedUsd + b.unrealizedUsd) -
        Math.abs(a.realizedUsd + a.unrealizedUsd),
    )
    .slice(0, 3);

  return (
    <>
      <p className="font-mono text-[12px] uppercase tracking-widest text-white/45">
        Wallet P/L
      </p>
      <div className="mt-1 flex items-baseline gap-4">
        <p
          className="font-mono font-light tracking-tight"
          style={{ fontSize: 84, lineHeight: 1, color: theme.accent }}
        >
          {fmtUsd(totalPnl, { signed: true })}
        </p>
        {pct != null && (
          <div
            className="flex items-center gap-1 text-[22px] font-light"
            style={{ color: theme.accent }}
          >
            <span>
              {pct >= 0 ? "+" : ""}
              {pct.toFixed(1)}%
            </span>
          </div>
        )}
      </div>
      <p className="mt-2 font-mono text-[13px] text-white/45">
        {fmtUsd(totals.totalRealizedUsd, { signed: true })} realized ·{" "}
        {fmtUsd(totals.totalUnrealizedUsd, { signed: true })} unrealized · portfolio{" "}
        {fmtUsd(totals.currentPortfolioUsd)}
      </p>

      {top.length > 0 && (
        <div className="mt-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-white/45">
            Top movers
          </p>
          <ul className="mt-3 space-y-2">
            {top.map((tk) => (
              <ShareTokenRow key={tk.mint} token={tk} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
};

const ShareTokenRow = ({ token }: { token: TokenPnL }) => {
  const totalPnl = token.realizedUsd + token.unrealizedUsd;
  const tone =
    totalPnl > 0 ? "text-emerald-400" : totalPnl < 0 ? "text-rose-400" : "text-white/70";
  return (
    <li
      className="flex items-center justify-between rounded-xl px-4 py-3"
      style={{ background: "hsl(240 7% 11% / 0.7)" }}
    >
      <div className="flex items-center gap-3">
        <TokenLogo logo={token.logo} symbol={token.symbol} />
        <div>
          <p className="font-mono text-[16px] font-medium leading-tight">
            ${token.symbol}
          </p>
          <p className="text-[11px] text-white/50 leading-tight">
            {token.buys} buys · {token.sells} sells
          </p>
        </div>
      </div>
      <p className={cn("font-mono text-[18px] font-light", tone)}>
        {fmtUsd(totalPnl, { signed: true })}
      </p>
    </li>
  );
};

const ShareStat = ({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) => (
  <div style={{ background: "hsl(240 7% 9%)" }} className="px-5 py-4">
    <p className="font-mono text-[10px] uppercase tracking-widest text-white/40">
      {label}
    </p>
    <p className="mt-1.5 font-mono text-[16px]">{value}</p>
    {sub && <p className="mt-0.5 font-mono text-[11px] text-white/45">{sub}</p>}
  </div>
);
