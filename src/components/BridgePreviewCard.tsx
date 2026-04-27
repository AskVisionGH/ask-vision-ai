import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Info,
  XCircle,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAccount } from "wagmi";
import { VersionedTransaction } from "@solana/web3.js";
import type { Hex } from "viem";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/TokenLogo";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import type { BridgeQuoteData, BridgeTokenSide } from "@/lib/chat-stream";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { useVisionWalletSigner } from "@/hooks/useVisionWalletSigner";
import { useEvmBridge } from "@/hooks/useEvmBridge";
import {
  WalletSourcePicker,
  type WalletSource,
} from "@/components/trade/WalletSourcePicker";

const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

interface Props {
  data: BridgeQuoteData;
}

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

type Phase =
  | { name: "preview" }
  | { name: "building" }
  | { name: "switching_chain" }
  | { name: "approving" }
  | { name: "awaiting_signature" }
  | { name: "submitting" }
  | {
      name: "bridging";
      signature: string;
      sourceExplorer: string;
      startedAt: number;
      estimatedSec: number | null;
    }
  | {
      name: "success";
      signature: string;
      sourceExplorer: string;
      durationMs: number;
      toAmountUi: number;
      destExplorer: string | null;
    }
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
const truncAddr = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
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
        } catch {
          /* ignore */
        }
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
  if (data && typeof data === "object" && "error" in (data as any) && (data as any).error) {
    throw new Error((data as any).error);
  }
  return data;
};

const supaGet = async (fn: string, params: Record<string, string>): Promise<any> => {
  const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const resp = await fetch(url.toString(), {
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
  });
  const data = await resp.json();
  if (data?.error && resp.status >= 400) throw new Error(data.error);
  return data;
};

export const BridgePreviewCard = ({ data }: Props) => {
  const [phase, setPhase] = useState<Phase>({ name: "preview" });
  const [dismissed, setDismissed] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [walletSource, setWalletSource] = useState<WalletSource>("vision");
  const mounted = useRef(true);

  const { publicKey, signTransaction, connected: solConnected } = useWallet();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const visionWallet = useVisionWallet();
  const visionSigner = useVisionWalletSigner();
  const { sendBridgeTx } = useEvmBridge();

  const fromIsEvm = data.fromChain?.chainType === "EVM";
  const fromIsSvm =
    data.fromChain?.chainType === "SVM" || data.fromChain?.chainType === "Solana";

  const externalReady = fromIsEvm
    ? Boolean(evmConnected && evmAddress)
    : Boolean(solConnected && publicKey && signTransaction);
  const visionReady = fromIsEvm
    ? Boolean(visionWallet.evmAddress)
    : Boolean(visionWallet.solanaAddress);

  // Vision Wallet doesn't yet drive EVM-source bridges — auto-flip to external.
  useEffect(() => {
    if (fromIsEvm && walletSource === "vision") setWalletSource("external");
  }, [fromIsEvm, walletSource]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (phase.name !== "bridging") return;
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [phase.name]);

  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  if (dismissed) return null;

  const activeReady = walletSource === "vision" ? visionReady : externalReady;

  const pollUntilDone = async (
    signature: string,
    sourceExplorer: string,
    startedAt: number,
  ) => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!mounted.current) return;
      await sleep(POLL_INTERVAL_MS);
      try {
        const status = await supaGet("bridge-status", {
          txHash: signature,
          fromChain: String(data.fromChain.id),
          toChain: String(data.toChain.id),
          bridge: data.tool ?? "",
        });
        if (status.status === "DONE") {
          const recv = status.receiving;
          const destAmountUi =
            recv?.amount && data.toToken.decimals != null
              ? Number(recv.amount) / Math.pow(10, data.toToken.decimals)
              : data.toToken.amountUi;
          const destExplorer = recv?.txLink ?? null;
          if (!mounted.current) return;
          setPhase({
            name: "success",
            signature,
            sourceExplorer,
            durationMs: Date.now() - startedAt,
            toAmountUi: destAmountUi,
            destExplorer,
          });
          return;
        }
        if (status.status === "FAILED" || status.status === "INVALID") {
          throw new Error(status.substatus ?? "Bridge failed on-chain");
        }
      } catch {
        continue;
      }
    }
    throw new Error(
      "Bridge is taking longer than expected. You can keep tracking it from the source transaction.",
    );
  };

  const handleConfirm = async () => {
    if (!activeReady) {
      setPhase({
        name: "error",
        message:
          walletSource === "vision"
            ? "Create your Vision Wallet first."
            : fromIsEvm
              ? "Connect an EVM wallet to sign."
              : "Connect a Solana wallet to sign.",
      });
      return;
    }

    const startedAt = Date.now();
    try {
      setPhase({ name: "building" });
      const built = await supaPost("bridge-build", { quote: data.raw });

      // ============ EVM source path (external only) ============
      if (fromIsEvm) {
        if (walletSource === "vision") {
          throw new Error(
            "Bridging from EVM with Vision Wallet is coming soon. Switch to External wallet for now.",
          );
        }
        const txReq = built.transactionRequest;
        if (!txReq?.to || !txReq?.data) {
          throw new Error("Bridge route returned no EVM transaction.");
        }
        const approvalAddress: string | null =
          data.raw?.estimate?.approvalAddress ?? built.step?.estimate?.approvalAddress ?? null;
        const fromAmountAtomic =
          data.fromToken.amountAtomic ??
          (data.fromToken.decimals != null
            ? BigInt(
                Math.round(data.fromToken.amountUi * Math.pow(10, data.fromToken.decimals)),
              ).toString()
            : "0");

        let sourceTxHash: Hex;
        try {
          sourceTxHash = await sendBridgeTx({
            fromChainId: Number(data.fromChain.id),
            fromTokenAddress: data.fromToken.address,
            fromAmount: fromAmountAtomic,
            approvalAddress,
            txRequest: txReq,
            onStatus: (s) => {
              if (!mounted.current) return;
              if (s === "switching") setPhase({ name: "switching_chain" });
              else if (s === "approving") setPhase({ name: "approving" });
              else if (s === "signing") setPhase({ name: "awaiting_signature" });
              else if (s === "confirming") setPhase({ name: "submitting" });
            },
          });
        } catch (e: any) {
          const msg = String(e?.message ?? "").toLowerCase();
          if (msg.includes("user rejected") || msg.includes("denied") || msg.includes("rejected")) {
            if (mounted.current) {
              setPhase({
                name: "error",
                message: "Cancelled — try again or adjust the amount.",
                cancelled: true,
              });
            }
            return;
          }
          throw e;
        }

        const sourceExplorer = buildEvmExplorer(Number(data.fromChain.id), sourceTxHash);
        setPhase({
          name: "bridging",
          signature: sourceTxHash,
          sourceExplorer,
          startedAt,
          estimatedSec: data.executionDurationSec ?? null,
        });
        await pollUntilDone(sourceTxHash, sourceExplorer, startedAt);
        return;
      }

      // ============ Solana source path ============
      const txB64: string | null =
        built.solanaTransaction ?? built.transactionRequest?.data ?? null;
      if (!txB64) throw new Error("Bridge route returned no Solana transaction");

      let signature: string;

      if (walletSource === "vision") {
        if (!visionWallet.solanaAddress) {
          throw new Error("Create your Vision Wallet first.");
        }
        setPhase({ name: "awaiting_signature" });
        const result = await visionSigner.signAndSend({
          chain: "solana",
          caip2: SOLANA_CAIP2,
          transaction: txB64,
          method: "signAndSendTransaction",
        });
        if (!result.hash) throw new Error("No signature returned from Vision Wallet");
        signature = result.hash;
      } else {
        if (!signTransaction || !publicKey) {
          throw new Error("Connect your Solana wallet first.");
        }
        setPhase({ name: "awaiting_signature" });
        const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(txBytes);
        let signed: VersionedTransaction;
        try {
          signed = await signTransaction(tx);
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
        const signedB64 = btoa(String.fromCharCode(...signed.serialize()));
        const submitted = await supaPost("tx-submit", {
          signedTransaction: signedB64,
          kind: "bridge",
          valueUsd: data.fromAmountUsd ?? data.toAmountUsd ?? null,
          inputMint: data.fromToken.address,
          outputMint: data.toToken.address,
          inputAmount: data.fromToken.amountUi,
          outputAmount: data.toToken.amountUi,
          walletAddress: publicKey.toBase58(),
        });
        const sig = submitted.signature as string;
        if (!sig) throw new Error("No signature returned from submit");
        signature = sig;
      }

      const sourceExplorer = `https://solscan.io/tx/${signature}`;
      setPhase({
        name: "bridging",
        signature,
        sourceExplorer,
        startedAt,
        estimatedSec: data.executionDurationSec ?? null,
      });
      await pollUntilDone(signature, sourceExplorer, startedAt);
    } catch (e) {
      if (!mounted.current) return;
      const message = e instanceof Error ? e.message : "Something went wrong.";
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
        setPhase({ name: "error", message: "Cancelled — try again or adjust the amount.", cancelled: true });
      } else {
        setPhase({ name: "error", message });
      }
    }
  };

  if (phase.name === "success") {
    return (
      <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-up/30 bg-up/5 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-up" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] text-foreground">
              Bridged{" "}
              <span className="font-medium">
                {fmtAmount(data.fromToken.amountUi)} {data.fromToken.symbol}
              </span>{" "}
              <span className="text-muted-foreground">on {data.fromChain.name}</span>
              {" → "}
              <span className="font-medium">
                {fmtAmount(phase.toAmountUi)} {data.toToken.symbol}
              </span>{" "}
              <span className="text-muted-foreground">on {data.toChain.name}</span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Completed in {(phase.durationMs / 1000).toFixed(0)}s</span>
              <a
                href={phase.sourceExplorer}
                target="_blank"
                rel="noopener noreferrer"
                className="ease-vision inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80"
              >
                Source {truncSig(phase.signature)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
              {phase.destExplorer && (
                <a
                  href={phase.destExplorer}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ease-vision inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80"
                >
                  Destination tx
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isBusy =
    phase.name === "building" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting" ||
    phase.name === "bridging";
  const isError = phase.name === "error";
  const errorMsg = isError ? (phase as Extract<Phase, { name: "error" }>).message : "";
  const isCancelled = isError && (phase as Extract<Phase, { name: "error" }>).cancelled === true;

  const busyLabel =
    phase.name === "building"
      ? "Building transaction…"
      : phase.name === "awaiting_signature"
        ? "Approve in wallet…"
        : phase.name === "submitting"
          ? "Submitting on Solana…"
          : phase.name === "bridging"
            ? bridgingLabel(phase, nowTick)
            : "";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
        <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-3">
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Bridge preview
          </span>
          {isBusy && (
            <div className="flex items-center gap-2 font-mono text-[10px] text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{busyLabel}</span>
            </div>
          )}
          {phase.name === "preview" && data.toolName && (
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
              via {data.toolName}
            </div>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-5">
          <BridgeSide
            chain={data.fromChain}
            token={data.fromToken}
            align="left"
          />
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <BridgeSide
            chain={data.toChain}
            token={data.toToken}
            align="right"
            approx
          />
        </div>

        <div className="border-t border-border/40 px-5 py-3">
          <Row
            label="Route"
            value={
              <span className="font-mono text-[13px] text-foreground">
                {data.fromChain.name} → {data.toChain.name}{" "}
                {data.toolName && (
                  <span className="text-muted-foreground">via {data.toolName}</span>
                )}
              </span>
            }
          />
          {data.executionDurationSec != null && (
            <Row
              label="Est. time"
              value={
                <span className="font-mono text-[13px] text-foreground">
                  ~{Math.max(1, Math.round(data.executionDurationSec / 60))} min
                </span>
              }
            />
          )}
          <Row
            label="Slippage"
            value={
              <span className="font-mono text-[13px] text-foreground">
                {(data.slippageBps / 100).toFixed(2)}%
              </span>
            }
          />
          {data.toToken.amountMinUi != null && (
            <Row
              label="Min received"
              value={
                <span className="font-mono text-[13px] text-foreground">
                  {fmtAmount(data.toToken.amountMinUi)} {data.toToken.symbol}
                </span>
              }
            />
          )}
          {data.gasFeeUsd != null && (
            <Row
              label="Gas fee"
              value={
                <span className="font-mono text-[13px] text-muted-foreground">
                  ~{fmtUsd(data.gasFeeUsd)}
                </span>
              }
            />
          )}
          {(() => {
            // LI.FI sometimes returns the integrator fee itemized in feeCosts
            // and sometimes (e.g. NearIntents routes) bakes it into the rate
            // without breaking it out. Mirror the Trade tab's behaviour:
            // fall back to 1% of the input USD so users always see the cut.
            const feeUsd =
              data.platformFeeUsd != null && data.platformFeeUsd > 0
                ? data.platformFeeUsd
                : data.fromAmountUsd != null
                  ? data.fromAmountUsd * 0.01
                  : null;
            if (feeUsd == null || feeUsd <= 0) return null;
            const isEstimated = data.platformFeeUsd == null || data.platformFeeUsd <= 0;
            return (
              <Row
                label="Platform fee"
                value={
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[13px] text-foreground">
                      {isEstimated ? "~" : ""}{fmtUsd(feeUsd)}
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
                          Vision charges a 1% integrator fee on bridges, paid in
                          the source token through LI.FI.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                }
              />
            );
          })()}
          <Row
            label="Destination"
            value={
              <span className="font-mono text-[13px] text-foreground">
                {truncAddr(data.toAddress)}
                {data.sameFamily && (
                  <span className="ml-1.5 text-muted-foreground">(your wallet)</span>
                )}
              </span>
            }
          />
        </div>

        {phase.name === "preview" && (
          <div className="border-t border-border/40 px-5 py-4">
            <WalletSourcePicker
              value={walletSource}
              onChange={setWalletSource}
              visionAvailable={visionReady}
              externalAvailable={externalReady}
            />
            {fromIsEvm && (
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                Vision Wallet doesn't yet support EVM-source bridges — using your external EVM wallet.
              </p>
            )}
          </div>
        )}

        {isError && isCancelled && (
          <div className="flex items-start gap-2 border-t border-border/60 bg-muted/30 px-5 py-3">
            <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <p className="font-mono text-[11px] font-medium leading-relaxed text-foreground">
                Bridge cancelled
              </p>
              <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                You rejected the request in your wallet. No funds were moved.
              </p>
            </div>
          </div>
        )}
        {isError && !isCancelled && (
          <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
            <p className="font-mono text-[11px] leading-relaxed text-destructive">
              {errorMsg}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-border/40 bg-secondary/30 px-5 py-3">
          {!activeReady ? (
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
              <TooltipContent side="top">
                {walletSource === "vision"
                  ? "Create your Vision Wallet to sign."
                  : fromIsEvm
                    ? "Connect an EVM wallet to sign."
                    : "Connect a Solana wallet to sign."}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              onClick={isError ? () => setPhase({ name: "preview" }) : handleConfirm}
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
            onClick={() => setDismissed(true)}
            className="ease-vision font-mono text-[11px] tracking-wider uppercase"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
};

function bridgingLabel(
  phase: Extract<Phase, { name: "bridging" }>,
  now: number,
): string {
  const elapsed = Math.max(0, Math.floor((now - phase.startedAt) / 1000));
  if (phase.estimatedSec != null) {
    const remaining = Math.max(0, phase.estimatedSec - elapsed);
    return `Bridging… ~${remaining}s left`;
  }
  return `Bridging… ${elapsed}s elapsed`;
}

interface BridgeSideProps {
  chain: BridgeQuoteData["fromChain"];
  token: BridgeTokenSide;
  align: "left" | "right";
  approx?: boolean;
}

const BridgeSide = ({ chain, token, align, approx }: BridgeSideProps) => (
  <div className={cn("flex flex-col gap-1.5", align === "right" && "items-end text-right")}>
    <div className={cn("flex items-center gap-2", align === "right" && "flex-row-reverse")}>
      <TokenLogo logo={token.logo} symbol={token.symbol} size={32} />
      <div className={cn("flex min-w-0 flex-col", align === "right" && "items-end")}>
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {chain.name}
        </span>
        <span className="font-mono text-[14px] font-medium text-foreground">
          {token.symbol}
        </span>
      </div>
    </div>
    <div className={cn("flex flex-col", align === "right" && "items-end")}>
      <span className="font-mono text-[15px] text-foreground">
        {approx && "~"}
        {fmtAmount(token.amountUi)}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">
        {fmtUsd(approx ? null : token.priceUsd != null ? token.priceUsd * token.amountUi : null)}
      </span>
    </div>
  </div>
);

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between py-1">
    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {label}
    </span>
    {value}
  </div>
);
