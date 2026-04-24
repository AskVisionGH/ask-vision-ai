import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, LineChart, TrendingDown, TrendingUp, Twitter, Zap } from "lucide-react";
import type {
  EarlyBuyersData,
  EarlyBuyer,
  SmartMoneyActivityData,
  SmartMoneyTokenActivity,
  SmartMoneyWalletSummary,
} from "@/lib/chat-stream";
import { TokenLogo } from "@/components/TokenLogo";
import { cn } from "@/lib/utils";

const truncate = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

const formatUsd = (n: number | null) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
};

const formatRelative = (ts: number) => {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Early buyers
// ─────────────────────────────────────────────────────────────────────────────

interface EarlyProps {
  data: EarlyBuyersData;
}

export const EarlyBuyersCard = ({ data }: EarlyProps) => {
  if (data.error || !data.token) {
    return (
      <div className="w-full max-w-[88%] rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground sm:max-w-[78%]">
        {data.error ?? "Couldn't analyze early buyers."}
      </div>
    );
  }

  const t = data.token;
  return (
    <div className="w-full max-w-[88%] overflow-hidden rounded-2xl border border-border bg-card sm:max-w-[78%]">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <TokenLogo symbol={t.symbol} logo={t.logo} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              Early buyers · ${t.symbol}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            First {data.windowHours}h after launch · {data.totalCuratedTracked} wallets scanned
            {t.priceUsd != null && <> · now {formatUsd(t.priceUsd)}</>}
          </p>
        </div>
        {t.pairUrl ? (
          <a
            href={t.pairUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary"
            aria-label="Open chart on DexScreener"
          >
            <LineChart className="h-3 w-3" />
            Chart
          </a>
        ) : (
          <Zap className="h-4 w-4 text-primary" />
        )}
      </div>

      {data.curatedBuyers.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          None of your tracked wallets bought ${t.symbol} in the first {data.windowHours}h.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {data.curatedBuyers.map((b) => (
            <BuyerRow key={b.address} buyer={b} tokenSymbol={t.symbol} />
          ))}
        </ul>
      )}
    </div>
  );
};

const BuyerRow = ({ buyer, tokenSymbol }: { buyer: EarlyBuyer; tokenSymbol: string }) => {
  const mult = buyer.multiplier;
  const multColor =
    mult == null ? "text-muted-foreground" : mult >= 2 ? "text-up" : mult < 0.7 ? "text-down" : "text-foreground";
  const multLabel =
    mult == null
      ? null
      : mult >= 100
        ? `${Math.round(mult)}×`
        : mult >= 2
          ? `${mult.toFixed(1)}×`
          : `${mult.toFixed(2)}×`;
  const txLink = buyer.signature ? `https://solscan.io/tx/${buyer.signature}` : null;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-xs font-medium text-foreground">
        {(buyer.label ?? buyer.address).slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <a
            href={`https://solscan.io/account/${buyer.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm font-medium text-foreground hover:text-primary"
          >
            {buyer.label ?? truncate(buyer.address)}
          </a>
          {buyer.twitterHandle && (
            <a
              href={`https://x.com/${buyer.twitterHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary"
              aria-label={`@${buyer.twitterHandle} on X`}
            >
              <Twitter className="h-3 w-3" />
            </a>
          )}
          {buyer.isUserTracked && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary">
              tracked
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {truncate(buyer.address)}
          {buyer.minutesAfterLaunch != null && (
            <> · {formatHumanMinutes(buyer.minutesAfterLaunch)} after launch</>
          )}
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-right text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">{formatUsd(buyer.firstBuyUsd)}</span>
          {multLabel && <span className={cn("font-medium", multColor)}>· {multLabel}</span>}
          {txLink && (
            <a
              href={txLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary"
              aria-label="Open transaction"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          first buy
          {buyer.firstBuyAmount != null && (
            <> · {formatTokenAmount(buyer.firstBuyAmount)} ${tokenSymbol}</>
          )}
        </p>
      </div>
    </li>
  );
};

const formatHumanMinutes = (m: number) => {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

const formatTokenAmount = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
};

// ─────────────────────────────────────────────────────────────────────────────
// Smart-money activity (aggregated)
// ─────────────────────────────────────────────────────────────────────────────

interface ActivityProps {
  data: SmartMoneyActivityData;
}

interface AggregatedActivity {
  /** Stable group key: wallet+token+side */
  key: string;
  wallet: SmartMoneyTrade["wallet"];
  token: SmartMoneyTrade["token"];
  side: SmartMoneyTrade["side"];
  count: number;
  totalUsd: number | null;
  totalAmount: number | null;
  /** Most recent trade in the group — drives ordering + the primary tx link */
  latest: SmartMoneyTrade;
  signatures: string[];
  sources: string[];
}

const aggregate = (trades: SmartMoneyTrade[]): AggregatedActivity[] => {
  const groups = new Map<string, AggregatedActivity>();
  for (const t of trades) {
    const tokenKey = t.token?.address ?? t.token?.symbol ?? "untracked";
    const key = `${t.wallet.address}|${tokenKey}|${t.side}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        wallet: t.wallet,
        token: t.token,
        side: t.side,
        count: 1,
        totalUsd: t.valueUsd,
        totalAmount: t.amountUi,
        latest: t,
        signatures: [t.signature],
        sources: t.source ? [t.source] : [],
      });
      continue;
    }
    existing.count += 1;
    if (t.valueUsd != null) existing.totalUsd = (existing.totalUsd ?? 0) + t.valueUsd;
    if (t.amountUi != null) existing.totalAmount = (existing.totalAmount ?? 0) + t.amountUi;
    if (t.timestamp > existing.latest.timestamp) existing.latest = t;
    existing.signatures.push(t.signature);
    if (t.source && !existing.sources.includes(t.source)) existing.sources.push(t.source);
  }
  return [...groups.values()].sort((a, b) => b.latest.timestamp - a.latest.timestamp);
};

export const SmartMoneyActivityCard = ({ data }: ActivityProps) => {
  const grouped = useMemo(() => aggregate(data.trades), [data.trades]);
  const distinctWallets = useMemo(
    () => new Set(data.trades.map((t) => t.wallet.address)).size,
    [data.trades],
  );

  if (data.error && data.trades.length === 0) {
    return (
      <div className="w-full max-w-[88%] rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground sm:max-w-[78%]">
        {data.error}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[88%] overflow-hidden rounded-2xl border border-border bg-card sm:max-w-[78%]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <TrendingUp className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Smart-money activity</span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          last {data.windowHours}h · {distinctWallets}/{data.walletsTracked} active
        </span>
      </div>

      {grouped.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          No tracked wallets traded in the last {data.windowHours}h.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {grouped.map((g) => (
            <ActivityRow key={g.key} group={g} />
          ))}
        </ul>
      )}
    </div>
  );
};

const sideStyles: Record<SmartMoneyTrade["side"], string> = {
  buy: "bg-up/15 text-up",
  sell: "bg-down/15 text-down",
  transfer: "bg-muted text-muted-foreground",
  other: "bg-muted text-muted-foreground",
};

const ActivityRow = ({ group }: { group: AggregatedActivity }) => {
  const { wallet, token, side, count, totalUsd, totalAmount, latest, signatures } = group;
  const txLink = `https://solscan.io/tx/${latest.signature}`;
  const chartLink = token?.pairUrl ?? null;
  const sourceLabel = group.sources[0]?.toLowerCase().replace(/_/g, " ");

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-xs font-medium text-foreground">
        {wallet.label.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <a
            href={`https://solscan.io/account/${wallet.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm font-medium text-foreground hover:text-primary"
          >
            {wallet.label}
          </a>
          {count > 1 && (
            <span className="rounded-full bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ×{count}
            </span>
          )}
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
              sideStyles[side],
            )}
          >
            {side}
          </span>
          {token && (
            <span className="truncate text-sm text-foreground">
              ${token.symbol}
            </span>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Wallet className="h-3 w-3" />
          {truncate(wallet.address)}
          <span>· {formatRelative(latest.timestamp)}</span>
          {sourceLabel && <span>· {sourceLabel}</span>}
          {totalAmount != null && token && (
            <span>· {formatTokenAmount(totalAmount)} ${token.symbol}</span>
          )}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 text-right text-xs">
        <span className="font-medium text-foreground">{formatUsd(totalUsd)}</span>
        <div className="flex items-center gap-1.5">
          <a
            href={txLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary"
            aria-label={count > 1 ? `Open latest of ${signatures.length} transactions` : "Open transaction"}
            title={count > 1 ? `Latest of ${signatures.length} txs` : "Open transaction"}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
          {chartLink && (
            <a
              href={chartLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary"
              aria-label="Open chart on DexScreener"
              title="Open chart on DexScreener"
            >
              <LineChart className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </li>
  );
};
