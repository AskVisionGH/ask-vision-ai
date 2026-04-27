// useRouteExecutor — executes a `route-quote` plan leg-by-leg.
//
// Handles all four shapes the orchestrator returns:
//   1) strategy "swap" + chain SOL    → Jupiter via swap-build (existing path)
//   2) strategy "swap" + chain EVM    → 0x via evm-swap-build (Vision driver or wagmi)
//   3) strategy "bridge"              → LI.FI via bridge-build (Solana or EVM source)
//   4) strategy "bridge_then_swap"    → bridge leg, wait, then destination-chain swap
//
// Vision's 1% platform fee:
//   - SOL swap leg:   baked in via Jupiter feeAccount (swap-build).
//   - EVM swap leg:   baked in via 0x swapFeeBps/swapFeeRecipient (evm-swap-build).
//   - Bridge-only:    LI.FI integrator fee (controlled by LIFI_FEES_ENABLED).
//   - Bridge+swap:    bridge leg fee-less; destination swap leg charges 1%.
//
// The hook is intentionally framework-agnostic (no React state, just callbacks).
// Callers own progress state — most just need `name` + a status callback.

import { useCallback, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useAccount } from "wagmi";
import type { Hex } from "viem";
import { supabase } from "@/integrations/supabase/client";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { useVisionWalletSigner } from "@/hooks/useVisionWalletSigner";
import { useEvmBridge } from "@/hooks/useEvmBridge";
import { useVisionEvmBridge } from "@/hooks/useVisionEvmBridge";
import type { ChainKey, MultichainToken } from "@/components/trade/MultichainTokenPickerDialog";
import type { WalletSource } from "@/components/trade/WalletSourcePicker";
import {
  recordStrandedRoute,
  clearStrandedRoute,
  makeStrandedId,
} from "@/lib/stranded-routes";

const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;
const BRIDGE_POLL_INTERVAL_MS = 4000;
const BRIDGE_POLL_TIMEOUT_MS = 15 * 60 * 1000;

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
        } catch { /* ignore */ }
      }
    }
    const transient =
      status === 503 ||
      status === 504 ||
      (serverMsg ?? error.message ?? "").toLowerCase().includes("temporarily unavailable") ||
      (serverMsg ?? error.message ?? "").toLowerCase().includes("runtime_error");
    if (transient && attempt < 2) {
      await sleep(400 * (attempt + 1));
      return supaPost(fn, body, attempt + 1);
    }
    throw new Error(serverMsg ?? error.message ?? `${fn} failed`);
  }
  if (data && typeof data === "object" && "error" in (data as any) && (data as any).error && !(data as any).fallback) {
    throw new Error((data as any).error);
  }
  return data;
};

const supaGet = async (fn: string, params: Record<string, string>, attempt = 0): Promise<any> => {
  const qs = new URLSearchParams(params).toString();
  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/${fn}?${qs}`;
  try {
    const r = await fetch(url, {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
    });
    if (!r.ok) {
      if ((r.status === 503 || r.status === 504) && attempt < 2) {
        await sleep(400 * (attempt + 1));
        return supaGet(fn, params, attempt + 1);
      }
      throw new Error(`${fn} ${r.status}`);
    }
    return await r.json();
  } catch (e) {
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return supaGet(fn, params, attempt + 1);
    }
    throw e;
  }
};

const isSol = (c: ChainKey) => String(c).toUpperCase() === "SOL";

const EVM_EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io/tx/",
  10: "https://optimistic.etherscan.io/tx/",
  56: "https://bscscan.com/tx/",
  137: "https://polygonscan.com/tx/",
  8453: "https://basescan.org/tx/",
  42161: "https://arbiscan.io/tx/",
  43114: "https://snowtrace.io/tx/",
  59144: "https://lineascan.build/tx/",
  534352: "https://scrollscan.com/tx/",
};
const explorerUrl = (chain: ChainKey, hash: string) =>
  isSol(chain)
    ? `https://solscan.io/tx/${hash}`
    : `${EVM_EXPLORERS[Number(chain)] ?? "https://etherscan.io/tx/"}${hash}`;

// ---- Public types ---------------------------------------------------------

export type ExecutorStatus =
  | { kind: "idle" }
  | { kind: "building"; legIndex: number; legKind: "swap" | "bridge" }
  | { kind: "approving"; legIndex: number; chain: ChainKey; hash?: string }
  | { kind: "switching_chain"; legIndex: number; chain: ChainKey }
  | { kind: "awaiting_signature"; legIndex: number; chain: ChainKey }
  | { kind: "submitting"; legIndex: number; chain: ChainKey }
  | { kind: "confirming"; legIndex: number; chain: ChainKey; hash: string; explorer: string }
  | { kind: "bridging"; hash: string; explorer: string; estimatedSec: number | null }
  | {
      kind: "success";
      legHashes: { chain: ChainKey; hash: string; explorer: string }[];
      finalAmountUi: number;
      finalSymbol: string;
      durationMs: number;
    }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export interface RoutePlan {
  strategy: "swap" | "bridge" | "bridge_then_swap";
  legs: Array<{
    kind: "swap" | "bridge";
    chain: ChainKey;
    quote: any;
  }>;
  summary: {
    fromAmountUi: number;
    fromAmountUsd: number | null;
    toAmountUi: number | null;
    toAmountUsd: number | null;
    gasUsd: number | null;
    platformFeeUsd: number | null;
    executionDurationSec: number | null;
  };
  intermediate?: { address: string; symbol: string; decimals: number; chain: ChainKey };
}

export interface ExecuteParams {
  plan: RoutePlan;
  fromToken: MultichainToken;
  toToken: MultichainToken;
  walletSource: WalletSource;
  /** Source-chain payer address (Vision or external, depending on walletSource). */
  fromAddress: string;
  /** Destination-chain recipient (Vision or external on destination chain). */
  toAddress: string;
  slippageBps: number;
  dynamicSlippage: boolean;
  /** Authed user id — needed so we can scope stranded-route recovery records.
   *  Optional because not every caller (e.g. anonymous chat preview cards) has
   *  one; when missing we just skip persistence. */
  userId?: string | null;
  /**
   * UI-driven status updates. The hook never sets React state — callers
   * decide what to do (modal step, inline label, etc.).
   */
  onStatus: (s: ExecutorStatus) => void;
}

// ---- Hook -----------------------------------------------------------------

export const useRouteExecutor = () => {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const { address: externalEvmAddress } = useAccount();
  const visionWallet = useVisionWallet();
  const visionSigner = useVisionWalletSigner();
  const evmBridge = useEvmBridge();
  const visionEvmBridge = useVisionEvmBridge();
  const cancelled = useRef(false);

  const cancel = useCallback(() => {
    cancelled.current = true;
  }, []);

  const execute = useCallback(
    async (params: ExecuteParams): Promise<void> => {
      cancelled.current = false;
      const { plan, fromToken, toToken, walletSource, fromAddress, toAddress, slippageBps, dynamicSlippage, onStatus } = params;
      const startedAt = Date.now();
      const legHashes: { chain: ChainKey; hash: string; explorer: string }[] = [];

      try {
        if (plan.strategy === "swap") {
          const leg = plan.legs[0];
          const { hash, explorer } = await runSwapLeg({
            legIndex: 0,
            chain: leg.chain,
            quote: leg.quote,
            fromToken,
            toToken,
            walletSource,
            fromAddress,
            slippageBps,
            dynamicSlippage,
            onStatus,
          });
          legHashes.push({ chain: leg.chain, hash, explorer });
          onStatus({
            kind: "success",
            legHashes,
            finalAmountUi: plan.summary.toAmountUi ?? leg.quote.output?.amountUi ?? 0,
            finalSymbol: toToken.symbol,
            durationMs: Date.now() - startedAt,
          });
          return;
        }

        if (plan.strategy === "bridge") {
          const leg = plan.legs[0];
          const { hash, explorer } = await runBridgeLeg({
            legIndex: 0,
            quote: leg.quote,
            fromToken,
            walletSource,
            onStatus,
          });
          legHashes.push({ chain: leg.chain, hash, explorer });
          await pollBridgeUntilDone({
            hash,
            quote: leg.quote,
            explorer,
            estimatedSec: leg.quote.executionDurationSec ?? null,
            onStatus,
          });
          onStatus({
            kind: "success",
            legHashes,
            finalAmountUi: plan.summary.toAmountUi ?? 0,
            finalSymbol: toToken.symbol,
            durationMs: Date.now() - startedAt,
          });
          return;
        }

        // ---- bridge_then_swap ----
        const bridgeLeg = plan.legs[0];
        const swapLeg = plan.legs[1];
        if (!bridgeLeg || !swapLeg || !plan.intermediate) {
          throw new Error("Malformed bridge_then_swap plan");
        }

        // Leg 1 — bridge to USDC (or other intermediate) on destination chain.
        const { hash: bridgeHash, explorer: bridgeExplorer } = await runBridgeLeg({
          legIndex: 0,
          quote: bridgeLeg.quote,
          fromToken,
          walletSource,
          onStatus,
        });
        legHashes.push({ chain: bridgeLeg.chain, hash: bridgeHash, explorer: bridgeExplorer });

        await pollBridgeUntilDone({
          hash: bridgeHash,
          quote: bridgeLeg.quote,
          explorer: bridgeExplorer,
          estimatedSec: bridgeLeg.quote.executionDurationSec ?? null,
          onStatus,
        });

        // Leg 2 — destination-chain swap from intermediate → toToken.
        const intermediate = plan.intermediate;
        const intermediateAmountUi =
          (Number(swapLeg.quote.input?.amountAtomic ?? "0") /
            Math.pow(10, swapLeg.quote.input?.decimals ?? intermediate.decimals)) || 0;

        const fresh = await supaPost("route-quote", {
          fromChain: intermediate.chain,
          toChain: intermediate.chain,
          fromToken: intermediate.address,
          toToken: toToken.address,
          fromAddress: toAddress,
          toAddress: toAddress,
          amount: intermediateAmountUi,
          fromDecimals: intermediate.decimals,
          toDecimals: toToken.decimals,
          fromSymbol: intermediate.symbol,
          toSymbol: toToken.symbol,
          slippageBps,
        });
        const freshSwapLeg = fresh?.legs?.[0];
        if (!freshSwapLeg || freshSwapLeg.kind !== "swap") {
          throw new Error("Destination-chain re-quote failed after bridge.");
        }

        const { hash: swapHash, explorer: swapExplorer } = await runSwapLeg({
          legIndex: 1,
          chain: intermediate.chain,
          quote: freshSwapLeg.quote,
          fromToken: {
            address: intermediate.address,
            symbol: intermediate.symbol,
            decimals: intermediate.decimals,
            name: intermediate.symbol,
            logo: null,
            priceUsd: 1,
            chainId: intermediate.chain,
          },
          toToken,
          walletSource,
          fromAddress: toAddress,
          slippageBps,
          dynamicSlippage,
          onStatus,
        });
        legHashes.push({ chain: intermediate.chain, hash: swapHash, explorer: swapExplorer });

        onStatus({
          kind: "success",
          legHashes,
          finalAmountUi: freshSwapLeg.quote.output?.amountUi ?? 0,
          finalSymbol: toToken.symbol,
          durationMs: Date.now() - startedAt,
        });
      } catch (e: any) {
        if (cancelled.current) return;
        const msg = String(e?.message ?? e ?? "Something went wrong");
        const lower = msg.toLowerCase();
        if (
          lower.includes("user rejected") ||
          lower.includes("user denied") ||
          lower.includes("rejected the request") ||
          lower.includes("user cancelled")
        ) {
          onStatus({ kind: "cancelled" });
          return;
        }
        onStatus({ kind: "error", message: msg });
      }
    },
    [
      connection,
      publicKey,
      signTransaction,
      externalEvmAddress,
      visionWallet.solanaAddress,
      visionWallet.evmAddress,
      visionSigner,
      evmBridge,
      visionEvmBridge,
    ],
  );

  type SwapLegArgs = {
    legIndex: number;
    chain: ChainKey;
    quote: any;
    fromToken: MultichainToken;
    toToken: MultichainToken;
    walletSource: WalletSource;
    fromAddress: string;
    slippageBps: number;
    dynamicSlippage: boolean;
    onStatus: (s: ExecutorStatus) => void;
  };

  async function runSwapLeg(args: SwapLegArgs): Promise<{ hash: string; explorer: string }> {
    const { legIndex, chain, quote, fromToken, toToken, walletSource, fromAddress, slippageBps, dynamicSlippage, onStatus } = args;
    onStatus({ kind: "building", legIndex, legKind: "swap" });

    if (isSol(chain)) {
      const built = await supaPost("swap-build", {
        userPublicKey: fromAddress,
        inputMint: fromToken.address,
        outputMint: toToken.address,
        amount: quote.input?.amountAtomic ?? Math.round((quote.input?.amountUi ?? 0) * Math.pow(10, fromToken.decimals)),
        slippageBps,
        dynamicSlippage,
      });
      if (!built.swapTransaction) throw new Error("No transaction returned");

      let signature: string;
      if (walletSource === "vision") {
        onStatus({ kind: "awaiting_signature", legIndex, chain });
        const result = await visionSigner.signAndSend({
          chain: "solana",
          caip2: SOLANA_CAIP2,
          transaction: built.swapTransaction,
          method: "signAndSendTransaction",
        });
        if (!result.hash) throw new Error("No signature returned from Vision Wallet");
        signature = result.hash;
      } else {
        if (!signTransaction || !publicKey) throw new Error("Connect your Solana wallet first.");
        onStatus({ kind: "awaiting_signature", legIndex, chain });
        const txBytes = Uint8Array.from(atob(built.swapTransaction), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(txBytes);
        const signed = await signTransaction(tx);
        onStatus({ kind: "submitting", legIndex, chain });
        const signedB64 = btoa(String.fromCharCode(...signed.serialize()));
        const submitted = await supaPost("tx-submit", {
          signedTransaction: signedB64,
          kind: "swap",
          valueUsd: quote.input?.valueUsd ?? quote.output?.valueUsd ?? null,
          inputMint: fromToken.address,
          outputMint: toToken.address,
          inputAmount: quote.input?.amountUi ?? 0,
          outputAmount: quote.output?.amountUi ?? 0,
          walletAddress: fromAddress,
        });
        if (submitted?.fallback && submitted?.error) throw new Error(submitted.error as string);
        const sig = submitted.signature as string;
        if (!sig) throw new Error("No signature returned from submit");
        signature = sig;
      }

      const explorer = explorerUrl(chain, signature);
      onStatus({ kind: "confirming", legIndex, chain, hash: signature, explorer });
      await waitForSolanaConfirm(signature);

      void supaPost("record-swap-fee", {
        signature,
        valueUsd: quote.input?.valueUsd ?? quote.output?.valueUsd ?? null,
        feeUsd: quote.platformFee?.valueUsd ?? null,
        feeAmountUi: quote.platformFee?.amountUi ?? null,
        feeSymbol: quote.platformFee?.symbol ?? null,
        feeMint: toToken.address,
        inputMint: fromToken.address,
        outputMint: toToken.address,
      }).catch((e) => console.warn("record-swap-fee failed:", e));

      return { hash: signature, explorer };
    }

    const chainId = Number(chain);
    const built = await supaPost("evm-swap-build", {
      chainId,
      sellToken: fromToken.address,
      buyToken: toToken.address,
      taker: fromAddress,
      sellAmount: quote.input?.amountAtomic ?? "0",
      slippageBps,
    });
    if (!built?.transactionRequest?.to || !built?.transactionRequest?.data) {
      throw new Error("EVM swap build returned no transaction");
    }

    const driver =
      walletSource === "vision"
        ? visionEvmBridge.sendBridgeTx
        : evmBridge.sendBridgeTx;

    const hash = await driver({
      fromChainId: chainId,
      fromTokenAddress: fromToken.address.toLowerCase().match(/^0xeeee/)
        ? "0x0000000000000000000000000000000000000000"
        : fromToken.address,
      fromAmount: built.sellAmountAtomic ?? quote.input?.amountAtomic ?? "0",
      approvalAddress: built.allowanceTarget ?? null,
      txRequest: built.transactionRequest,
      onStatus: (s, info) => {
        if (s === "switching") onStatus({ kind: "switching_chain", legIndex, chain });
        else if (s === "approving") onStatus({ kind: "approving", legIndex, chain, hash: info?.approvalHash });
        else if (s === "signing") onStatus({ kind: "awaiting_signature", legIndex, chain });
        else if (s === "submitting") onStatus({ kind: "submitting", legIndex, chain });
        else if (s === "confirming") onStatus({ kind: "confirming", legIndex, chain, hash: "0x", explorer: explorerUrl(chain, "0x") });
      },
    });

    const explorer = explorerUrl(chain, hash);
    return { hash, explorer };
  }

  type BridgeLegArgs = {
    legIndex: number;
    quote: any;
    fromToken: MultichainToken;
    walletSource: WalletSource;
    onStatus: (s: ExecutorStatus) => void;
  };

  async function runBridgeLeg(args: BridgeLegArgs): Promise<{ hash: string; explorer: string }> {
    const { legIndex, quote, fromToken, walletSource, onStatus } = args;
    onStatus({ kind: "building", legIndex, legKind: "bridge" });
    const built = await supaPost("bridge-build", { quote: quote.raw });

    const fromChainKey: ChainKey = fromToken.chainId;

    if (isSol(fromChainKey)) {
      const txB64 = built.solanaTransaction ?? built.transactionRequest?.data;
      if (!txB64) throw new Error("Bridge route returned no Solana transaction");

      let signature: string;
      if (walletSource === "vision") {
        if (!visionWallet.solanaAddress) throw new Error("Create your Vision Wallet first.");
        onStatus({ kind: "awaiting_signature", legIndex, chain: fromChainKey });
        const result = await visionSigner.signAndSend({
          chain: "solana",
          caip2: SOLANA_CAIP2,
          transaction: txB64,
          method: "signAndSendTransaction",
        });
        if (!result.hash) throw new Error("No signature returned from Vision Wallet");
        signature = result.hash;
      } else {
        if (!signTransaction || !publicKey) throw new Error("Connect your Solana wallet first.");
        onStatus({ kind: "awaiting_signature", legIndex, chain: fromChainKey });
        const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(txBytes);
        const signed = await signTransaction(tx);
        onStatus({ kind: "submitting", legIndex, chain: fromChainKey });
        const signedB64 = btoa(String.fromCharCode(...signed.serialize()));
        const submitted = await supaPost("tx-submit", {
          signedTransaction: signedB64,
          kind: "bridge",
          valueUsd: quote.fromAmountUsd ?? quote.toAmountUsd ?? null,
          inputMint: fromToken.address,
          outputMint: null,
          inputAmount: Number(quote.fromAmountAtomic ?? "0") / Math.pow(10, fromToken.decimals),
          outputAmount: null,
          walletAddress: publicKey.toBase58(),
        });
        const sig = submitted.signature as string;
        if (!sig) throw new Error("No signature returned from submit");
        signature = sig;
      }

      const explorer = explorerUrl(fromChainKey, signature);
      return { hash: signature, explorer };
    }

    const txReq = built.transactionRequest;
    if (!txReq?.to || !txReq?.data) throw new Error("Bridge route returned no EVM transaction.");
    const approvalAddress: string | null =
      quote.raw?.estimate?.approvalAddress ?? built.step?.estimate?.approvalAddress ?? null;
    const driver = walletSource === "vision" ? visionEvmBridge.sendBridgeTx : evmBridge.sendBridgeTx;

    const hash = await driver({
      fromChainId: Number(fromChainKey),
      fromTokenAddress: fromToken.address.toLowerCase().match(/^0xeeee/)
        ? "0x0000000000000000000000000000000000000000"
        : fromToken.address,
      fromAmount: quote.fromAmountAtomic,
      approvalAddress,
      txRequest: txReq,
      onStatus: (s, info) => {
        if (s === "switching") onStatus({ kind: "switching_chain", legIndex, chain: fromChainKey });
        else if (s === "approving") onStatus({ kind: "approving", legIndex, chain: fromChainKey, hash: info?.approvalHash });
        else if (s === "signing") onStatus({ kind: "awaiting_signature", legIndex, chain: fromChainKey });
        else if (s === "submitting" || s === "confirming") onStatus({ kind: "submitting", legIndex, chain: fromChainKey });
      },
    });
    const explorer = explorerUrl(fromChainKey, hash);
    return { hash, explorer };
  }

  async function pollBridgeUntilDone(args: {
    hash: string;
    quote: any;
    explorer: string;
    estimatedSec: number | null;
    onStatus: (s: ExecutorStatus) => void;
  }) {
    const { hash, quote, explorer, estimatedSec, onStatus } = args;
    onStatus({ kind: "bridging", hash, explorer, estimatedSec });
    const deadline = Date.now() + BRIDGE_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (cancelled.current) return;
      await sleep(BRIDGE_POLL_INTERVAL_MS);
      try {
        const status = await supaGet("bridge-status", {
          txHash: hash,
          fromChain: String(quote.raw?.action?.fromChainId ?? ""),
          toChain: String(quote.raw?.action?.toChainId ?? ""),
          bridge: quote.tool ?? "",
        });
        if (status.status === "DONE") return;
        if (status.status === "FAILED" || status.status === "INVALID") {
          throw new Error(status.substatus ?? "Bridge failed on-chain");
        }
      } catch (e: any) {
        if (String(e?.message ?? "").includes("Bridge failed")) throw e;
        continue;
      }
    }
    throw new Error("Bridge is taking longer than expected. You can keep tracking it from the source transaction.");
  }

  async function waitForSolanaConfirm(signature: string) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (cancelled.current) return;
      await sleep(POLL_INTERVAL_MS);
      try {
        const status = await supaPost("tx-status", { signature });
        if (status.status === "confirmed") return;
        if (status.status === "failed") throw new Error(status.err ?? "Transaction failed on-chain");
      } catch (e: any) {
        if (String(e?.message ?? "").toLowerCase().includes("failed on-chain")) throw e;
        continue;
      }
    }
    throw new Error("Confirmation timed out. Check Solscan for status.");
  }

  return { execute, cancel };
};
