import { useCallback } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, http, type Hex } from "viem";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { useVisionWalletSigner } from "@/hooks/useVisionWalletSigner";
import { findEvmChain } from "@/lib/evm-chains";

/**
 * useVisionEvmBridge — EVM-source bridge driver for Vision Wallet (Privy
 * Server Wallets), mirroring useEvmBridge's external-wallet flow:
 *
 *   1. Resolve the destination wagmi `Chain` (no popup chain switch needed —
 *      Privy is server-side, so we just pass the right CAIP-2 per call).
 *   2. If the quote requires an ERC-20 approval, read current allowance via
 *      a read-only public client; if short, send `approve(spender, amount)`
 *      through Privy and wait for the receipt.
 *   3. Send the LI.FI bridge tx through Privy; wait for the receipt.
 *
 * Returns the source-chain tx hash. LI.FI's `bridge-status` endpoint then
 * resolves it into the destination receipt — same handoff as useEvmBridge.
 */
export interface VisionEvmBridgeParams {
  fromChainId: number;
  fromTokenAddress: string;
  fromAmount: string; // atomic uint256 string
  approvalAddress: string | null;
  txRequest: {
    to: string;
    data: string;
    value?: string;
    gasLimit?: string;
    chainId?: number;
  };
  onStatus?: (
    s: "switching" | "approving" | "approved" | "signing" | "submitting" | "confirming",
    info?: { approvalHash?: Hex },
  ) => void;
}

const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000".toLowerCase();
const isNative = (addr: string) => addr.toLowerCase() === NATIVE_ADDRESS;

/** Convert a decimal/uint256 string to a Privy-friendly hex string. */
const toHex = (s: string | undefined | null): Hex | undefined => {
  if (s == null || s === "") return undefined;
  // Already hex?
  if (typeof s === "string" && s.startsWith("0x")) return s as Hex;
  try {
    return `0x${BigInt(s).toString(16)}` as Hex;
  } catch {
    return undefined;
  }
};

export const useVisionEvmBridge = () => {
  const visionWallet = useVisionWallet();
  const visionSigner = useVisionWalletSigner();

  const sendBridgeTx = useCallback(
    async (params: VisionEvmBridgeParams): Promise<Hex> => {
      const fromAddress = visionWallet.evmAddress;
      if (!fromAddress) {
        throw new Error("No Vision Wallet EVM address — create one first.");
      }
      const chain = findEvmChain(params.fromChainId);
      if (!chain) {
        throw new Error(`Unsupported EVM chain: ${params.fromChainId}`);
      }

      // Read-only client for allowance + receipts. Default `http()` uses the
      // chain's public RPC URL, which is fine for these light reads.
      const publicClient = createPublicClient({ chain, transport: http() });
      const caip2 = `eip155:${params.fromChainId}` as const;

      // ── 1. ERC-20 approval (only when source is a token) ────────────────
      if (params.approvalAddress && !isNative(params.fromTokenAddress)) {
        const required = BigInt(params.fromAmount);
        const currentAllowance = (await publicClient.readContract({
          address: params.fromTokenAddress as Hex,
          abi: erc20Abi,
          functionName: "allowance",
          args: [fromAddress as Hex, params.approvalAddress as Hex],
        })) as bigint;

        if (currentAllowance < required) {
          const approveData = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [params.approvalAddress as Hex, required],
          });

          const approveRes = await visionSigner.signAndSend({
            chain: "evm",
            caip2,
            tx: {
              to: params.fromTokenAddress,
              data: approveData,
              value: "0x0",
            },
            method: "eth_sendTransaction",
          });
          const approvalHash = approveRes.hash as Hex | null;
          if (!approvalHash) throw new Error("Approval tx returned no hash");
          params.onStatus?.("approving", { approvalHash });
          await publicClient.waitForTransactionReceipt({ hash: approvalHash });
          params.onStatus?.("approved", { approvalHash });
        }
      }

      // ── 2. Send the bridge tx ───────────────────────────────────────────
      params.onStatus?.("signing");
      const valueHex = toHex(params.txRequest.value) ?? ("0x0" as Hex);
      const gasHex = toHex(params.txRequest.gasLimit);
      const sendRes = await visionSigner.signAndSend({
        chain: "evm",
        caip2,
        tx: {
          to: params.txRequest.to,
          data: params.txRequest.data,
          value: valueHex,
          ...(gasHex ? { gas_limit: gasHex } : {}),
        },
        method: "eth_sendTransaction",
      });
      const hash = sendRes.hash as Hex | null;
      if (!hash) throw new Error("Bridge tx returned no hash from Vision Wallet");

      // ── 3. Wait for source-chain inclusion ──────────────────────────────
      params.onStatus?.("confirming");
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
    [visionWallet.evmAddress, visionSigner],
  );

  return { address: visionWallet.evmAddress, sendBridgeTx };
};
