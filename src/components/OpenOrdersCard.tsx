import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Loader2, Repeat, X } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { TokenLogo } from "@/components/TokenLogo";
import { toast } from "@/hooks/use-toast";
import { fmtAmount, supaPost } from "@/lib/chat-trade-utils";
import type { OpenOrderSummary, OpenOrdersData } from "@/lib/chat-stream";

interface Props {
  data: OpenOrdersData;
}

const fmtCountdown = (ms: number | null) => {
  if (!ms) return "No expiry";
  const diff = ms - Date.now();
  if (diff <= 0) return "Expired";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export const OpenOrdersCard = ({ data: initial }: Props) => {
  const [data, setData] = useState<OpenOrdersData>(initial);
  const { publicKey, connected, signTransaction } = useWallet();
  const [busyId, setBusyId] = useState<string | null>(null);

  const removeOrderLocal = (id: string) => {
    setData((prev) => {
      const next = prev.preview.filter((o) => o.id !== id);
      const removed = prev.preview.find((o) => o.id === id);
      const limitDelta = removed?.kind === "limit" ? 1 : 0;
      const dcaDelta = removed?.kind === "dca" ? 1 : 0;
      return {
        ...prev,
        preview: next,
        limitCount: Math.max(0, prev.limitCount - limitDelta),
        dcaCount: Math.max(0, prev.dcaCount - dcaDelta),
        totalCount: Math.max(0, prev.totalCount - 1),
      };
    });
  };

  const cancelOrder = useCallback(
    async (order: OpenOrderSummary) => {
      if (!publicKey || !signTransaction) return;
      setBusyId(order.id);
      try {
        const wallet = publicKey.toBase58();
        let built: any;
        if (order.kind === "limit") {
          built = await supaPost("limit-order-manage", {
            action: "cancel",
            maker: wallet,
            order: order.id,
          });
        } else {
          built = await supaPost("recurring-cancel", {
            user: wallet,
            order: order.id,
            recurringType: "time",
          });
        }
        const txB64: string = built?.transaction;
        const requestId: string = built?.requestId;
        if (!txB64 || !requestId) throw new Error("No cancel transaction returned");

        const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(txBytes);
        const signed = await signTransaction(tx);
        const signedB64 = btoa(String.fromCharCode(...signed.serialize()));

        if (order.kind === "limit") {
          await supaPost("limit-order-execute", {
            requestId,
            signedTransaction: signedB64,
          });
        } else {
          await supaPost("recurring-execute", {
            requestId,
            signedTransaction: signedB64,
          });
        }
        toast({
          title: "Order cancelled",
          description: `${order.inSymbol} → ${order.outSymbol}`,
        });
        removeOrderLocal(order.id);
      } catch (e) {
        toast({
          title: "Couldn't cancel",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setBusyId(null);
      }
    },
    [publicKey, signTransaction],
  );

  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  if (data.totalCount === 0) {
    return (
      <div className="ease-vision animate-fade-up rounded-2xl border border-dashed border-border/60 bg-card/30 p-5 text-center">
        <p className="font-mono text-[12px] text-muted-foreground">
          No open orders right now.
        </p>
        <Link
          to="/trade?tab=limit"
          className="mt-2 inline-block font-mono text-[11px] text-primary hover:underline"
        >
          Place one in Trade →
        </Link>
      </div>
    );
  }

  return (
    <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
        <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
          Open orders ({data.totalCount})
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {data.limitCount} limit · {data.dcaCount} DCA
        </span>
      </div>

      <div className="divide-y divide-border/40">
        {data.preview.map((o) => (
          <OrderRow
            key={o.id}
            order={o}
            cancelling={busyId === o.id}
            disabled={!connected}
            onCancel={() => cancelOrder(o)}
          />
        ))}
      </div>

      <div className="border-t border-border/40 bg-secondary/30 px-5 py-3 text-center">
        <Link
          to="/trade?tab=limit"
          className="font-mono text-[11px] text-primary hover:underline"
        >
          Manage all orders in Trade →
        </Link>
      </div>
    </div>
  );
};

const OrderRow = ({
  order,
  cancelling,
  disabled,
  onCancel,
}: {
  order: OpenOrderSummary;
  cancelling: boolean;
  disabled: boolean;
  onCancel: () => void;
}) => {
  const isDca = order.kind === "dca";
  const expiry = isDca
    ? fmtCountdown(order.nextCycleAt)
    : fmtCountdown(order.expiresAt);
  const expiryLabel = isDca ? "Next cycle" : "Expires";
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="relative shrink-0">
        <TokenLogo logo={order.inLogo} symbol={order.inSymbol} size={28} />
        <div className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-card">
          <TokenLogo logo={order.outLogo} symbol={order.outSymbol} size={18} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate font-mono text-[12px] text-foreground">
            {isDca ? (
              <>
                {fmtAmount(order.perCycleAmount ?? 0)} {order.inSymbol}{" "}
                <span className="text-muted-foreground">→</span> {order.outSymbol}
              </>
            ) : (
              <>
                <span className="text-muted-foreground">Sell</span>{" "}
                {fmtAmount(order.inAmount)} {order.inSymbol}{" "}
                <span className="text-muted-foreground">→</span>{" "}
                {fmtAmount(order.outAmount ?? 0)} {order.outSymbol}
              </>
            )}
          </p>
          <span className="rounded-full border border-border/60 bg-secondary/50 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            {isDca ? "DCA" : "Limit"}
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          {isDca ? <Repeat className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
          {expiryLabel}: {expiry}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onCancel}
        disabled={cancelling || disabled}
        title={disabled ? "Connect wallet to cancel" : "Cancel order"}
        className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        {cancelling ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <X className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
};
