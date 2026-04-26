import { useEffect, useRef, useState } from "react";
import { ArrowRight, RefreshCw, Loader2, CheckCircle2, ExternalLink, AlertCircle, Info, XCircle } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/TokenLogo";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import type { SwapQuoteData } from "@/lib/chat-stream";

interface Props {
  data: SwapQuoteData;
}

const REFRESH_MS = 15000;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60000;

type Phase =
  | { name: "preview" }
  | { name: "building" }
  | { name: "awaiting_signature" }
  | { name: "submitting"; signature?: string }
  | { name: "confirming"; signature: string; startedAt: number }
  | { name: "success"; signature: string; durationMs: number; finalOutUi: number }
  | { name: "error"; message: string; cancelled?: boolean };

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toExponential(2)}`;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
};

const fmtAmount = (n: number) => {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.000001) return n.toExponential(3);
  if (Math.abs(n) < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (Math.abs(n) < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const truncSig = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

const impactBucket = (pct: number | null) => {
  if (pct == null) return { label: "—", color: "text-muted-foreground", dot: "bg-muted-foreground" };
  const a = Math.abs(pct);
  if (a < 1) return { label: "low", color: "text-up", dot: "bg-up" };
  if (a < 3) return { label: "medium", color: "text-amber-400", dot: "bg-amber-400" };
  return { label: "high", color: "text-down", dot: "bg-down" };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const supaPost = async (fn: string, body: unknown, attempt = 0): Promise<any> => {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as any).context;
    let serverMsg: string | null = null;
    let status: number | undefined;
    if (ctx) {
      status = ctx.status;
      if (typeof ctx.json === "function") {
        try {
          const parsed = await ctx.json();
          if (parsed?.error) serverMsg = String(parsed.error);
        } catch { /* body wasn't JSON */ }
      }
    }
    const message = serverMsg ?? error.message ?? `${fn} failed`;
    const transient =
      status === 503 ||
      status === 504 ||
      message.toLowerCase().includes("temporarily unavailable") ||
      message.toLowerCase().includes("runtime_error");
    if (transient && attempt < 2) {
      await sleep(400 * (attempt + 1));
      return supaPost(fn, body, attempt + 1);
    }
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in (data as any) && (data as any).error && !(data as any).fallback) {
    throw new Error((data as any).error);
  }
  return data;
};

export const SwapPreviewCard = ({ data: initial }: Props) => {
  const [data, setData] = useState<SwapQuoteData>(initial);
  const [phase, setPhase] = useState<Phase>({ name: "preview" });
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mounted = useRef(true);
  const { publicKey, signTransaction, connected } = useWallet();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Auto-refresh quote — paused once user starts confirming
  useEffect(() => {
    if (data.error || dismissed || phase.name !== "preview") return;
    const timer = setInterval(async () => {
      if (!mounted.current) return;
      setRefreshing(true);
      try {
        const fresh = await supaPost("swap-quote", {
          inputToken: data.input.address,
          outputToken: data.output.address,
          amount: data.input.amountUi,
          slippageBps: data.slippageBps,
          dynamicSlippage: data.dynamicSlippage !== false,
        });
        if (mounted.current && !fresh.error) setData(fresh);
      } catch {
        /* silent — keep last good quote */
      } finally {
        if (mounted.current) setRefreshing(false);
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [data.error, dismissed, phase.name, data.input.address, data.output.address, data.input.amountUi, data.slippageBps]);

  const handleConfirm = async () => {
    if (!connected || !publicKey || !signTransaction) {
      setPhase({ name: "error", message: "Connect a wallet that supports signing." });
      return;
    }

    let signature: string | undefined;
    const startedAt = Date.now();

    try {
      // 1. Build (may also return an upfront fee tx for Token-2022 outputs)
      setPhase({ name: "building" });
      const built = await supaPost("swap-build", {
        userPublicKey: publicKey.toBase58(),
        inputMint: data.input.address,
        outputMint: data.output.address,
        amount: data.input.amountAtomic,
        slippageBps: data.slippageBps,
        dynamicSlippage: data.dynamicSlippage !== false,
      });
      if (!built.swapTransaction) throw new Error("No transaction returned");

      // 1b. If an upfront fee tx is required (Token-2022 output), sign+submit
      // it FIRST. We confirm it before kicking off the swap so the swap
      // sees the reduced balance and doesn't fail on insufficient funds.
      if (built.feeTransaction) {
        setPhase({ name: "awaiting_signature" });
        const feeBytes = Uint8Array.from(atob(built.feeTransaction), (c) => c.charCodeAt(0));
        // Legacy Transaction (built server-side) — wallet adapters accept both.
        const { Transaction } = await import("@solana/web3.js");
        const feeTx = Transaction.from(feeBytes);
        let signedFee: any;
        try {
          signedFee = await signTransaction(feeTx as any);
        } catch {
          if (mounted.current) {
            setPhase({
              name: "error",
              message: "Cancelled — try again or adjust the amount.",
              cancelled: true,
            });
          }
          return;
        }
        setPhase({ name: "submitting" });
        const feeSignedB64 = btoa(String.fromCharCode(...signedFee.serialize()));
        const feeSubmitted = await supaPost("tx-submit", {
          signedTransaction: feeSignedB64,
          kind: "transfer",
          valueUsd: data.platformFee?.valueUsd ?? null,
          inputMint: data.input.address,
          inputAmount: data.platformFee?.amountUi ?? null,
          walletAddress: publicKey.toBase58(),
          // Tag so treasury-fees-sync picks this up as platform revenue.
          metadata: {
            kind: "swap_upfront_fee",
            platform_fee: true,
            symbol: data.platformFee?.symbol ?? data.input.symbol,
            feeAmount: data.platformFee?.amountUi ?? null,
            outputMint: data.output.address,
            outputSymbol: data.output.symbol,
          },
        });
        const feeSig = feeSubmitted?.signature as string | undefined;
        if (!feeSig) throw new Error("Failed to submit platform fee transaction");
        // Wait for fee confirmation before the swap
        const feeDeadline = Date.now() + POLL_TIMEOUT_MS;
        let feeConfirmed = false;
        while (Date.now() < feeDeadline) {
          if (!mounted.current) return;
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          try {
            const status = await supaPost("tx-status", { signature: feeSig });
            if (status.status === "confirmed") { feeConfirmed = true; break; }
            if (status.status === "failed") throw new Error(status.err ?? "Fee transfer failed");
          } catch { continue; }
        }
        if (!feeConfirmed) throw new Error("Platform fee confirmation timed out");
      }

      // 2. Deserialize + sign the swap
      setPhase({ name: "awaiting_signature" });
      const txBytes = Uint8Array.from(atob(built.swapTransaction), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);

      let signed: VersionedTransaction;
      try {
        signed = await signTransaction(tx);
      } catch (e) {
        // User rejected
        if (mounted.current) {
          setPhase({
            name: "error",
            message: "Cancelled — try again or adjust the amount.",
            cancelled: true,
          });
        }
        return;
      }

      // 3. Submit through our Helius-backed edge function. We pass tx
      // metadata so the server can record a row in `tx_events` for the
      // admin Stats panel without exposing the user's wallet privately.
      setPhase({ name: "submitting" });
      const signedB64 = btoa(String.fromCharCode(...signed.serialize()));
      const submitted = await supaPost("tx-submit", {
        signedTransaction: signedB64,
        kind: "swap",
        valueUsd: data.input.valueUsd ?? data.output.valueUsd ?? null,
        inputMint: data.input.address,
        outputMint: data.output.address,
        inputAmount: data.input.amountUi,
        outputAmount: data.output.amountUi,
        walletAddress: publicKey.toBase58(),
      });
      if (submitted?.fallback && submitted?.error) {
        throw new Error(submitted.error as string);
      }
      signature = submitted.signature as string;
      if (!signature) throw new Error("No signature returned from submit");

      // 4. Poll for confirmation
      setPhase({ name: "confirming", signature, startedAt });
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (!mounted.current) return;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const status = await supaPost("tx-status", { signature });
          if (status.status === "confirmed") {
            if (!mounted.current) return;
            // Record the per-user platform fee. Best-effort — never block UX.
            void supaPost("record-swap-fee", {
              signature,
              valueUsd: data.input.valueUsd ?? data.output.valueUsd ?? null,
              feeUsd: data.platformFee?.valueUsd ?? null,
              feeAmountUi: data.platformFee?.amountUi ?? null,
              feeSymbol: data.platformFee?.symbol ?? null,
              feeMint: data.output.address,
              inputMint: data.input.address,
              outputMint: data.output.address,
            }).catch((e) => console.warn("record-swap-fee failed:", e));
            setPhase({
              name: "success",
              signature,
              durationMs: Date.now() - startedAt,
              finalOutUi: data.output.amountUi,
            });
            return;
          }
          if (status.status === "failed") {
            throw new Error(status.err ?? "Transaction failed on-chain");
          }
        } catch (e) {
          // Transient poll error — keep trying
          continue;
        }
      }
      throw new Error("Confirmation timed out. Check Solscan for status.");
    } catch (e) {
      if (!mounted.current) return;
      const message = e instanceof Error ? e.message : "Something went wrong.";
      // Detect wallet rejection patterns from any layer (wallet adapter,
      // wallet-standard, mobile deep-link, etc.) so we always show the
      // friendly "cancelled" banner instead of a red error.
      const lower = message.toLowerCase();
      const isReject =
        lower.includes("user rejected") ||
        lower.includes("user denied") ||
        lower.includes("rejected the request") ||
        lower.includes("request rejected") ||
        lower.includes("declined") ||
        lower.includes("cancelled") ||
        lower.includes("canceled") ||
        (e as { code?: number })?.code === 4001;
      if (isReject) {
        setPhase({
          name: "error",
          message: "Cancelled — try again or adjust the amount.",
          cancelled: true,
        });
      } else {
        setPhase({ name: "error", message });
      }
    }
  };

  const handleRetry = async () => {
    setPhase({ name: "preview" });
    // Force a quote refresh immediately
    setRefreshing(true);
    try {
      const fresh = await supaPost("swap-quote", {
        inputToken: data.input.address,
        outputToken: data.output.address,
        amount: data.input.amountUi,
        slippageBps: data.slippageBps,
        dynamicSlippage: data.dynamicSlippage !== false,
      });
      if (mounted.current && !fresh.error) setData(fresh);
    } catch {
      /* keep previous quote */
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  if (dismissed) return null;

  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  // Success — compact card
  if (phase.name === "success") {
    return (
      <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-up/30 bg-up/5 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-up" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] text-foreground">
              Swapped <span className="font-medium">{fmtAmount(data.input.amountUi)} {data.input.symbol}</span>
              {" → "}
              <span className="font-medium">{fmtAmount(phase.finalOutUi)} {data.output.symbol}</span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Confirmed in {(phase.durationMs / 1000).toFixed(1)}s</span>
              <a
                href={`https://solscan.io/tx/${phase.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ease-vision inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80"
              >
                Tx {truncSig(phase.signature)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const impact = impactBucket(data.priceImpactPct);
  const routeLabels = data.route.length > 0
    ? Array.from(new Set(data.route.map((r) => r.label))).join(" → ")
    : "Direct";

  const isBusy =
    phase.name === "building" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting" ||
    phase.name === "confirming";

  const busyLabel =
    phase.name === "building"
      ? "Building transaction…"
      : phase.name === "awaiting_signature"
        ? "Approve in wallet…"
        : phase.name === "submitting"
          ? "Submitting…"
          : phase.name === "confirming"
            ? "Confirming on-chain…"
            : "";

  const isError = phase.name === "error";
  const errorMsg = isError ? (phase as Extract<Phase, { name: "error" }>).message : "";
  const isCancelled = isError && (phase as Extract<Phase, { name: "error" }>).cancelled === true;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Swap preview
          </span>
          {phase.name === "preview" && (
            <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/70">
              <RefreshCw
                className={cn("h-3 w-3", refreshing && "animate-spin text-primary")}
              />
              <span>refreshes 15s</span>
            </div>
          )}
          {isBusy && (
            <div className="flex items-center gap-2 font-mono text-[10px] text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{busyLabel}</span>
            </div>
          )}
        </div>

        {/* Amounts */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-5">
          <Side side={data.input} align="left" />
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Side side={data.output} align="right" approx />
        </div>

        {/* Stats */}
        <div className="border-t border-border/40 px-5 py-3">
          <Row
            label="Rate"
            value={
              <span className="font-mono text-[13px] text-foreground">
                1 {data.input.symbol} = {fmtAmount(data.rate)} {data.output.symbol}
              </span>
            }
          />
          <Row
            label="Impact"
            value={
              <div className="flex items-center gap-2">
                <span className={cn("font-mono text-[13px]", impact.color)}>
                  {data.priceImpactPct != null ? `${data.priceImpactPct.toFixed(2)}%` : "—"}
                </span>
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className={cn("h-1.5 w-1.5 rounded-full", impact.dot)} />
                  {impact.label}
                </span>
              </div>
            }
          />
          <Row
            label="Slippage"
            value={
              <span className="font-mono text-[13px] text-foreground">
                {data.dynamicSlippage !== false ? (
                  <>
                    Dynamic{" "}
                    <span className="text-muted-foreground">
                      (auto, max {(data.slippageBps / 100).toFixed(2)}%)
                    </span>
                  </>
                ) : (
                  <>
                    {(data.slippageBps / 100).toFixed(2)}%{" "}
                    <span className="text-muted-foreground">(fixed)</span>
                  </>
                )}
              </span>
            }
          />
          <Row
            label="Route"
            value={
              <span className="font-mono text-[13px] text-foreground">
                {data.input.symbol} → {data.output.symbol}{" "}
                <span className="text-muted-foreground">via {routeLabels}</span>
              </span>
            }
          />
          <Row
            label="Network fee"
            value={
              <span className="font-mono text-[13px] text-muted-foreground">
                ~{data.estNetworkFeeSol.toFixed(6)} SOL
              </span>
            }
          />
          {data.platformFee && data.platformFee.bps > 0 && (
            <Row
              label="Platform fee"
              value={
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[13px] text-foreground">
                    {(data.platformFee.bps / 100).toFixed(2)}%
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    (~{fmtAmount(data.platformFee.amountUi)} {data.platformFee.symbol})
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="ease-vision text-muted-foreground/60 transition-colors hover:text-foreground"
                        aria-label="About platform fee"
                      >
                        <Info className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px]">
                      <p className="font-mono text-[11px] leading-relaxed">
                        Vision charges a 1% platform fee on swaps, taken in the output token. Transfers and bridges are free.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              }
            />
          )}
        </div>

        {/* Inline error / cancelled banner */}
        {isError && isCancelled && (
          <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
            <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="font-mono text-[11px] font-medium leading-relaxed text-destructive">
                Swap cancelled
              </p>
              <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-destructive/80">
                No funds were moved. You can retry the swap or delete this card below.
              </p>
            </div>
          </div>
        )}
        {isError && !isCancelled && (
          <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
            <p className="font-mono text-[11px] leading-relaxed text-destructive">{errorMsg}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border/40 bg-secondary/30 px-5 py-3">
          {!connected ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex-1">
                  <Button
                    disabled
                    className="ease-vision w-full font-mono text-[11px] tracking-wider uppercase"
                  >
                    Confirm & sign
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Connect a wallet to sign.</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              onClick={isError ? handleRetry : handleConfirm}
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
                "Confirm & sign"
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={isBusy}
            onClick={() => {
              if (isCancelled) {
                setDismissed(true);
              } else {
                setPhase({
                  name: "error",
                  message: "Cancelled — try again or adjust the amount.",
                  cancelled: true,
                });
              }
            }}
            className="ease-vision font-mono text-[11px] tracking-wider uppercase text-muted-foreground hover:text-foreground"
          >
            {isCancelled ? "Delete" : "Cancel"}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
};

const Side = ({
  side,
  align,
  approx,
}: {
  side: SwapQuoteData["input"];
  align: "left" | "right";
  approx?: boolean;
}) => (
  <div className={cn("flex flex-col gap-1.5", align === "right" && "items-end text-right")}>
    <div className={cn("flex items-center gap-2", align === "right" && "flex-row-reverse")}>
      <TokenLogo logo={side.logo} symbol={side.symbol} size={28} />
      <span className="font-mono text-[11px] text-muted-foreground">${side.symbol}</span>
    </div>
    <p className="font-mono text-lg font-light tracking-tight text-foreground">
      {approx && "~"}
      {fmtAmount(side.amountUi)}
    </p>
    <p className="font-mono text-[11px] text-muted-foreground">≈ {fmtUsd(side.valueUsd)}</p>
  </div>
);

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3 py-1.5">
    <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
      {label}
    </span>
    {value}
  </div>
);
