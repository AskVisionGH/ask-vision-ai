import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronUp, ExternalLink, Repeat, TrendingDown, TrendingUp } from "lucide-react";
import { TokenLogo } from "@/components/TokenLogo";
import { cn } from "@/lib/utils";
import type {
  ParsedTx,
  RecentTxsData,
  TokenPnL,
  TokenPnLData,
  WalletPnLData,
} from "@/lib/chat-stream";

const PAGE = 5;

// ---------------- formatting helpers ----------------

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

const relativeTime = (ts: number) => {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const pnlTone = (n: number) =>
  n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-muted-foreground";

const solscan = (sig: string) => `https://solscan.io/tx/${sig}`;

// ---------------- Expandable list wrapper ----------------

function ExpandableList<T>({
  items,
  renderItem,
  page = PAGE,
  empty,
}: {
  items: T[];
  renderItem: (item: T, idx: number) => React.ReactNode;
  page?: number;
  empty?: React.ReactNode;
}) {
  const [shown, setShown] = useState(page);
  const visible = items.slice(0, shown);
  const hasMore = items.length > shown;
  const canCollapse = shown > page;

  if (items.length === 0 && empty) return <>{empty}</>;

  return (
    <>
      <ul className="divide-y divide-border/40">
        {visible.map((item, idx) => (
          <li key={idx}>{renderItem(item, idx)}</li>
        ))}
      </ul>
      {(hasMore || canCollapse) && (
        <div className="flex items-center justify-center gap-2 border-t border-border/40 px-5 py-2.5">
          {hasMore && (
            <button
              onClick={() => setShown((s) => s + page)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <ChevronDown className="h-3 w-3" />
              Show {Math.min(page, items.length - shown)} more
            </button>
          )}
          {canCollapse && (
            <button
              onClick={() => setShown(page)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:underline"
            >
              <ChevronUp className="h-3 w-3" />
              Show less
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ---------------- Recent Txs Card ----------------

export const RecentTxsCard = ({ data }: { data: RecentTxsData }) => {
  if (data.error) return <ErrorCard message={data.error} />;
  if (!data.txs || data.txs.length === 0) {
    return (
      <CardShell>
        <Header
          eyebrow="Recent activity"
          title="No transactions"
          subtitle={`Last ${data.windowDays} days · ${truncate(data.address)}`}
        />
        <div className="px-5 py-6 text-center text-sm text-muted-foreground">
          No on-chain activity in the last {data.windowDays} days.
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <Header
        eyebrow="Recent activity"
        title={`${data.totalCount} ${data.totalCount === 1 ? "transaction" : "transactions"}`}
        subtitle={`Last ${data.windowDays} days · ${truncate(data.address)}`}
      />
      <ExpandableList
        items={data.txs}
        renderItem={(tx) => <TxRow tx={tx} />}
      />
    </CardShell>
  );
};

const TxRow = ({ tx }: { tx: ParsedTx }) => {
  const Icon = tx.type === "swap" ? Repeat : tx.type === "transfer_in" ? ArrowDownLeft : ArrowUpRight;
  const tone =
    tx.type === "transfer_in"
      ? "text-emerald-400"
      : tx.type === "transfer_out"
        ? "text-rose-400"
        : "text-primary";

  let label: React.ReactNode;
  let detail: string | null = null;

  if (tx.type === "swap" && tx.inToken && tx.outToken) {
    label = (
      <>
        <span className="font-mono text-foreground">
          {fmtAmount(tx.inToken.amount)} ${tx.inToken.symbol}
        </span>
        <span className="text-muted-foreground/60"> → </span>
        <span className="font-mono text-foreground">
          {fmtAmount(tx.outToken.amount)} ${tx.outToken.symbol}
        </span>
      </>
    );
    detail = tx.source ? `via ${tx.source.toLowerCase()}` : "swap";
  } else if (tx.type === "transfer_in" && tx.inToken) {
    label = (
      <>
        <span className="font-mono text-foreground">
          +{fmtAmount(tx.inToken.amount)} ${tx.inToken.symbol}
        </span>
      </>
    );
    detail = tx.counterparty ? `from ${truncate(tx.counterparty)}` : "received";
  } else if (tx.type === "transfer_out" && tx.outToken) {
    label = (
      <>
        <span className="font-mono text-foreground">
          −{fmtAmount(tx.outToken.amount)} ${tx.outToken.symbol}
        </span>
      </>
    );
    detail = tx.counterparty ? `to ${truncate(tx.counterparty)}` : "sent";
  } else {
    label = <span className="text-muted-foreground">{tx.description ?? "On-chain action"}</span>;
    detail = tx.source ?? null;
  }

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary",
          tone,
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{label}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {detail && <span>{detail}</span>}
          {detail && <span className="text-muted-foreground/40">·</span>}
          <span>{relativeTime(tx.timestamp)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {tx.valueUsd != null && (
          <span className="font-mono text-[12px] text-foreground">{fmtUsd(tx.valueUsd)}</span>
        )}
        <a
          href={solscan(tx.signature)}
          target="_blank"
          rel="noreferrer"
          className="rounded-md p-1 text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
          title="View on Solscan"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
};

// ---------------- Token PnL Card ----------------

export const TokenPnLCard = ({ data }: { data: TokenPnLData }) => {
  if (data.error) return <ErrorCard message={data.error} />;
  const t = data.token;
  if (!t) {
    return (
      <CardShell>
        <Header
          eyebrow="Token P/L"
          title="No data"
          subtitle={`Last ${data.windowDays} days · ${truncate(data.address)}`}
        />
        <div className="px-5 py-6 text-center text-sm text-muted-foreground">
          No trades or holdings found for that token in the last {data.windowDays} days.
        </div>
      </CardShell>
    );
  }

  const totalPnl = t.realizedUsd + t.unrealizedUsd;
  const avgEntry = t.unitsBought > 0 ? t.costUsd / t.unitsBought : null;

  return (
    <CardShell>
      <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-4">
        <div className="flex items-center gap-3">
          <TokenLogo logo={t.logo} symbol={t.symbol} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-sm font-medium text-foreground">${t.symbol}</span>
              <span className="truncate text-xs text-muted-foreground/80">{t.name}</span>
            </div>
            <p className="mt-0.5 font-mono text-[10px] tracking-wider uppercase text-muted-foreground/70">
              30-day P/L
            </p>
          </div>
          <div className="text-right">
            <p className={cn("font-mono text-2xl font-light tracking-tight", pnlTone(totalPnl))}>
              {fmtUsd(totalPnl, { signed: true })}
            </p>
            <p className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground/70">
              total
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-border/40">
        <Stat label="Realized" value={fmtUsd(t.realizedUsd, { signed: true })} tone={pnlTone(t.realizedUsd)} />
        <Stat label="Unrealized" value={fmtUsd(t.unrealizedUsd, { signed: true })} tone={pnlTone(t.unrealizedUsd)} />
        <Stat label="Bought" value={`${fmtAmount(t.unitsBought)} (${t.buys})`} sub={fmtUsd(t.costUsd)} />
        <Stat label="Sold" value={`${fmtAmount(t.unitsSold)} (${t.sells})`} sub={fmtUsd(t.proceedsUsd)} />
        <Stat
          label="Avg entry"
          value={avgEntry != null ? fmtUsd(avgEntry) : "—"}
          sub={t.currentPriceUsd != null ? `now ${fmtUsd(t.currentPriceUsd)}` : null}
        />
        <Stat
          label="Holding"
          value={fmtAmount(t.currentUnits)}
          sub={t.currentValueUsd != null ? fmtUsd(t.currentValueUsd) : null}
        />
      </div>

      <div className="flex items-center justify-between border-t border-border/40 px-5 py-3 text-[11px]">
        <span className="font-mono text-muted-foreground">{truncate(t.mint, 6, 6)}</span>
        {t.pairUrl && (
          <a
            href={t.pairUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            DexScreener <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {data.recentTxs && data.recentTxs.length > 0 && (
        <div className="border-t border-border/40">
          <p className="px-5 pt-3 font-mono text-[10px] tracking-wider uppercase text-muted-foreground/70">
            Recent ${t.symbol} trades
          </p>
          <ExpandableList
            items={data.recentTxs}
            renderItem={(tx) => <TxRow tx={tx} />}
          />
        </div>
      )}
    </CardShell>
  );
};

// ---------------- Wallet PnL Dashboard Card ----------------

export const WalletPnLCard = ({ data }: { data: WalletPnLData }) => {
  if (data.error) return <ErrorCard message={data.error} />;
  const { totals, tokens, recentTxs } = data;
  const totalPnl = totals.totalRealizedUsd + totals.totalUnrealizedUsd;

  return (
    <CardShell>
      <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
              Wallet P/L · {data.windowDays}d
            </p>
            <p className={cn("mt-1 font-mono text-3xl font-light tracking-tight", pnlTone(totalPnl))}>
              {fmtUsd(totalPnl, { signed: true })}
            </p>
            <div className="mt-1 flex items-center gap-1 text-[11px]">
              {totalPnl >= 0 ? (
                <TrendingUp className="h-3 w-3 text-emerald-400" />
              ) : (
                <TrendingDown className="h-3 w-3 text-rose-400" />
              )}
              <span className="text-muted-foreground">
                {fmtUsd(totals.totalRealizedUsd, { signed: true })} realized ·{" "}
                {fmtUsd(totals.totalUnrealizedUsd, { signed: true })} unrealized
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
              Wallet
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{truncate(data.address)}</p>
            <p className="mt-2 font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
              Now
            </p>
            <p className="mt-1 font-mono text-xs text-foreground">
              {fmtUsd(totals.currentPortfolioUsd)}
            </p>
          </div>
        </div>
      </div>

      {tokens.length > 0 && (
        <div>
          <p className="px-5 pt-3 font-mono text-[10px] tracking-wider uppercase text-muted-foreground/70">
            By token
          </p>
          <ExpandableList
            items={tokens}
            renderItem={(t) => <TokenRow token={t} />}
          />
        </div>
      )}

      {recentTxs && recentTxs.length > 0 && (
        <div className="border-t border-border/40">
          <p className="px-5 pt-3 font-mono text-[10px] tracking-wider uppercase text-muted-foreground/70">
            Recent activity
          </p>
          <ExpandableList
            items={recentTxs}
            renderItem={(tx) => <TxRow tx={tx} />}
          />
        </div>
      )}

      <div className="border-t border-border/40 px-5 py-3 text-center font-mono text-[10px] tracking-wider uppercase text-muted-foreground/60">
        {totals.txCount} txs analyzed · cost basis: average price
      </div>
    </CardShell>
  );
};

const TokenRow = ({ token }: { token: TokenPnL }) => {
  const totalPnl = token.realizedUsd + token.unrealizedUsd;
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <TokenLogo logo={token.logo} symbol={token.symbol} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[13px] font-medium text-foreground">${token.symbol}</span>
          <span className="truncate text-xs text-muted-foreground/80">{token.name}</span>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {token.buys} buys · {token.sells} sells
          {token.currentValueUsd != null && token.currentValueUsd > 0.5 && (
            <> · holding {fmtUsd(token.currentValueUsd)}</>
          )}
        </p>
      </div>
      <div className="text-right">
        <p className={cn("font-mono text-[13px]", pnlTone(totalPnl))}>
          {fmtUsd(totalPnl, { signed: true })}
        </p>
        <p className="font-mono text-[10px] text-muted-foreground/70">
          R {fmtUsd(token.realizedUsd, { signed: true })} · U{" "}
          {fmtUsd(token.unrealizedUsd, { signed: true })}
        </p>
      </div>
      {token.pairUrl && (
        <a
          href={token.pairUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md p-1 text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
          title="DexScreener"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
};

// ---------------- Shared shells ----------------

const CardShell = ({ children }: { children: React.ReactNode }) => (
  <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
    {children}
  </div>
);

const Header = ({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) => (
  <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-4">
    <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
      {eyebrow}
    </p>
    <p className="mt-1 text-xl font-light tracking-tight text-foreground">{title}</p>
    {subtitle && <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{subtitle}</p>}
  </div>
);

const Stat = ({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: string;
}) => (
  <div className="bg-card px-4 py-3">
    <p className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground/70">
      {label}
    </p>
    <p className={cn("mt-1 font-mono text-sm", tone ?? "text-foreground")}>{value}</p>
    {sub && <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">{sub}</p>}
  </div>
);

const ErrorCard = ({ message }: { message: string }) => (
  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
    {message}
  </div>
);
