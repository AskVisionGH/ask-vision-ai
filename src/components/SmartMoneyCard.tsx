import { ExternalLink, TrendingUp, Twitter, Wallet, Zap } from "lucide-react";
import type {
  EarlyBuyersData,
  EarlyBuyer,
  SmartMoneyActivityData,
  SmartMoneyTrade,
} from "@/lib/chat-stream";
import { TokenLogo } from "@/components/TokenLogo";
import { cn } from "@/lib/utils";

const truncate = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

const formatUsd = (n: number | null) => {
  if (n == null) return "—";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
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
          </p>
        </div>
        <Zap className="h-4 w-4 text-primary" />
      </div>

      {data.curatedBuyers.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          No tracked smart-money wallets bought ${t.symbol} in the first {data.windowHours}h.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {data.curatedBuyers.map((b) => (
            <BuyerRow key={b.address} buyer={b} />
          ))}
        </ul>
      )}
    </div>
  );
};

const BuyerRow = ({ buyer }: { buyer: EarlyBuyer }) => {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-xs font-medium text-foreground">
        {(buyer.label ?? buyer.address).slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {buyer.label ?? truncate(buyer.address)}
          </span>
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
          {truncate(buyer.address)} ·{" "}
          {buyer.minutesAfterLaunch != null
            ? `${buyer.minutesAfterLaunch}m after launch`
            : formatRelative(buyer.firstBuyAt)}
        </p>
      </div>
      <div className="text-right text-xs">
        <p className="font-medium text-foreground">{formatUsd(buyer.firstBuyUsd)}</p>
        <p className="text-[10px] text-muted-foreground">first buy</p>
      </div>
    </li>
  );
};

interface ActivityProps {
  data: SmartMoneyActivityData;
}

export const SmartMoneyActivityCard = ({ data }: ActivityProps) => {
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
          last {data.windowHours}h · {data.walletsTracked} wallets
        </span>
      </div>

      {data.trades.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          No tracked wallets traded in the last {data.windowHours}h.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {data.trades.map((t) => (
            <TradeRow key={t.id} trade={t} />
          ))}
        </ul>
      )}
    </div>
  );
};

const TradeRow = ({ trade }: { trade: SmartMoneyTrade }) => {
  const isBuy = trade.side === "buy";
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-xs font-medium text-foreground">
        {trade.wallet.label.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">
            {trade.wallet.label}
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
              isBuy ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            {trade.side}
          </span>
          {trade.token && (
            <span className="truncate text-sm text-foreground">
              ${trade.token.symbol}
            </span>
          )}
        </div>
        <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Wallet className="h-3 w-3" />
          {truncate(trade.wallet.address)} · {formatRelative(trade.timestamp)}
          {trade.source && <span>· {trade.source.toLowerCase()}</span>}
        </p>
      </div>
      <a
        href={`https://solscan.io/tx/${trade.signature}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col items-end gap-0.5 text-right text-xs text-foreground hover:text-primary"
      >
        <span className="font-medium">{formatUsd(trade.valueUsd)}</span>
        <ExternalLink className="h-3 w-3 opacity-60" />
      </a>
    </li>
  );
};
