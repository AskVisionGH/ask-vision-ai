// Shareable PnL card — a polished poster-style render of either a single
// token PnL or a full wallet PnL. Lives off-screen and is exported to PNG via
// html-to-image when the user taps "Share". Designed at 1080×1350 (4:5,
// Instagram/X-friendly) so the exported image looks crisp on any social feed.

import { forwardRef } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
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

/**
 * Off-screen 1080×1350 PNG-ready card. Use a forwarded ref so html-to-image
 * can grab the DOM node without needing the parent to track its instance.
 */
export const PnLShareCard = forwardRef<HTMLDivElement, PnLShareProps>(
  (props, ref) => {
    return (
      <div
        ref={ref}
        // Fixed pixel dimensions matter for html-to-image to produce a stable
        // exported size. Background uses inline gradient so it survives a
        // CSS-less serialization fallback.
        style={{
          width: 1080,
          height: 1350,
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, hsl(258 90% 66% / 0.3), transparent 70%), linear-gradient(180deg, hsl(240 8% 5%) 0%, hsl(240 7% 8%) 100%)",
          fontFamily: "Geist, system-ui, -apple-system, sans-serif",
          color: "hsl(240 5% 96%)",
          position: "relative",
          overflow: "hidden",
        }}
        className="flex flex-col"
      >
        {/* Aurora top glow accent */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle 600px at 80% 10%, hsl(252 95% 85% / 0.12), transparent 70%)",
            pointerEvents: "none",
          }}
        />

        {/* Header */}
        <div className="relative flex items-center justify-between px-16 pt-16">
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background:
                  "linear-gradient(135deg, hsl(252 95% 85%), hsl(258 90% 66%))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "hsl(240 6% 6%)",
                fontWeight: 700,
                fontSize: 22,
                fontFamily: "'Instrument Serif', serif",
              }}
            >
              V
            </div>
            <div>
              <p
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-[28px] leading-none italic"
              >
                Vision
              </p>
              <p className="font-mono text-[13px] tracking-wider uppercase text-white/50">
                askvision.ai
              </p>
            </div>
          </div>
          <p className="font-mono text-[13px] tracking-wider uppercase text-white/50">
            {props.data.windowDays}-day P/L
          </p>
        </div>

        {/* Body */}
        <div className="relative flex-1 px-16 pt-14">
          {props.kind === "token" ? (
            <TokenShare data={props.data} />
          ) : (
            <WalletShare data={props.data} />
          )}
        </div>

        {/* Footer */}
        <div className="relative flex items-center justify-between px-16 pb-12 pt-8">
          <p className="font-mono text-[12px] uppercase tracking-widest text-white/40">
            {truncate(props.data.address, 6, 6)}
          </p>
          <p className="font-mono text-[12px] uppercase tracking-widest text-white/40">
            cost basis · average · not financial advice
          </p>
        </div>
      </div>
    );
  },
);
PnLShareCard.displayName = "PnLShareCard";

// ---------------- Token slice ----------------

const TokenShare = ({ data }: { data: TokenPnLData }) => {
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
  const tone = totalPnl > 0 ? "text-emerald-400" : totalPnl < 0 ? "text-rose-400" : "text-white/70";
  const avgEntry = t.unitsBought > 0 ? t.costUsd / t.unitsBought : null;

  return (
    <>
      {/* Token row */}
      <div className="flex items-center gap-5">
        <div style={{ transform: "scale(2)", transformOrigin: "left center" }}>
          <TokenLogo logo={t.logo} symbol={t.symbol} />
        </div>
        <div className="ml-6">
          <p className="font-mono text-[28px] font-medium">${t.symbol}</p>
          <p className="text-[18px] text-white/60">{t.name}</p>
        </div>
      </div>

      {/* Headline P/L */}
      <div className="mt-12">
        <p className="font-mono text-[14px] uppercase tracking-widest text-white/50">
          Total P/L
        </p>
        <div className="mt-2 flex items-baseline gap-4">
          <p
            className={cn(
              "font-mono font-light tracking-tight",
              tone,
            )}
            style={{ fontSize: 96, lineHeight: 1 }}
          >
            {fmtUsd(totalPnl, { signed: true })}
          </p>
          {pct != null && (
            <div className={cn("flex items-center gap-1 text-[28px] font-light", tone)}>
              {pct >= 0 ? (
                <TrendingUp className="h-7 w-7" />
              ) : (
                <TrendingDown className="h-7 w-7" />
              )}
              <span>
                {pct >= 0 ? "+" : ""}
                {pct.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
        <p className="mt-2 font-mono text-[15px] text-white/50">
          {fmtUsd(t.realizedUsd, { signed: true })} realized ·{" "}
          {fmtUsd(t.unrealizedUsd, { signed: true })} unrealized
        </p>
      </div>

      {/* Stats grid */}
      <div className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06]">
        <ShareStat label="Bought" value={`${fmtAmount(t.unitsBought)} ${t.symbol}`} sub={`${t.buys} buys · ${fmtUsd(t.costUsd)}`} />
        <ShareStat label="Sold" value={`${fmtAmount(t.unitsSold)} ${t.symbol}`} sub={`${t.sells} sells · ${fmtUsd(t.proceedsUsd)}`} />
        <ShareStat label="Avg entry" value={avgEntry != null ? fmtUsd(avgEntry) : "—"} sub={t.currentPriceUsd != null ? `now ${fmtUsd(t.currentPriceUsd)}` : null} />
        <ShareStat label="Holding" value={`${fmtAmount(t.currentUnits)} ${t.symbol}`} sub={t.currentValueUsd != null ? fmtUsd(t.currentValueUsd) : null} />
      </div>
    </>
  );
};

// ---------------- Wallet slice ----------------

const WalletShare = ({ data }: { data: WalletPnLData }) => {
  const { totals, tokens } = data;
  const totalPnl = totals.totalRealizedUsd + totals.totalUnrealizedUsd;
  const pct = pnlPct(totalPnl, totals.totalCostUsd);
  const tone = totalPnl > 0 ? "text-emerald-400" : totalPnl < 0 ? "text-rose-400" : "text-white/70";

  // Top 4 movers by absolute P/L for the poster — keeps it scannable.
  const top = [...tokens]
    .sort(
      (a, b) =>
        Math.abs(b.realizedUsd + b.unrealizedUsd) - Math.abs(a.realizedUsd + a.unrealizedUsd),
    )
    .slice(0, 4);

  return (
    <>
      <p className="font-mono text-[14px] uppercase tracking-widest text-white/50">
        Wallet P/L
      </p>
      <div className="mt-2 flex items-baseline gap-4">
        <p
          className={cn("font-mono font-light tracking-tight", tone)}
          style={{ fontSize: 104, lineHeight: 1 }}
        >
          {fmtUsd(totalPnl, { signed: true })}
        </p>
        {pct != null && (
          <div className={cn("flex items-center gap-1 text-[28px] font-light", tone)}>
            {pct >= 0 ? <TrendingUp className="h-7 w-7" /> : <TrendingDown className="h-7 w-7" />}
            <span>{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</span>
          </div>
        )}
      </div>
      <p className="mt-2 font-mono text-[15px] text-white/50">
        {fmtUsd(totals.totalRealizedUsd, { signed: true })} realized ·{" "}
        {fmtUsd(totals.totalUnrealizedUsd, { signed: true })} unrealized · portfolio{" "}
        {fmtUsd(totals.currentPortfolioUsd)}
      </p>

      {/* Top movers */}
      {top.length > 0 && (
        <div className="mt-14">
          <p className="font-mono text-[13px] uppercase tracking-widest text-white/50">
            Top movers
          </p>
          <ul className="mt-4 space-y-3">
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
  const tone = totalPnl > 0 ? "text-emerald-400" : totalPnl < 0 ? "text-rose-400" : "text-white/70";
  return (
    <li
      className="flex items-center justify-between rounded-2xl px-5 py-4"
      style={{ background: "hsl(240 7% 11% / 0.7)" }}
    >
      <div className="flex items-center gap-4">
        <TokenLogo logo={token.logo} symbol={token.symbol} />
        <div>
          <p className="font-mono text-[20px] font-medium">${token.symbol}</p>
          <p className="text-[13px] text-white/55">
            {token.buys} buys · {token.sells} sells
          </p>
        </div>
      </div>
      <p className={cn("font-mono text-[24px] font-light", tone)}>
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
  <div style={{ background: "hsl(240 7% 9%)" }} className="px-7 py-6">
    <p className="font-mono text-[12px] uppercase tracking-widest text-white/45">
      {label}
    </p>
    <p className="mt-2 font-mono text-[22px]">{value}</p>
    {sub && <p className="mt-1 font-mono text-[14px] text-white/50">{sub}</p>}
  </div>
);
