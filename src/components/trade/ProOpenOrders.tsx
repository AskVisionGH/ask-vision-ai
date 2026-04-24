import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { Loader2, X, Clock, TrendingUp, TrendingDown, ArrowDown, ArrowUp } from "lucide-react";
import { TokenLogo } from "@/components/TokenLogo";
import { Button } from "@/components/ui/button";
import { useJupiterV2Auth } from "@/hooks/useJupiterV2Auth";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// Lists the user's open Jupiter v2 trigger orders (single, OCO, OTOCO) and
// drives the two-step cancel + withdrawal signing flow.

interface RawOrderEvent {
  type?: string;
  state?: string;
}
interface RawV2Order {
  id?: string;
  orderType?: "single" | "oco" | "otoco" | string;
  orderState?: string;
  rawState?: string;
  inputMint?: string;
  outputMint?: string;
  triggerMint?: string;
  triggerCondition?: "above" | "below" | string;
  triggerPriceUsd?: number | string | null;
  tpPriceUsd?: number | string | null;
  slPriceUsd?: number | string | null;
  initialInputAmount?: string | number;
  remainingInputAmount?: string | number;
  inputAmount?: string | number;
  expiresAt?: number | string | null;
  createdAt?: number | string | null;
  events?: RawOrderEvent[];
  inputMintInfo?: { symbol?: string; decimals?: number; logo?: string | null } | null;
  outputMintInfo?: { symbol?: string; decimals?: number; logo?: string | null } | null;
  triggerMintInfo?: { symbol?: string; decimals?: number; logo?: string | null } | null;
}

interface NormalizedOrder {
  id: string;
  type: "single" | "oco" | "otoco";
  state: string;
  inMint: string;
  outMint: string;
  inSymbol: string;
  outSymbol: string;
  inLogo: string | null;
  outLogo: string | null;
  inAmount: number;
  triggerCondition: "above" | "below" | null;
  triggerPriceUsd: number | null;
  tpPriceUsd: number | null;
  slPriceUsd: number | null;
  expiresAt: number | null; // ms epoch
}

const fmtAmount = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs >= 0.01) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs >= 0.0001) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
};

const fmtUsd = (n: number | null) => {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toExponential(2)}`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
};

const fmtCountdown = (expiresAt: number | null) => {
  if (!expiresAt) return "No expiry";
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "Expired";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const toMs = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "" || v === "0") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n) || n <= 0) return null;
  // Jupiter expiresAt is already ms epoch per docs; if value looks like seconds, scale up.
  return n < 10_000_000_000 ? n * 1000 : n;
};

const normalize = (o: RawV2Order): NormalizedOrder | null => {
  if (!o.id || !o.inputMint || !o.outputMint) return null;
  const type = (o.orderType ?? "single") as NormalizedOrder["type"];

  const inDec: number = o.inputMintInfo?.decimals ?? 9;
  const inAtomic = Number(o.remainingInputAmount ?? o.initialInputAmount ?? o.inputAmount ?? 0);
  const inAmount = Number.isFinite(inAtomic) ? inAtomic / Math.pow(10, inDec) : 0;

  return {
    id: o.id,
    type: ["single", "oco", "otoco"].includes(type as string) ? (type as NormalizedOrder["type"]) : "single",
    state: o.orderState ?? o.rawState ?? "open",
    inMint: o.inputMint,
    outMint: o.outputMint,
    inSymbol: o.inputMintInfo?.symbol || `${o.inputMint.slice(0, 4)}…`,
    outSymbol: o.outputMintInfo?.symbol || `${o.outputMint.slice(0, 4)}…`,
    inLogo: o.inputMintInfo?.logo ?? null,
    outLogo: o.outputMintInfo?.logo ?? null,
    inAmount,
    triggerCondition:
      o.triggerCondition === "above" || o.triggerCondition === "below" ? o.triggerCondition : null,
    triggerPriceUsd: o.triggerPriceUsd != null ? Number(o.triggerPriceUsd) : null,
    tpPriceUsd: o.tpPriceUsd != null ? Number(o.tpPriceUsd) : null,
    slPriceUsd: o.slPriceUsd != null ? Number(o.slPriceUsd) : null,
    expiresAt: toMs(o.expiresAt ?? null),
  };
};

const supaPost = async (fn: string, body: unknown): Promise<any> => {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as any).context;
    let msg: string | null = null;
    if (ctx && typeof ctx.json === "function") {
      try {
        const p = await ctx.json();
        if (p?.error) msg = String(p.error);
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg ?? error.message ?? `${fn} failed`);
  }
  if (data && typeof data === "object" && (data as any).error) {
    throw new Error((data as any).error);
  }
  return data;
};

interface Props {
  /** Bumped from parent when a new bracket order has been placed, to force a refetch. */
  refreshKey?: number;
}

export const ProOpenOrders = ({ refreshKey = 0 }: Props) => {
  const { publicKey, connected, signTransaction } = useWallet();
  const { ensureJwt } = useJupiterV2Auth();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);

  const wallet = publicKey?.toBase58() ?? null;

  const queryKey = useMemo(
    () => ["pro-bracket-orders", wallet, refreshKey],
    [wallet, refreshKey],
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    enabled: !!wallet,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const jwt = await ensureJwt();
      const res = await supaPost("trigger-v2-orders", {
        action: "list",
        jwt,
        state: "active",
        limit: 50,
      });
      const raws: RawV2Order[] = (res as any)?.orders ?? [];
      return raws.map(normalize).filter((x): x is NormalizedOrder => !!x);
    },
  });

  // tick countdowns every 30s
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  void now;

  const handleCancel = useCallback(
    async (order: NormalizedOrder) => {
      if (!wallet || !signTransaction) return;
      setBusyId(order.id);
      try {
        const jwt = await ensureJwt();

        // Step 1 — initiate cancel: returns the unsigned withdrawal tx.
        toast({
          title: "Cancelling order",
          description: "Building withdrawal transaction…",
        });
        const built = await supaPost("trigger-v2-orders", {
          action: "cancel",
          jwt,
          orderId: order.id,
        });
        const txB64: string = (built as any).transaction;
        const cancelRequestId: string = (built as any).requestId;
        if (!txB64 || !cancelRequestId) {
          throw new Error("Withdrawal transaction missing");
        }

        // Step 2 — sign + confirm: funds return to the wallet.
        const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(txBytes);
        const signed = await signTransaction(tx);
        const signedB64 = btoa(String.fromCharCode(...signed.serialize()));

        const confirmed = await supaPost("trigger-v2-orders", {
          action: "confirm-cancel",
          jwt,
          orderId: order.id,
          signedTransaction: signedB64,
          cancelRequestId,
        });
        const sig = (confirmed as any).txSignature ?? (confirmed as any).signature ?? null;

        toast({
          title: "Funds withdrawn",
          description: sig
            ? `Cancelled ${order.inSymbol} bracket. Signature ${sig.slice(0, 8)}…`
            : `Cancelled ${order.inSymbol} bracket.`,
        });
        // Give the upstream index a moment to reflect the cancel.
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["pro-bracket-orders", wallet] });
        }, 1500);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        toast({
          title: "Couldn't cancel",
          description: msg,
          variant: "destructive",
        });
      } finally {
        setBusyId(null);
      }
    },
    [wallet, signTransaction, ensureJwt, queryClient],
  );

  if (!connected) return null;

  const orders = data ?? [];

  return (
    <div className="w-full max-w-[440px]">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Open brackets {orders.length > 0 && `(${orders.length})`}
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border/60 bg-card/40 px-5 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4 font-mono text-[11px] text-destructive">
          Couldn't load brackets. Sign the auth challenge if your wallet just connected, then refresh.
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 px-5 py-6 text-center">
          <p className="font-mono text-[11px] text-muted-foreground">
            No open bracket orders.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              cancelling={busyId === o.id}
              onCancel={() => handleCancel(o)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const OrderRow = ({
  order,
  cancelling,
  onCancel,
}: {
  order: NormalizedOrder;
  cancelling: boolean;
  onCancel: () => void;
}) => {
  const expiry = fmtCountdown(order.expiresAt);
  const expired = order.expiresAt != null && order.expiresAt <= Date.now();
  const typeLabel = order.type.toUpperCase();
  const isPendingWithdraw = order.state === "pending_withdraw";

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
          <div className="flex items-center gap-2">
            <p className="truncate font-mono text-[12px] text-foreground">
              <span className="text-muted-foreground">Spend</span> {fmtAmount(order.inAmount)}{" "}
              {order.inSymbol}{" "}
              <span className="text-muted-foreground">→</span> {order.outSymbol}
            </p>
            <span className="rounded-full border border-border/60 bg-secondary/50 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {typeLabel}
            </span>
          </div>

          {/* Trigger summary */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px]">
            {order.triggerPriceUsd != null && (
              <span className="flex items-center gap-1 text-muted-foreground">
                {order.triggerCondition === "above" ? (
                  <ArrowUp className="h-2.5 w-2.5" />
                ) : (
                  <ArrowDown className="h-2.5 w-2.5" />
                )}
                Entry {fmtUsd(order.triggerPriceUsd)}
              </span>
            )}
            {order.tpPriceUsd != null && (
              <span className="flex items-center gap-1 text-up">
                <TrendingUp className="h-2.5 w-2.5" />
                TP {fmtUsd(order.tpPriceUsd)}
              </span>
            )}
            {order.slPriceUsd != null && (
              <span className="flex items-center gap-1 text-down">
                <TrendingDown className="h-2.5 w-2.5" />
                SL {fmtUsd(order.slPriceUsd)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              <span className={cn(expired && "text-down")}>{expiry}</span>
            </span>
            {isPendingWithdraw && (
              <span className="text-amber-400">Withdrawal pending</span>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          disabled={cancelling}
          className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={isPendingWithdraw ? "Retry withdrawal" : "Cancel bracket"}
          title={isPendingWithdraw ? "Retry withdrawal" : "Cancel bracket"}
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
