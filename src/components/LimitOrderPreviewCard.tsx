import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { TokenLogo } from "@/components/TokenLogo";
import { cn } from "@/lib/utils";
import {
  fmtAmount,
  fmtRate,
  fmtUsd,
  supaPost,
  truncSig,
} from "@/lib/chat-trade-utils";
import type { LimitOrderQuoteData } from "@/lib/chat-stream";

interface Props {
  data: LimitOrderQuoteData;
}

type Phase =
  | { name: "preview" }
  | { name: "building" }
  | { name: "awaiting_signature" }
  | { name: "submitting" }
  | { name: "success"; signature: string }
  | { name: "error"; message: string };

export const LimitOrderPreviewCard = ({ data }: Props) => {
  const [phase, setPhase] = useState<Phase>({ name: "preview" });
  const [confirmInstantFill, setConfirmInstantFill] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mounted = useRef(true);

  const { publicKey, connected, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();

  const placeOrder = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction) return;
    try {
      setPhase({ name: "building" });

      const makingAtomic = Math.floor(
        data.sellAmountUi * Math.pow(10, data.input.decimals),
      );
      const takingAtomic = Math.floor(
        data.receiveAmountUi * Math.pow(10, data.output.decimals),
      );
      if (makingAtomic <= 0 || takingAtomic <= 0) {
        throw new Error("Amount too small");
      }

      const expiredAt = data.expirySeconds
        ? Math.floor(Date.now() / 1000) + data.expirySeconds
        : null;

      const built = await supaPost("limit-order-build", {
        maker: publicKey.toBase58(),
        inputMint: data.input.address,
        outputMint: data.output.address,
        makingAmount: String(makingAtomic),
        takingAmount: String(takingAtomic),
        expiredAt,
      });
      const requestId = built?.requestId as string;
      const txB64 = built?.transaction as string;
      if (!requestId || !txB64) throw new Error("No transaction returned");

      setPhase({ name: "awaiting_signature" });
      const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);
      let signed: VersionedTransaction;
      try {
        signed = await signTransaction(tx);
      } catch {
        if (mounted.current) {
          setPhase({ name: "error", message: "Cancelled — try again." });
        }
        return;
      }

      setPhase({ name: "submitting" });
      const signedB64 = btoa(String.fromCharCode(...signed.serialize()));
      const exec = await supaPost("limit-order-execute", {
        requestId,
        signedTransaction: signedB64,
      });
      const sig = exec?.signature as string;
      const status = exec?.status as string | null;
      if (!sig) throw new Error(exec?.error || "No signature returned");
      if (status && status.toLowerCase() === "failed") {
        throw new Error(exec?.error || "Order submission failed on-chain");
      }
      if (!mounted.current) return;
      setPhase({ name: "success", signature: sig });
    } catch (e) {
      if (!mounted.current) return;
      setPhase({
        name: "error",
        message: e instanceof Error ? e.message : "Something went wrong.",
      });
    }
  }, [connected, publicKey, signTransaction, data]);

  if (dismissed) return null;

  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  // Success view
  if (phase.name === "success") {
    return (
      <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-up/30 bg-up/5 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-up" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] text-foreground">
              Limit order placed —{" "}
              <span className="font-medium">
                sell {fmtAmount(data.sellAmountUi)} {data.input.symbol}
              </span>{" "}
              when 1 {data.input.symbol} = {fmtRate(data.limitPrice)} {data.output.symbol}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <a
                href={`https://solscan.io/tx/${phase.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ease-vision inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80"
              >
                Tx {truncSig(phase.signature)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
              <Link
                to="/trade?tab=limit"
                className="ease-vision text-primary transition-colors hover:text-primary/80"
              >
                Manage in Trade →
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isBusy =
    phase.name === "building" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting";
  const busyLabel =
    phase.name === "building"
      ? "Building order…"
      : phase.name === "awaiting_signature"
        ? "Approve in wallet…"
        : phase.name === "submitting"
          ? "Submitting…"
          : "";
  const isError = phase.name === "error";
  const errorMsg = isError ? (phase as Extract<Phase, { name: "error" }>).message : "";

  let ctaLabel = "Place limit order";
  let ctaAction: (() => void) | null = placeOrder;
  let ctaDisabled = false;
  if (!connected) {
    ctaLabel = "Connect wallet";
    ctaAction = () => setVisible(true);
  } else if (data.willFillInstantly && !confirmInstantFill) {
    ctaLabel = "Confirm: fills instantly";
    ctaAction = () => setConfirmInstantFill(true);
  } else if (isBusy) {
    ctaLabel = busyLabel;
    ctaDisabled = true;
    ctaAction = null;
  }

  const deltaIcon = data.deltaPct == null
    ? null
    : data.deltaPct >= 0
      ? <TrendingUp className="h-2.5 w-2.5" />
      : <TrendingDown className="h-2.5 w-2.5" />;
  const deltaColor = data.deltaPct == null
    ? "text-muted-foreground"
    : data.deltaPct >= 0
      ? "text-up"
      : "text-down";

  return (
    <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
        <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
          Limit order preview
        </span>
        {isBusy && (
          <div className="flex items-center gap-2 font-mono text-[10px] text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{busyLabel}</span>
          </div>
        )}
      </div>

      {/* Tokens */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-5">
        <Side
          symbol={data.input.symbol}
          logo={data.input.logo}
          amountUi={data.sellAmountUi}
          valueUsd={data.sellValueUsd}
          align="left"
          label="Sell"
        />
        <span className="font-mono text-xs text-muted-foreground">→</span>
        <Side
          symbol={data.output.symbol}
          logo={data.output.logo}
          amountUi={data.receiveAmountUi}
          valueUsd={data.receiveValueUsd}
          align="right"
          label="Receive"
        />
      </div>

      {/* Stats */}
      <div className="border-t border-border/40 px-5 py-3">
        <Row
          label="Limit price"
          value={
            <span className="font-mono text-[13px] text-foreground">
              1 {data.input.symbol} = {fmtRate(data.limitPrice)} {data.output.symbol}
            </span>
          }
        />
        {data.marketPrice != null && (
          <Row
            label="Market"
            value={
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] text-muted-foreground">
                  {fmtRate(data.marketPrice)} {data.output.symbol}
                </span>
                {data.deltaPct != null && (
                  <span className={cn("flex items-center gap-1 font-mono text-[10px]", deltaColor)}>
                    {deltaIcon}
                    {data.deltaPct >= 0 ? "+" : ""}
                    {data.deltaPct.toFixed(2)}%
                  </span>
                )}
              </div>
            }
          />
        )}
        <Row
          label="Expiry"
          value={
            <span className="flex items-center gap-1 font-mono text-[13px] text-foreground">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {data.expiryLabel}
            </span>
          }
        />
        <Row
          label="Platform fee"
          value={
            <span className="font-mono text-[13px] text-muted-foreground">
              1% on fill (paid in {data.output.symbol})
            </span>
          }
        />
      </div>

      {/* Instant-fill warning */}
      {data.willFillInstantly && (
        <div className="flex items-start gap-2 border-t border-amber-500/30 bg-amber-500/5 px-5 py-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
          <p className="font-mono text-[11px] leading-relaxed text-amber-300">
            This price is well below market — the order will fill immediately
            as a market sell. Confirm again to proceed, or update the price.
          </p>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
          <p className="font-mono text-[11px] leading-relaxed text-destructive">{errorMsg}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-border/40 bg-secondary/30 px-5 py-3">
        <Button
          onClick={isError ? () => setPhase({ name: "preview" }) : (ctaAction ?? undefined)}
          disabled={ctaDisabled}
          className="ease-vision flex-1 font-mono text-[11px] tracking-wider uppercase"
        >
          {isBusy ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              {busyLabel}
            </>
          ) : isError ? (
            "Retry"
          ) : (
            ctaLabel
          )}
        </Button>
        <Button
          variant="ghost"
          disabled={isBusy}
          onClick={() => setDismissed(true)}
          className="ease-vision font-mono text-[11px] tracking-wider uppercase text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Button>
      </div>

      <div className="border-t border-border/40 px-5 py-2 text-center">
        <Link
          to="/trade?tab=limit"
          className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
        >
          Open the full Trade view →
        </Link>
      </div>
    </div>
  );
};

const Side = ({
  symbol,
  logo,
  amountUi,
  valueUsd,
  align,
  label,
}: {
  symbol: string;
  logo: string | null;
  amountUi: number;
  valueUsd: number | null;
  align: "left" | "right";
  label: string;
}) => (
  <div className={cn("min-w-0", align === "right" && "text-right")}>
    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {label}
    </span>
    <div
      className={cn(
        "mt-1 flex items-center gap-2",
        align === "right" && "justify-end",
      )}
    >
      {align === "left" && <TokenLogo logo={logo} symbol={symbol} size={20} />}
      <span className="truncate font-mono text-base text-foreground">
        {fmtAmount(amountUi)} {symbol}
      </span>
      {align === "right" && <TokenLogo logo={logo} symbol={symbol} size={20} />}
    </div>
    {valueUsd != null && (
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
        ≈ {fmtUsd(valueUsd)}
      </div>
    )}
  </div>
);

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between py-1">
    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {label}
    </span>
    <div>{value}</div>
  </div>
);
