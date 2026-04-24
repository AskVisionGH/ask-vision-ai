import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { Clock, Loader2, Repeat, X } from "lucide-react";
import { TokenLogo } from "@/components/TokenLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// Lists active DCA orders for the connected wallet and drives the cancel flow.

interface RawDcaOrder {
  orderKey?: string;
  userKey?: string;
  inputMint?: string;
  outputMint?: string;
  inDeposited?: string | number;
  inWithdrawn?: string | number;
  inUsed?: string | number;
  outReceived?: string | number;
  outWithdrawn?: string | number;
  cycleFrequency?: string | number; // seconds
  inAmountPerCycle?: string | number;
  nextCycleAt?: string | number;
  createdAt?: string | number;
  inputTokenInfo?: {
    symbol?: string;
    decimals?: number;
    logo?: string | null;
  } | null;
  outputTokenInfo?: {
    symbol?: string;
    decimals?: number;
    logo?: string | null;
  } | null;
}

interface NormalizedDca {
  id: string;
  inMint: string;
  outMint: string;
  inSymbol: string;
  outSymbol: string;
  inLogo: string | null;
  outLogo: string | null;
  totalDeposited: number;
  totalUsed: number;
  pctFilled: number;
  outReceived: number;
  intervalSec: number;
  perCycleAmount: number;
  nextCycleAtMs: number | null;
}

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

const toMs = (v: string | number | undefined | null): number | null => {
  if (v == null || v === "" || v === "0") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 10_000_000_000 ? n * 1000 : n;
};

const toAtomic = (v: string | number | undefined | null, decimals: number): number => {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return 0;
  return n / Math.pow(10, decimals);
};

const fmtAmount = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs >= 0.0001) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
};

const fmtCountdown = (ms: number | null) => {
  if (!ms) return "—";
  const diff = ms - Date.now();
  if (diff <= 0) return "Due";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const fmtFrequency = (sec: number) => {
  if (!sec) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d >= 7 && d % 7 === 0) return `${d / 7}w`;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h`;
  return `${Math.floor(sec / 60)}m`;
};

const normalize = (o: RawDcaOrder): NormalizedDca | null => {
  const id = o.orderKey;
  if (!id || !o.inputMint || !o.outputMint) return null;
  const inDec = o.inputTokenInfo?.decimals ?? 9;
  const outDec = o.outputTokenInfo?.decimals ?? 9;
  const totalDeposited = toAtomic(o.inDeposited, inDec);
  const totalUsed = toAtomic(o.inUsed, inDec);
  const pct = totalDeposited > 0 ? Math.min(100, (totalUsed / totalDeposited) * 100) : 0;
  return {
    id,
    inMint: o.inputMint,
    outMint: o.outputMint,
    inSymbol: o.inputTokenInfo?.symbol || `${o.inputMint.slice(0, 4)}…`,
    outSymbol: o.outputTokenInfo?.symbol || `${o.outputMint.slice(0, 4)}…`,
    inLogo: o.inputTokenInfo?.logo ?? null,
    outLogo: o.outputTokenInfo?.logo ?? null,
    totalDeposited,
    totalUsed,
    pctFilled: pct,
    outReceived: toAtomic(o.outReceived, outDec),
    intervalSec: Number(o.cycleFrequency ?? 0),
    perCycleAmount: toAtomic(o.inAmountPerCycle, inDec),
    nextCycleAtMs: toMs(o.nextCycleAt ?? null),
  };
};

interface Props {
  refreshKey?: number;
}

export const DcaOpenOrders = ({ refreshKey = 0 }: Props) => {
  const { publicKey, connected, signTransaction } = useWallet();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const wallet = publicKey?.toBase58() ?? null;

  const queryKey = useMemo(() => ["dca-orders", wallet, refreshKey], [wallet, refreshKey]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    enabled: !!wallet,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => {
      const res = await supaPost("recurring-orders", {
        user: wallet,
        orderStatus: "active",
      });
      const raws: RawDcaOrder[] =
        (res as any)?.orders ?? (res as any)?.activeOrders ?? (res as any)?.all ?? [];
      return raws.map(normalize).filter((x): x is NormalizedDca => !!x);
    },
  });

  const handleCancel = useCallback(
    async (order: NormalizedDca) => {
      if (!wallet || !signTransaction) return;
      setBusyId(order.id);
      try {
        toast({
          title: "Cancelling DCA",
          description: "Building cancellation transaction…",
        });
        const built = await supaPost("recurring-cancel", {
          user: wallet,
          order: order.id,
          recurringType: "time",
        });
        const txB64: string = built.transaction;
        const requestId: string = built.requestId;
        if (!txB64 || !requestId) throw new Error("Cancel transaction missing");

        const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(txBytes);
        const signed = await signTransaction(tx);
        const signedB64 = btoa(String.fromCharCode(...signed.serialize()));

        const executed = await supaPost("recurring-execute", {
          signedTransaction: signedB64,
          requestId,
        });
        const sig = executed?.signature ?? executed?.txSignature ?? null;

        toast({
          title: "DCA cancelled",
          description: sig
            ? `Refund signature ${String(sig).slice(0, 8)}…`
            : `${order.inSymbol} → ${order.outSymbol} cancelled.`,
        });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["dca-orders", wallet] });
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
    [wallet, signTransaction, queryClient],
  );

  if (!connected) return null;

  const orders = data ?? [];

  return (
    <div className="w-full max-w-[440px]">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Active DCA {orders.length > 0 && `(${orders.length})`}
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
          Couldn't load DCA orders. Try refreshing.
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 px-5 py-6 text-center">
          <p className="font-mono text-[11px] text-muted-foreground">
            No active DCA orders.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <DcaRow
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

const DcaRow = ({
  order,
  cancelling,
  onCancel,
}: {
  order: NormalizedDca;
  cancelling: boolean;
  onCancel: () => void;
}) => {
  const next = fmtCountdown(order.nextCycleAtMs);
  const due = order.nextCycleAtMs != null && order.nextCycleAtMs <= Date.now();

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
              {fmtAmount(order.perCycleAmount)} {order.inSymbol}{" "}
              <span className="text-muted-foreground">→</span> {order.outSymbol}
            </p>
            <span className="rounded-full border border-border/60 bg-secondary/50 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              DCA
            </span>
          </div>

          {/* Progress */}
          <div className="space-y-0.5">
            <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
              <span>
                {fmtAmount(order.totalUsed)} / {fmtAmount(order.totalDeposited)}{" "}
                {order.inSymbol} used
              </span>
              <span>{order.pctFilled.toFixed(0)}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-secondary/40">
              <div
                className="h-full bg-primary/70"
                style={{ width: `${Math.max(2, Math.min(100, order.pctFilled))}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Repeat className="h-2.5 w-2.5" />
              Every {fmtFrequency(order.intervalSec)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              <span className={cn(due && "text-up")}>Next {next}</span>
            </span>
            {order.outReceived > 0 && (
              <span className="text-foreground/80">
                +{fmtAmount(order.outReceived)} {order.outSymbol}
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
          aria-label="Cancel DCA"
          title="Cancel DCA"
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