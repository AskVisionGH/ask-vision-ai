import { useState } from "react";
import { ArrowUpRight, TrendingUp, TrendingDown, Shield, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/TokenLogo";
import { RiskReportCard } from "@/components/RiskReportCard";
import type { TokenInfoData, RiskReportData } from "@/lib/chat-stream";

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

// Anything above this is "big enough" that a safety check feels condescending —
// SOL/USDC/JUP/etc. The user can still ask explicitly and the AI will run analyze_contract.
const SAFETY_PILL_MCAP_THRESHOLD = 50_000_000;

const CONTRACT_ANALYZER_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contract-analyzer`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const TokenCard = ({ data }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState<RiskReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  const change24h = data.priceChange24h;
  const isUp = (change24h ?? 0) >= 0;

  // Show the safety pill for smaller/newer tokens where it actually helps.
  // We don't fetch the report up-front — the pill is just an entry point;
  // tapping it triggers the heavier RugCheck call on demand.
  const showSafetyPill =
    !!data.address &&
    (data.marketCapUsd == null || data.marketCapUsd < SAFETY_PILL_MCAP_THRESHOLD);

  const loadReport = async () => {
    if (report || loadingReport) {
      setExpanded((v) => !v);
      return;
    }
    setLoadingReport(true);
    setReportError(null);
    setExpanded(true);
    try {
      const resp = await fetch(CONTRACT_ANALYZER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ query: data.address }),
      });
      const json = await resp.json();
      if (!resp.ok || json?.error) {
        setReportError(json?.error ?? "Couldn't load risk report");
      } else {
        setReport(json as RiskReportData);
      }
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoadingReport(false);
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

        {/* Footer row: safety pill + dexscreener */}
        {(showSafetyPill || data.pairUrl) && (
          <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-secondary/30 px-5 py-2.5">
            {showSafetyPill ? (
              <button
                type="button"
                onClick={loadReport}
                disabled={loadingReport}
                className={cn(
                  "ease-vision flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase text-muted-foreground",
                  "hover:border-primary/30 hover:text-foreground",
                  expanded && "border-primary/30 text-foreground",
                )}
                aria-expanded={expanded}
              >
                {loadingReport ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Shield className="h-3 w-3" />
                )}
                {expanded ? "Hide safety" : "Safety check"}
              </button>
            ) : (
              <span />
            )}

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
        )}
      </div>

      {/* Expanded risk report */}
      {expanded && (
        <>
          {reportError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {reportError}
            </div>
          ) : report ? (
            <RiskReportCard data={report} />
          ) : loadingReport ? (
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running safety checks…
            </div>
          ) : null}
        </>
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
