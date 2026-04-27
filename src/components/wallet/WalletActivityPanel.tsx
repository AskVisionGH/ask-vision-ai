import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  ExternalLink,
  Loader2,
  RefreshCw,
  Repeat,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { txExplorerUrl, explorerLabel } from "@/lib/explorer";

/**
 * WalletActivityPanel — unified Solana + EVM activity feed for the
 * Vision Wallet. Calls the `wallet-activity` edge function which merges
 * server-recorded `tx_events` with on-chain incoming deposits.
 *
 * UX decisions (from chat):
 *   - Single unified list, sorted newest-first
 *   - Chain filter chips (All / Solana / EVM)
 *   - Infinite scroll via IntersectionObserver
 *   - One-line rows, click to expand details
 */

type TxEventItem = {
  id: string;
  kind: "tx_event";
  subKind: string;
  at: string;
  signature: string | null;
  walletAddress: string | null;
  valueUsd: number | null;
  inputMint: string | null;
  outputMint: string | null;
  inputAmount: number | null;
  outputAmount: number | null;
  recipient: string | null;
  metadata: Record<string, unknown> | null;
  explorerUrl: string | null;
};

type DepositItem = {
  id: string;
  kind: "deposit";
  chain: "solana" | "evm";
  chainId?: number;
  at: string;
  signature: string;
  from: string | null;
  asset: string;
  amountUi: number | null;
  explorerUrl: string;
};

type ActivityItem = TxEventItem | DepositItem;

type ChainFilter = "all" | "solana" | "evm";
type KindFilter = "all" | "swap" | "bridge" | "transfer" | "deposit";

const PAGE_SIZE = 30;

const itemKind = (item: ActivityItem): KindFilter => {
  if (item.kind === "deposit") return "deposit";
  switch (item.subKind) {
    case "swap":
      return "swap";
    case "bridge":
      return "bridge";
    case "transfer":
      return "transfer";
    default:
      return "transfer";
  }
};

const fmtAmount = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  if (Math.abs(n) < 1) return n.toFixed(6);
  if (Math.abs(n) < 1000) return n.toFixed(4);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return null;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n < 1 ? 4 : 2,
  });
};

const shortAddr = (s: string | null | undefined) => {
  if (!s) return "—";
  if (s.length <= 12) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};

const shortMint = (s: string | null | undefined) => {
  if (!s) return "—";
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};

const itemChain = (item: ActivityItem): "solana" | "evm" | "unknown" => {
  if (item.kind === "deposit") return item.chain;
  // Heuristic for tx_events: EVM hashes start with 0x, Solana sigs are base58.
  if (item.signature?.startsWith("0x")) return "evm";
  if (item.signature && item.signature.length >= 64) return "solana";
  // Check metadata for chain hint
  const meta = item.metadata as Record<string, unknown> | null;
  const metaChain = meta?.chain;
  if (metaChain === "solana" || metaChain === "evm") return metaChain;
  return "unknown";
};

const itemChainId = (item: ActivityItem): number | null => {
  if (item.kind === "deposit" && item.chain === "evm") return item.chainId ?? null;
  if (item.kind === "tx_event") {
    const meta = item.metadata as Record<string, unknown> | null;
    const v = meta?.chainId;
    if (typeof v === "number") return v;
  }
  return null;
};

export function WalletActivityPanel() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [chainFilter, setChainFilter] = useState<ChainFilter>("all");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback(async (before: string | null) => {
    const { data, error } = await supabase.functions.invoke("wallet-activity", {
      body: { before, limit: PAGE_SIZE },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data as { items: ActivityItem[]; nextCursor: string | null; hasMore: boolean };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: first, nextCursor, hasMore } = await fetchPage(null);
      setItems(first);
      setCursor(nextCursor);
      setHasMore(hasMore);
      setExpanded(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!cursor || !hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const next = await fetchPage(cursor);
      // Dedupe by id (cursor pages should be disjoint, but belt + suspenders).
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...next.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(next.nextCursor);
      setHasMore(next.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, hasMore, loadingMore, loading, fetchPage]);

  // Infinite scroll observer
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const filtered = useMemo(() => {
    if (chainFilter === "all") return items;
    return items.filter((i) => itemChain(i) === chainFilter);
  }, [items, chainFilter]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "solana", "evm"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setChainFilter(f)}
              className={cn(
                "ease-vision rounded-full border px-3 py-1 text-[11px] capitalize",
                chainFilter === f
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "evm" ? "EVM" : f}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="text-muted-foreground"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-12 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading activity…
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card/30 px-4 py-12 text-center text-xs text-muted-foreground">
          No activity yet. Make a swap or fund your wallet to see events here.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-card/40">
          {filtered.map((item) => (
            <ActivityRow
              key={item.id}
              item={item}
              expanded={expanded.has(item.id)}
              onToggle={() => toggleExpand(item.id)}
            />
          ))}
        </ul>
      )}

      {/* Infinite-scroll sentinel + manual fallback */}
      {hasMore && chainFilter === "all" && (
        <div ref={sentinelRef} className="flex items-center justify-center py-4">
          {loadingMore ? (
            <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more…
            </span>
          ) : (
            <button
              onClick={() => void loadMore()}
              className="text-[11px] text-muted-foreground hover:text-foreground ease-vision"
            >
              Load more
            </button>
          )}
        </div>
      )}
      {hasMore && chainFilter !== "all" && (
        <p className="py-4 text-center text-[10px] text-muted-foreground/70">
          Filter is on — switch to All to load older events.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────────────

function ActivityRow({
  item,
  expanded,
  onToggle,
}: {
  item: ActivityItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { icon: Icon, label, summary } = describeItem(item);
  const chain = itemChain(item);
  const chainId = itemChainId(item);
  const explorerUrl =
    item.kind === "deposit"
      ? item.explorerUrl
      : item.signature
        ? txExplorerUrl(item.signature, chainId)
        : null;

  return (
    <li>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left ease-vision hover:bg-secondary/40"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary/60">
          <Icon className="h-3.5 w-3.5 text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-xs text-foreground">{label}</p>
            {chain !== "unknown" && (
              <span className="rounded-full border border-border bg-secondary/40 px-1.5 py-px text-[9px] uppercase tracking-wider text-muted-foreground">
                {chain === "evm" && chainId ? explorerLabel(chainId).replace(" Etherscan", "") : chain}
              </span>
            )}
          </div>
          <p className="truncate text-[10px] text-muted-foreground">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <p className="text-[10px] text-muted-foreground">{timeAgo(item.at)}</p>
          <ChevronDown
            className={cn(
              "h-3 w-3 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-border/60 bg-secondary/20 px-3 py-3 text-[11px] text-muted-foreground">
          <DetailGrid item={item} />
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              View on {explorerLabel(chainId)} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </li>
  );
}

function DetailGrid({ item }: { item: ActivityItem }) {
  const rows: Array<[string, string]> = [];

  if (item.kind === "deposit") {
    rows.push(["Type", "Incoming deposit"]);
    rows.push(["From", shortAddr(item.from)]);
    rows.push([
      "Amount",
      `${fmtAmount(item.amountUi)} ${item.asset === "native" ? "" : item.asset === "SOL" ? "SOL" : shortMint(item.asset)}`.trim(),
    ]);
    rows.push(["When", new Date(item.at).toLocaleString()]);
    rows.push(["Signature", shortAddr(item.signature)]);
  } else {
    rows.push(["Type", item.subKind]);
    if (item.inputMint) rows.push(["In", `${fmtAmount(item.inputAmount)} ${shortMint(item.inputMint)}`]);
    if (item.outputMint) rows.push(["Out", `${fmtAmount(item.outputAmount)} ${shortMint(item.outputMint)}`]);
    if (item.recipient) rows.push(["Recipient", shortAddr(item.recipient)]);
    const usd = fmtUsd(item.valueUsd);
    if (usd) rows.push(["USD value", usd]);
    rows.push(["When", new Date(item.at).toLocaleString()]);
    if (item.signature) rows.push(["Signature", shortAddr(item.signature)]);
    const source = (item.metadata as Record<string, unknown> | null)?.source;
    if (typeof source === "string") rows.push(["Source", source.split("_").join(" ")]);
  }

  return (
    <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{k}</dt>
          <dd className="font-mono text-[11px] text-foreground/90 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function describeItem(item: ActivityItem): {
  icon: typeof ArrowDownLeft;
  label: string;
  summary: string;
} {
  if (item.kind === "deposit") {
    const asset =
      item.asset === "native" ? "native" : item.asset === "SOL" ? "SOL" : shortMint(item.asset);
    return {
      icon: ArrowDownLeft,
      label: `Received ${fmtAmount(item.amountUi)} ${asset}`,
      summary: `From ${shortAddr(item.from)}`,
    };
  }
  switch (item.subKind) {
    case "swap": {
      const inSym = shortMint(item.inputMint);
      const outSym = shortMint(item.outputMint);
      return {
        icon: Repeat,
        label: `Swap ${fmtAmount(item.inputAmount)} ${inSym} → ${outSym}`,
        summary: fmtUsd(item.valueUsd) ?? `Output ${fmtAmount(item.outputAmount)} ${outSym}`,
      };
    }
    case "bridge":
      return {
        icon: ArrowLeftRight,
        label: `Bridge ${fmtAmount(item.inputAmount)} ${shortMint(item.inputMint)}`,
        summary: `→ ${shortMint(item.outputMint)}` + (fmtUsd(item.valueUsd) ? ` · ${fmtUsd(item.valueUsd)}` : ""),
      };
    case "transfer":
    default: {
      const asset = shortMint(item.inputMint);
      const isWithdraw =
        (item.metadata as Record<string, unknown> | null)?.source === "vision_wallet_withdraw";
      return {
        icon: ArrowUpRight,
        label: `${isWithdraw ? "Withdraw" : "Sent"} ${fmtAmount(item.inputAmount)} ${asset}`,
        summary: `To ${shortAddr(item.recipient)}` + (fmtUsd(item.valueUsd) ? ` · ${fmtUsd(item.valueUsd)}` : ""),
      };
    }
  }
}
