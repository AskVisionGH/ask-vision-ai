import { ShieldAlert, ShieldCheck, ShieldQuestion, Shield, Check, X, AlertTriangle, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/TokenLogo";
import type { RiskReportData } from "@/lib/chat-stream";

interface Props {
  data: RiskReportData;
}

const VERDICT_STYLE: Record<
  RiskReportData["verdict"],
  { ring: string; bg: string; text: string; Icon: typeof Shield; label: string }
> = {
  safe: {
    ring: "border-up/30",
    bg: "bg-up/10",
    text: "text-up",
    Icon: ShieldCheck,
    label: "Looks clean",
  },
  caution: {
    ring: "border-amber-500/30",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    Icon: Shield,
    label: "Minor risks",
  },
  risky: {
    ring: "border-orange-500/40",
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    Icon: ShieldAlert,
    label: "Notable risks",
  },
  danger: {
    ring: "border-down/40",
    bg: "bg-down/10",
    text: "text-down",
    Icon: ShieldAlert,
    label: "High risk",
  },
  unknown: {
    ring: "border-border",
    bg: "bg-muted/20",
    text: "text-muted-foreground",
    Icon: ShieldQuestion,
    label: "Inconclusive",
  },
};

const STATUS_STYLE: Record<
  RiskReportData["checks"][number]["status"],
  { Icon: typeof Check; color: string }
> = {
  good: { Icon: Check, color: "text-up" },
  warn: { Icon: AlertTriangle, color: "text-amber-400" },
  bad: { Icon: X, color: "text-down" },
  unknown: { Icon: HelpCircle, color: "text-muted-foreground" },
};

export const RiskReportCard = ({ data }: Props) => {
  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  const v = VERDICT_STYLE[data.verdict];
  const VerdictIcon = v.Icon;

  // Score is 0 (safe) → 100 (danger). Bar fills from left.
  const scorePct = Math.max(0, Math.min(100, data.score));

  return (
    <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-4">
        <TokenLogo logo={data.logo} symbol={data.symbol} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-medium text-foreground">${data.symbol}</span>
            <span className="truncate text-xs text-muted-foreground">{data.name}</span>
          </div>
          <p className="mt-0.5 font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
            Risk report
          </p>
        </div>
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]",
            v.ring,
            v.bg,
            v.text,
          )}
        >
          <VerdictIcon className="h-3 w-3" />
          {v.label}
        </div>
      </div>

      {/* Score bar */}
      <div className="border-b border-border/40 px-5 py-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
            Risk score
          </span>
          <span className={cn("font-mono text-sm", v.text)}>
            {data.score}
            <span className="text-muted-foreground/60">/100</span>
          </span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-all",
              data.verdict === "safe" && "bg-up",
              data.verdict === "caution" && "bg-amber-400",
              data.verdict === "risky" && "bg-orange-400",
              data.verdict === "danger" && "bg-down",
              data.verdict === "unknown" && "bg-muted-foreground/40",
            )}
            style={{ width: `${scorePct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Lower is safer. {data.headline}.
        </p>
      </div>

      {/* Checks */}
      <ul className="divide-y divide-border/40">
        {data.checks.map((c) => {
          const s = STATUS_STYLE[c.status];
          const Icon = s.Icon;
          return (
            <li key={c.id} className="flex items-start gap-3 px-5 py-3">
              <div
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary",
                  s.color,
                )}
              >
                <Icon className="h-3 w-3" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{c.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-secondary/30 px-5 py-2.5">
        <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
          Source: {data.sources.join(" + ") || "—"}
        </span>
        <a
          href={`https://rugcheck.xyz/tokens/${data.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground hover:text-foreground"
        >
          Open on RugCheck →
        </a>
      </div>
    </div>
  );
};
