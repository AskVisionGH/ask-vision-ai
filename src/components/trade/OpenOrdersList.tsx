import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { Loader2, X, Clock } from "lucide-react";
import { TokenLogo } from "@/components/TokenLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface RawOrder {
  orderKey?: string;
  publicKey?: string;
  account?: {
    inputMint?: string;
    outputMint?: string;
    makingAmount?: string;
    takingAmount?: string;
    expiredAt?: string | number | null;
    createdAt?: string | number | null;
    inputMintInfo?: { symbol?: string; decimals?: number; logo?: string | null };
    outputMintInfo?: { symbol?: string; decimals?: number; logo?: string | null };
  };
  inputMint?: string;
  outputMint?: string;
  makingAmount?: string;
  takingAmount?: string;
  expiredAt?: string | number | null;
  createdAt?: string | number | null;
  inputMintInfo?: { symbol?: string; decimals?: number; logo?: string | null };
  outputMintInfo?: { symbol?: string; decimals?: number; logo?: string | null };
}

interface NormalizedOrder {
  key: string;
  inputMint: string;
  outputMint: string;
  inSymbol: string;
  outSymbol: string;
  inLogo: string | null;
  outLogo: string | null;
  inAmount: number;
  outAmount: number;
  rate: number;
  expiredAt: number | null;
}

const fmtAmount = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs >= 0.01) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs >= 0.0001) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  // For dust amounts, cap at 8 decimals — no scientific notation.
  return n.toLocaleString("en-US", { maximumFractionDigits: 8, minimumFractionDigits: 0 });
};

const fmtRate = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs >= 0.01) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
};

const fmtCountdown = (expiredAt: number | null) => {
  if (!expiredAt) return "No expiry";
  const ms = expiredAt * 1000 - Date.now();
  if (ms <= 0) return "Expired";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const normalize = (o: RawOrder): NormalizedOrder | null => {
  const a = o.account ?? o;
  const key = o.orderKey ?? o.publicKey ?? "";
  const inputMint = a.inputMint ?? "";
  const outputMint = a.outputMint ?? "";
  if (!key || !inputMint || !outputMint) return null;
  const inDec = a.inputMintInfo?.decimals ?? 9;
  const outDec = a.outputMintInfo?.decimals ?? 9;
  const makingAtomic = Number(a.makingAmount ?? 0);
  const takingAtomic = Number(a.takingAmount ?? 0);
  const inAmount = makingAtomic / Math.pow(10, inDec);
  const outAmount = takingAtomic / Math.pow(10, outDec);
  const expiredAtRaw = a.expiredAt;
  let expiredAt: number | null = null;
  if (expiredAtRaw != null && expiredAtRaw !== "" && expiredAtRaw !== "0") {
    const n = Number(expiredAtRaw);
    if (Number.isFinite(n) && n > 0) expiredAt = n;
  }
  return {
    key,
    inputMint,
    outputMint,
    inSymbol: a.inputMintInfo?.symbol ?? "?",
    outSymbol: a.outputMintInfo?.symbol ?? "?",
    inLogo: a.inputMintInfo?.logo ?? null,
    outLogo: a.outputMintInfo?.logo ?? null,
    inAmount,
    outAmount,
    rate: inAmount > 0 ? outAmount / inAmount : 0,
    expiredAt,
  };
};

const supaPost = async (fn: string, body: unknown) => {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw new Error(error.message ?? `${fn} failed`);
  if (data && typeof data === "object" && "error" in (data as any) && (data as any).error) {
    throw new Error((data as any).error);
  }
  return data;
};

interface Props {
  /** Bumped from parent when a new order has been placed, to force a refetch. */
  refreshKey?: number;
}

export const OpenOrdersList = ({ refreshKey = 0 }: Props) => {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection: _connection } = useConnection();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);

  const wallet = publicKey?.toBase58() ?? null;

  const queryKey = useMemo(() => ["limit-orders", wallet, refreshKey], [wallet, refreshKey]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    enabled: !!wallet,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await supaPost("limit-order-manage", {
        action: "list",
        wallet,
        status: "active",
      });
      const raws: RawOrder[] = (res as any)?.orders ?? [];
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
      setCancellingKey(order.key);
      try {
        const built = await supaPost("limit-order-manage", {
          action: "cancel",
          maker: wallet,
          order: order.key,
        });
        const requestId = (built as any).requestId as string;
        const txB64 = (built as any).transaction as string;
        if (!requestId || !txB64) throw new Error("Couldn't build cancel tx");

        const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(txBytes);
        const signed = await signTransaction(tx);
        const signedB64 = btoa(String.fromCharCode(...signed.serialize()));

        const exec = await supaPost("limit-order-execute", {
          requestId,
          signedTransaction: signedB64,
        });
        const sig = (exec as any).signature;
        if (!sig) throw new Error("No signature returned");

        toast({ title: "Order cancelled", description: `${order.inSymbol} → ${order.outSymbol}` });
        // small delay so Jupiter's index reflects the cancel
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ["limit-orders", wallet] }), 1500);
      } catch (e) {
        toast({
          title: "Couldn't cancel",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setCancellingKey(null);
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
          Open orders {orders.length > 0 && `(${orders.length})`}
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border/60 bg-card/40 px-5 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4 font-mono text-[11px] text-destructive">
          Couldn't load orders
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 px-5 py-6 text-center">
          <p className="font-mono text-[11px] text-muted-foreground">
            No open limit orders.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => {
            const expiry = fmtCountdown(o.expiredAt);
            const expired = o.expiredAt && o.expiredAt * 1000 <= Date.now();
            return (
              <div
                key={o.key}
                className="ease-vision rounded-2xl border border-border bg-card/60 p-3 backdrop-blur-sm transition-colors hover:border-border/90"
              >
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <TokenLogo logo={o.inLogo} symbol={o.inSymbol} size={28} />
                    <div className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-card">
                      <TokenLogo logo={o.outLogo} symbol={o.outSymbol} size={18} />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[12px] text-foreground">
                      <span className="text-muted-foreground">Sell</span> {fmtAmount(o.inAmount)} {o.inSymbol}{" "}
                      <span className="text-muted-foreground">→</span> {fmtAmount(o.outAmount)} {o.outSymbol}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      @ {fmtAmount(o.rate)} {o.outSymbol}/{o.inSymbol}
                      <span className="mx-1.5 text-muted-foreground/40">·</span>
                      <Clock className="-mt-0.5 mr-0.5 inline h-2.5 w-2.5" />
                      <span className={cn(expired && "text-down")}>{expiry}</span>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCancel(o)}
                    disabled={cancellingKey === o.key}
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Cancel order"
                    title="Cancel order"
                  >
                    {cancellingKey === o.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
