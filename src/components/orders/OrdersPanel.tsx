import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import {
  Clock,
  Loader2,
  Repeat,
  Sparkles,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { TokenLogo } from "@/components/TokenLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { useTradeSigner } from "@/hooks/useTradeSigner";
import type { WalletSource } from "@/components/trade/WalletSourcePicker";

/**
 * OrdersPanel — unified active orders view across Limit + DCA, fetched for
 * BOTH the user's Vision Wallet and any connected external Solana wallet.
 *
 * Cancel reuses the existing edge functions:
 *   - Limit:   limit-order-manage (action=cancel) → limit-order-execute
 *   - DCA:     recurring-cancel                  → recurring-execute
 *
 * Signing is delegated to useTradeSigner so the same flow works for Vision
 * (custodial Privy) and external (wallet-adapter) sources.
 *
 * Edits aren't supported by Jupiter's APIs — users cancel + recreate from
 * the Trade page. We surface that in the empty/help copy.
 */

type OrderKind = "limit" | "dca";

interface UnifiedOrder {
  id: string;
  kind: OrderKind;
  source: WalletSource;
  walletAddress: string;
  inMint: string;
  outMint: string;
  inSymbol: string;
  outSymbol: string;
  inLogo: string | null;
  outLogo: string | null;
  inAmount: number;
  outAmount: number | null;
  /** Per-cycle amount for DCA, null for limit. */
  perCycleAmount: number | null;
  pctFilled: number | null;
  intervalSec: number | null;
  /** ms unix; for limit = expiry, for DCA = next cycle. */
  primaryTimeMs: number | null;
  createdAtMs: number | null;
}

const supaPost = async <T = unknown>(fn: string, body: unknown): Promise<T> => {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    let msg: string | null = null;
    if (ctx?.json) {
      try {
        const p = (await ctx.json()) as { error?: string };
        if (p?.error) msg = String(p.error);
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg ?? error.message ?? `${fn} failed`);
  }
  if (data && typeof data === "object" && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
};

const toMs = (v: string | number | undefined | null): number | null => {
  if (v == null || v === "" || v === "0") return null;
  if (typeof v === "string" && /[A-Z]/.test(v)) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n) || n <= 0) return null;
  // Heuristic: < 10^11 = seconds, otherwise ms.
  return n < 10_000_000_000 ? n * 1000 : n;
};

const toAtomic = (
  v: string | number | undefined | null,
  decimals: number,
): number => {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return 0;
  return n / Math.pow(10, decimals);
};

const fmtAmount = (n: number): string => {
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs >= 0.0001)
    return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return n.toLocaleString("en-US", {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  });
};

const fmtCountdown = (ms: number | null): string => {
  if (!ms) return "No expiry";
  const diff = ms - Date.now();
  if (diff <= 0) return "Due";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const fmtFrequency = (sec: number | null): string => {
  if (!sec) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d >= 7 && d % 7 === 0) return `${d / 7}w`;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h`;
  return `${Math.floor(sec / 60)}m`;
};

interface RawLimitOrder {
  orderKey?: string;
  publicKey?: string;
  account?: Record<string, unknown> & {
    inputMint?: string;
    outputMint?: string;
    makingAmount?: string | number;
    takingAmount?: string | number;
    rawMakingAmount?: string | number;
    rawTakingAmount?: string | number;
    expiredAt?: string | number | null;
    createdAt?: string | number | null;
    inputMintInfo?: { symbol?: string; decimals?: number; logo?: string | null };
    outputMintInfo?: { symbol?: string; decimals?: number; logo?: string | null };
  };
}

interface RawDcaOrder {
  orderKey?: string;
  inputMint?: string;
  outputMint?: string;
  inDeposited?: string | number;
  inUsed?: string | number;
  outReceived?: string | number;
  cycleFrequency?: string | number;
  inAmountPerCycle?: string | number;
  nextCycleAt?: string | number;
  createdAt?: string | number;
  inputTokenInfo?: { symbol?: string; decimals?: number; logo?: string | null } | null;
  outputTokenInfo?: { symbol?: string; decimals?: number; logo?: string | null } | null;
}

const normalizeLimit = (
  o: RawLimitOrder,
  source: WalletSource,
  walletAddress: string,
): UnifiedOrder | null => {
  const merged = { ...(o.account ?? {}), ...o } as Record<string, unknown> & {
    inputMint?: string;
    outputMint?: string;
    makingAmount?: string | number;
    takingAmount?: string | number;
    rawMakingAmount?: string | number;
    rawTakingAmount?: string | number;
    expiredAt?: string | number | null;
    createdAt?: string | number | null;
    inputMintInfo?: { symbol?: string; decimals?: number; logo?: string | null };
    outputMintInfo?: { symbol?: string; decimals?: number; logo?: string | null };
  };
  const id = o.orderKey ?? o.publicKey ?? "";
  const inputMint = merged.inputMint ?? "";
  const outputMint = merged.outputMint ?? "";
  if (!id || !inputMint || !outputMint) return null;
  const inDec = merged.inputMintInfo?.decimals ?? 9;
  const outDec = merged.outputMintInfo?.decimals ?? 9;

  let inAmount = Number(merged.makingAmount);
  if (!Number.isFinite(inAmount) || inAmount === 0) {
    inAmount = toAtomic(merged.rawMakingAmount, inDec);
  }
  let outAmount = Number(merged.takingAmount);
  if (!Number.isFinite(outAmount) || outAmount === 0) {
    outAmount = toAtomic(merged.rawTakingAmount, outDec);
  }

  return {
    id,
    kind: "limit",
    source,
    walletAddress,
    inMint: inputMint,
    outMint: outputMint,
    inSymbol: merged.inputMintInfo?.symbol || `${inputMint.slice(0, 4)}…`,
    outSymbol: merged.outputMintInfo?.symbol || `${outputMint.slice(0, 4)}…`,
    inLogo: merged.inputMintInfo?.logo ?? null,
    outLogo: merged.outputMintInfo?.logo ?? null,
    inAmount,
    outAmount,
    perCycleAmount: null,
    pctFilled: null,
    intervalSec: null,
    primaryTimeMs: toMs(merged.expiredAt),
    createdAtMs: toMs(merged.createdAt),
  };
};

const normalizeDca = (
  o: RawDcaOrder,
  source: WalletSource,
  walletAddress: string,
): UnifiedOrder | null => {
  const id = o.orderKey;
  if (!id || !o.inputMint || !o.outputMint) return null;
  const inDec = o.inputTokenInfo?.decimals ?? 9;
  const outDec = o.outputTokenInfo?.decimals ?? 9;
  const totalDeposited = toAtomic(o.inDeposited, inDec);
  const totalUsed = toAtomic(o.inUsed, inDec);
  const pct =
    totalDeposited > 0 ? Math.min(100, (totalUsed / totalDeposited) * 100) : 0;

  return {
    id,
    kind: "dca",
    source,
    walletAddress,
    inMint: o.inputMint,
    outMint: o.outputMint,
    inSymbol: o.inputTokenInfo?.symbol || `${o.inputMint.slice(0, 4)}…`,
    outSymbol: o.outputTokenInfo?.symbol || `${o.outputMint.slice(0, 4)}…`,
    inLogo: o.inputTokenInfo?.logo ?? null,
    outLogo: o.outputTokenInfo?.logo ?? null,
    inAmount: totalDeposited,
    outAmount: toAtomic(o.outReceived, outDec) || null,
    perCycleAmount: toAtomic(o.inAmountPerCycle, inDec),
    pctFilled: pct,
    intervalSec: Number(o.cycleFrequency ?? 0) || null,
    primaryTimeMs: toMs(o.nextCycleAt ?? null),
    createdAtMs: toMs(o.createdAt ?? null),
  };
};

type FilterKind = "all" | "limit" | "dca";

export const OrdersPanel = () => {
  const queryClient = useQueryClient();
  const { solanaAddress: visionSolana } = useVisionWallet();
  const externalWallet = useWallet();
  const externalSolana = externalWallet.publicKey?.toBase58() ?? null;

  // Build a list of (source, wallet) tuples we should query. Skip duplicates
  // — if the user happens to have connected the same address via both paths,
  // dedupe so we don't double-list orders.
  const sources = useMemo(() => {
    const out: { source: WalletSource; wallet: string }[] = [];
    if (visionSolana) out.push({ source: "vision", wallet: visionSolana });
    if (externalSolana && externalSolana !== visionSolana) {
      out.push({ source: "external", wallet: externalSolana });
    }
    return out;
  }, [visionSolana, externalSolana]);

  // 2 queries per (source, wallet): one for limit orders, one for DCA.
  const queries = useQueries({
    queries: sources.flatMap(({ source, wallet }) => [
      {
        queryKey: ["orders-page", "limit", wallet] as const,
        queryFn: async () => {
          const res = await supaPost<{ orders?: RawLimitOrder[] }>(
            "limit-order-manage",
            { action: "list", wallet, status: "active" },
          );
          return (res?.orders ?? [])
            .map((o) => normalizeLimit(o, source, wallet))
            .filter((x): x is UnifiedOrder => !!x);
        },
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
      },
      {
        queryKey: ["orders-page", "dca", wallet] as const,
        queryFn: async () => {
          const res = await supaPost<{
            orders?: RawDcaOrder[];
            activeOrders?: RawDcaOrder[];
            all?: RawDcaOrder[];
          }>("recurring-orders", { user: wallet, orderStatus: "active" });
          const raws = res?.orders ?? res?.activeOrders ?? res?.all ?? [];
          return raws
            .map((o) => normalizeDca(o, source, wallet))
            .filter((x): x is UnifiedOrder => !!x);
        },
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
      },
    ]),
  });

  const isLoading = queries.length > 0 && queries.some((q) => q.isLoading);
  const isFetching = queries.some((q) => q.isFetching);
  const hasError = queries.some((q) => q.isError);
  const allOrders: UnifiedOrder[] = useMemo(
    () => queries.flatMap((q) => q.data ?? []),
    [queries],
  );

  const [filter, setFilter] = useState<FilterKind>("all");
  const visible = useMemo(() => {
    const subset =
      filter === "all" ? allOrders : allOrders.filter((o) => o.kind === filter);
    // Sort by next-action time ascending; nulls last.
    return [...subset].sort((a, b) => {
      const aT = a.primaryTimeMs ?? Infinity;
      const bT = b.primaryTimeMs ?? Infinity;
      if (aT !== bT) return aT - bT;
      return (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
    });
  }, [allOrders, filter]);

  const limitCount = allOrders.filter((o) => o.kind === "limit").length;
  const dcaCount = allOrders.filter((o) => o.kind === "dca").length;
  const showSourceBadge = sources.length > 1;

  // Tick every 30s so countdowns refresh without re-fetching.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["orders-page"] });
  }, [queryClient]);

  // ---- Cancel flow (works for both Vision and external) ----
  const visionSigner = useTradeSigner("vision");
  const externalSigner = useTradeSigner("external");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleCancel = useCallback(
    async (order: UnifiedOrder) => {
      const signer = order.source === "vision" ? visionSigner : externalSigner;
      if (!signer.ready) {
        toast({
          title: "Signer not ready",
          description:
            order.source === "vision"
              ? "Vision Wallet is initialising. Try again in a moment."
              : "Connect your external wallet to cancel this order.",
          variant: "destructive",
        });
        return;
      }
      setCancellingId(order.id);
      try {
        // 1. Build the cancel tx (Limit vs DCA path).
        let txB64: string;
        let requestId: string;
        if (order.kind === "limit") {
          const built = await supaPost<{ transaction: string; requestId: string }>(
            "limit-order-manage",
            {
              action: "cancel",
              maker: order.walletAddress,
              order: order.id,
            },
          );
          txB64 = built.transaction;
          requestId = built.requestId;
        } else {
          const built = await supaPost<{ transaction: string; requestId: string }>(
            "recurring-cancel",
            {
              user: order.walletAddress,
              order: order.id,
              recurringType: "time",
            },
          );
          txB64 = built.transaction;
          requestId = built.requestId;
        }
        if (!txB64 || !requestId) throw new Error("Couldn't build cancel tx");

        // 2. Deserialize → sign → re-serialize via the unified signer.
        const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(txBytes);
        const signedB64 = await signer.signOnly(tx);

        // 3. Submit to Jupiter via the matching execute function.
        const execFn =
          order.kind === "limit" ? "limit-order-execute" : "recurring-execute";
        const exec = await supaPost<{ signature?: string; txSignature?: string }>(
          execFn,
          { requestId, signedTransaction: signedB64 },
        );
        const sig = exec?.signature ?? exec?.txSignature ?? null;

        toast({
          title: order.kind === "limit" ? "Limit cancelled" : "DCA cancelled",
          description: sig
            ? `${order.inSymbol} → ${order.outSymbol} · ${String(sig).slice(0, 8)}…`
            : `${order.inSymbol} → ${order.outSymbol}`,
        });
        // Jupiter index lags ~1.5s; refetch then.
        setTimeout(refreshAll, 1500);
      } catch (e) {
        toast({
          title: "Couldn't cancel",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setCancellingId(null);
      }
    },
    [visionSigner, externalSigner, refreshAll],
  );

  // ---- Render ----
  if (sources.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/30 p-10 text-center backdrop-blur-md">
        <p className="text-sm text-muted-foreground">
          Connect a wallet or create your Vision Wallet to view your active orders.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter chips + counts + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label="All"
            count={allOrders.length}
          />
          <FilterChip
            active={filter === "limit"}
            onClick={() => setFilter("limit")}
            label="Limit"
            count={limitCount}
          />
          <FilterChip
            active={filter === "dca"}
            onClick={() => setFilter("dca")}
            label="DCA"
            count={dcaCount}
          />
        </div>
        <button
          type="button"
          onClick={refreshAll}
          disabled={isFetching}
          className="ease-vision font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border/60 bg-card/40 px-5 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : hasError && allOrders.length === 0 ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4 font-mono text-[11px] text-destructive">
          Couldn't load some orders. Try refreshing.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? "No active orders."
              : filter === "limit"
                ? "No active limit orders."
                : "No active DCA orders."}
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            Place one from the Trade page
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((o) => (
            <OrderRow
              key={`${o.kind}:${o.id}`}
              order={o}
              cancelling={cancellingId === o.id}
              onCancel={() => handleCancel(o)}
              showSourceBadge={showSourceBadge}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FilterChip = ({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "ease-vision rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors",
      active
        ? "border-primary/60 bg-primary/10 text-foreground"
        : "border-border/60 bg-secondary/30 text-muted-foreground hover:border-border hover:text-foreground",
    )}
    aria-pressed={active}
  >
    {label}
    <span
      className={cn(
        "ml-1.5",
        active ? "text-primary" : "text-muted-foreground/70",
      )}
    >
      {count}
    </span>
  </button>
);

const OrderRow = ({
  order,
  cancelling,
  onCancel,
  showSourceBadge,
}: {
  order: UnifiedOrder;
  cancelling: boolean;
  onCancel: () => void;
  showSourceBadge: boolean;
}) => {
  const expired =
    order.kind === "limit" &&
    order.primaryTimeMs != null &&
    order.primaryTimeMs <= Date.now();
  const due =
    order.kind === "dca" &&
    order.primaryTimeMs != null &&
    order.primaryTimeMs <= Date.now();

  return (
    <div className="ease-vision rounded-2xl border border-border bg-card/60 p-3 backdrop-blur-sm transition-colors hover:border-border/90">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <TokenLogo logo={order.inLogo} symbol={order.inSymbol} size={28} />
          <div className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-card">
            <TokenLogo logo={order.outLogo} symbol={order.outSymbol} size={18} />
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate font-mono text-[12px] text-foreground">
              {order.kind === "limit" ? (
                <>
                  <span className="text-muted-foreground">Sell</span>{" "}
                  {fmtAmount(order.inAmount)} {order.inSymbol}{" "}
                  <span className="text-muted-foreground">→</span>{" "}
                  {fmtAmount(order.outAmount ?? 0)} {order.outSymbol}
                </>
              ) : (
                <>
                  {fmtAmount(order.perCycleAmount ?? 0)} {order.inSymbol}{" "}
                  <span className="text-muted-foreground">→</span>{" "}
                  {order.outSymbol}
                </>
              )}
            </p>
            <KindBadge kind={order.kind} />
            {showSourceBadge && <SourceBadge source={order.source} />}
          </div>

          {order.kind === "dca" && (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                <span>
                  {fmtAmount(
                    order.inAmount * ((order.pctFilled ?? 0) / 100),
                  )}{" "}
                  / {fmtAmount(order.inAmount)} {order.inSymbol} used
                </span>
                <span>{(order.pctFilled ?? 0).toFixed(0)}%</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-secondary/40">
                <div
                  className="h-full bg-primary/70"
                  style={{
                    width: `${Math.max(2, Math.min(100, order.pctFilled ?? 0))}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
            {order.kind === "dca" ? (
              <>
                <span className="flex items-center gap-1">
                  <Repeat className="h-2.5 w-2.5" />
                  Every {fmtFrequency(order.intervalSec)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  <span className={cn(due && "text-up")}>
                    Next {fmtCountdown(order.primaryTimeMs)}
                  </span>
                </span>
                {order.outAmount != null && order.outAmount > 0 && (
                  <span className="text-foreground/80">
                    +{fmtAmount(order.outAmount)} {order.outSymbol}
                  </span>
                )}
              </>
            ) : (
              <span className="flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                <span className={cn(expired && "text-down")}>
                  {fmtCountdown(order.primaryTimeMs)}
                </span>
              </span>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          disabled={cancelling}
          className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Cancel order"
          title="Cancel order"
        >
          {cancelling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
};

const KindBadge = ({ kind }: { kind: OrderKind }) => (
  <span className="rounded-full border border-border/60 bg-secondary/50 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
    {kind === "limit" ? "Limit" : "DCA"}
  </span>
);

const SourceBadge = ({ source }: { source: WalletSource }) => (
  <span
    className={cn(
      "flex items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider",
      source === "vision"
        ? "border-primary/40 bg-primary/10 text-primary"
        : "border-border/60 bg-secondary/50 text-muted-foreground",
    )}
    title={source === "vision" ? "Vision Wallet" : "External wallet"}
  >
    {source === "vision" ? (
      <Sparkles className="h-2.5 w-2.5" />
    ) : (
      <WalletIcon className="h-2.5 w-2.5" />
    )}
    {source === "vision" ? "Vision" : "External"}
  </span>
);
