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
// Smart-money activity (token-grouped)
// ─────────────────────────────────────────────────────────────────────────────

interface ActivityProps {
  data: SmartMoneyActivityData;
}

export const SmartMoneyActivityCard = ({ data }: ActivityProps) => {
  const tokens = data.tokens ?? [];

  if (data.error && tokens.length === 0) {
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
          last {data.windowHours}h · {data.walletsActive}/{data.walletsTracked} wallets active
        </span>
      </div>

      {tokens.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          {data.walletsActive === 0
            ? `None of the ${data.walletsTracked} tracked wallets made a trade in the last ${data.windowHours}h. Try a longer window.`
            : `${data.walletsActive} wallets were active but none of their trades cleared the noise filter in the last ${data.windowHours}h.`}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {tokens.map((t) => (
            <TokenRow key={t.token.address} token={t} />
          ))}
        </ul>
      )}
    </div>
  );
};

const TokenRow = ({ token }: { token: SmartMoneyTokenActivity }) => {
  const [open, setOpen] = useState(false);
  const isAccumulating = token.netUsd > 0;
  const isDistributing = token.netUsd < 0;
  const netLabel = formatUsd(Math.abs(token.netUsd));
  const tone =
    isAccumulating ? "text-up" : isDistributing ? "text-down" : "text-muted-foreground";
  const Icon = isAccumulating ? TrendingUp : isDistributing ? TrendingDown : TrendingUp;

  // Split summary line: "4 wallets bought $12k · 1 sold $2k"
  const segments: string[] = [];
  if (token.buyerCount > 0) {
    segments.push(`${token.buyerCount} ${token.buyerCount === 1 ? "wallet" : "wallets"} bought ${formatUsd(token.buyUsd)}`);
  }
  if (token.sellerCount > 0) {
    segments.push(`${token.sellerCount} sold ${formatUsd(token.sellUsd)}`);
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left ease-vision hover:bg-secondary/30"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <TokenLogo symbol={token.token.symbol} logo={token.token.logo} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              ${token.token.symbol}
            </span>
            <span className="truncate text-xs text-muted-foreground">{token.token.name}</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {segments.join(" · ") || `${token.totalTradeCount} trades`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <div className={cn("flex items-center gap-1 text-sm font-medium", tone)}>
            <Icon className="h-3 w-3" />
            {isAccumulating ? "+" : isDistributing ? "−" : ""}
            {netLabel}
          </div>
          <p className="text-[10px] text-muted-foreground">net · {formatRelative(token.latestTimestamp)}</p>
        </div>
      </button>

      {open && (
        <div className="border-t border-border/60 bg-secondary/20 px-3 py-2">
          <ul className="space-y-1">
            {token.wallets.map((w) => (
              <WalletDetailRow key={`${w.wallet.address}-${w.side}`} entry={w} tokenSymbol={token.token.symbol} />
            ))}
          </ul>
          {token.token.pairUrl && (
            <a
              href={token.token.pairUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              <LineChart className="h-3 w-3" />
              Chart
            </a>
          )}
        </div>
      )}
    </li>
  );
};

const sideStyles: Record<"buy" | "sell", string> = {
  buy: "bg-up/15 text-up",
  sell: "bg-down/15 text-down",
};

const WalletDetailRow = ({
  entry,
  tokenSymbol,
}: {
  entry: SmartMoneyWalletSummary;
  tokenSymbol: string;
}) => {
  const txLink = `https://solscan.io/tx/${entry.latestSignature}`;
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-[10px] font-medium text-foreground">
        {entry.wallet.label.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <a
            href={`https://solscan.io/account/${entry.wallet.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-xs font-medium text-foreground hover:text-primary"
          >
            {entry.wallet.label}
          </a>
          {entry.wallet.twitterHandle && (
            <a
              href={`https://x.com/${entry.wallet.twitterHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary"
              aria-label={`@${entry.wallet.twitterHandle} on X`}
            >
              <Twitter className="h-3 w-3" />
            </a>
          )}
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
              sideStyles[entry.side],
            )}
          >
            {entry.side}
          </span>
          {entry.count > 1 && (
            <span className="rounded-full bg-secondary px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
              ×{entry.count}
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {formatTokenAmount(entry.totalAmount)} ${tokenSymbol} · {formatRelative(entry.latestTimestamp)}
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-right text-xs">
        <span className="font-medium text-foreground">{formatUsd(entry.totalUsd)}</span>
        <a
          href={txLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-primary"
          aria-label="Open latest transaction"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </li>
  );
};
