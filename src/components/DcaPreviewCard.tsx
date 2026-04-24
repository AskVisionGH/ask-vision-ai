import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Repeat,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { TokenLogo } from "@/components/TokenLogo";
import { cn } from "@/lib/utils";
import {
  fmtAmount,
  fmtDuration,
  fmtUsd,
  supaPost,
  truncSig,
} from "@/lib/chat-trade-utils";
import type { DcaQuoteData } from "@/lib/chat-stream";

interface Props {
  data: DcaQuoteData;
}

type Phase =
  | { name: "preview" }
  | { name: "preparing" }
  | { name: "awaiting_fee_signature" }
  | { name: "submitting_fee" }
  | { name: "awaiting_signature" }
  | { name: "submitting" }
  | { name: "success"; signature: string | null }
  | { name: "error"; message: string };

export const DcaPreviewCard = ({ data }: Props) => {
  const [phase, setPhase] = useState<Phase>({ name: "preview" });
  const [dismissed, setDismissed] = useState(false);
  const mounted = useRef(true);

  const { publicKey, connected, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();

  const placeDca = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction) return;
    try {
      setPhase({ name: "preparing" });
      const inAtomic = Math.floor(
        data.totalAmountUi * Math.pow(10, data.input.decimals),
      );
      if (inAtomic <= 0) throw new Error("Amount too small");

      // Step 1: 1% upfront platform fee
      const feeBuilt = await supaPost("dca-fee-build", {
        user: publicKey.toBase58(),
        inputMint: data.input.address,
        totalAmountAtomic: String(inAtomic),
        decimals: data.input.decimals,
      });
      const feeTxB64: string = feeBuilt?.transaction;
      if (!feeTxB64) throw new Error("Fee build failed");

      setPhase({ name: "awaiting_fee_signature" });
      const feeBytes = Uint8Array.from(atob(feeTxB64), (c) => c.charCodeAt(0));
      const feeTx = Transaction.from(feeBytes);
      let signedFee: Transaction;
      try {
        signedFee = await signTransaction(feeTx);
      } catch {
        if (mounted.current) {
          setPhase({ name: "error", message: "Cancelled — try again." });
        }
        return;
      }
      const signedFeeB64 = btoa(
        String.fromCharCode(
          ...signedFee.serialize({ requireAllSignatures: true }),
        ),
      );

      setPhase({ name: "submitting_fee" });
      await supaPost("tx-submit", {
        signedTransaction: signedFeeB64,
        kind: "transfer",
        inputMint: data.input.address,
        recipient: "treasury",
        walletAddress: publicKey.toBase58(),
        metadata: { source: "chat_dca_platform_fee" },
      });

      // Step 2: build the recurring create transaction
      const created = await supaPost("recurring-create", {
        user: publicKey.toBase58(),
        inputMint: data.input.address,
        outputMint: data.output.address,
        inAmount: String(inAtomic),
        numberOfOrders: data.numberOfOrders,
        interval: data.intervalSeconds,
        minPriceUsd: data.minPriceUsd,
        maxPriceUsd: data.maxPriceUsd,
      });
      const txB64: string = created.transaction;
      const requestId: string = created.requestId;
      if (!txB64 || !requestId) throw new Error("Create order failed");

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
      const signedB64 = btoa(String.fromCharCode(...signed.serialize()));

      setPhase({ name: "submitting" });
      const executed = await supaPost("recurring-execute", {
        signedTransaction: signedB64,
        requestId,
      });
      const sig = executed?.signature ?? executed?.txSignature ?? null;
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

  if (phase.name === "success") {
    return (
      <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-up/30 bg-up/5 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-up" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] text-foreground">
              DCA started — {fmtAmount(data.perOrderUi)} {data.input.symbol} →{" "}
              {data.output.symbol} every {data.intervalLabel}{" "}
              <span className="text-muted-foreground">
                · {data.numberOfOrders} orders
              </span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {phase.signature && (
                <a
                  href={`https://solscan.io/tx/${phase.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ease-vision inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80"
                >
                  Tx {truncSig(phase.signature)}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
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
    phase.name === "preparing" ||
    phase.name === "awaiting_fee_signature" ||
    phase.name === "submitting_fee" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting";
  const busyLabel =
    phase.name === "preparing"
      ? "Preparing fee…"
      : phase.name === "awaiting_fee_signature"
        ? "Approve 1% fee…"
        : phase.name === "submitting_fee"
          ? "Sending fee…"
          : phase.name === "awaiting_signature"
            ? "Approve DCA in wallet…"
            : phase.name === "submitting"
              ? "Submitting DCA…"
              : "";
  const isError = phase.name === "error";
  const errorMsg = isError ? (phase as Extract<Phase, { name: "error" }>).message : "";

  return (
    <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
        <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
          DCA preview
        </span>
        {isBusy && (
          <div className="flex items-center gap-2 font-mono text-[10px] text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{busyLabel}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-5">
        <div className="min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Total spend
          </span>
          <div className="mt-1 flex items-center gap-2">
            <TokenLogo logo={data.input.logo} symbol={data.input.symbol} size={20} />
            <span className="truncate font-mono text-base text-foreground">
              {fmtAmount(data.totalAmountUi)} {data.input.symbol}
            </span>
          </div>
          {data.totalUsd != null && (
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              ≈ {fmtUsd(data.totalUsd)}
            </div>
          )}
        </div>
        <Repeat className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 text-right">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Buying
          </span>
          <div className="mt-1 flex items-center justify-end gap-2">
            <span className="truncate font-mono text-base text-foreground">
              {data.output.symbol}
            </span>
            <TokenLogo logo={data.output.logo} symbol={data.output.symbol} size={20} />
          </div>
        </div>
      </div>

      <div className="border-t border-border/40 px-5 py-3">
        <Row
          label="Per order"
          value={
            <span className="font-mono text-[13px] text-foreground">
              {fmtAmount(data.perOrderUi)} {data.input.symbol}
              {data.perOrderUsd != null && (
                <span className="ml-1 text-muted-foreground">
                  (≈ {fmtUsd(data.perOrderUsd)})
                </span>
              )}
            </span>
          }
        />
        <Row
          label="Frequency"
          value={
            <span className="flex items-center gap-1 font-mono text-[13px] text-foreground">
              <Clock className="h-3 w-3 text-muted-foreground" />
              Every {data.intervalLabel}
            </span>
          }
        />
        <Row
          label="Orders"
          value={
            <span className="font-mono text-[13px] text-foreground">
              {data.numberOfOrders}{" "}
              <span className="text-muted-foreground">
                · runs for {fmtDuration(data.totalDurationSeconds)}
              </span>
            </span>
          }
        />
        {(data.minPriceUsd != null || data.maxPriceUsd != null) && (
          <Row
            label="Price guards"
            value={
              <span className="font-mono text-[13px] text-foreground">
                {data.minPriceUsd != null ? fmtUsd(data.minPriceUsd) : "—"}
                {" → "}
                {data.maxPriceUsd != null ? fmtUsd(data.maxPriceUsd) : "—"}
              </span>
            }
          />
        )}
        <Row
          label="Platform fee"
          value={
            <span className="font-mono text-[13px] text-muted-foreground">
              1% upfront (one extra signature)
            </span>
          }
        />
      </div>

      {isError && (
        <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
          <p className="font-mono text-[11px] leading-relaxed text-destructive">{errorMsg}</p>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border/40 bg-secondary/30 px-5 py-3">
        {!connected ? (
          <Button
            onClick={() => setVisible(true)}
            className="ease-vision flex-1 font-mono text-[11px] tracking-wider uppercase"
          >
            Connect wallet
          </Button>
        ) : (
          <Button
            onClick={isError ? () => setPhase({ name: "preview" }) : placeDca}
            disabled={isBusy}
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
              "Start DCA"
            )}
          </Button>
        )}
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

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between py-1">
    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {label}
    </span>
    <div>{value}</div>
  </div>
);
