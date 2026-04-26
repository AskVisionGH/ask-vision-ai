import { useCallback } from "react";
import {
  useAccount,
  useSwitchChain,
  useWalletClient,
  usePublicClient,
} from "wagmi";
import { erc20Abi, type Hex } from "viem";

/**
 * Drives the EVM-source bridge flow:
 *   1. Switch wallet to the source chain if needed.
 *   2. If the quote requires an ERC-20 approval (approvalAddress + non-native
 *      token), check current allowance and send `approve` only if it's short.
 *   3. Send the LI.FI transactionRequest (value/data/to/gas).
 *   4. Wait for the source-chain receipt before returning the hash.
 *
 * Returns the source-chain tx hash; LI.FI's bridge-status endpoint then maps
 * it to the destination receive tx via `bridge` + `fromChain` + `toChain`.
 */
export interface EvmBridgeParams {
  fromChainId: number;
  fromTokenAddress: string;       // 0x… for ERC-20, native is 0x000…0
  fromAmount: string;             // atomic (uint256 string)
  approvalAddress: string | null; // LI.FI's spender (router) for ERC-20 source
  txRequest: {
    to: string;
    data: string;
    value?: string;
    gasLimit?: string;
    gasPrice?: string;
    chainId?: number;
  };
  onStatus?: (s: "switching" | "approving" | "approved" | "signing" | "submitting" | "confirming") => void;
}

const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000".toLowerCase();
const isNative = (addr: string) => addr.toLowerCase() === NATIVE_ADDRESS;

export const useEvmBridge = () => {
  const { address, chainId: connectedChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const sendBridgeTx = useCallback(
    async (params: EvmBridgeParams): Promise<Hex> => {
      if (!address) throw new Error("Connect an EVM wallet first.");
      if (!walletClient) throw new Error("Wallet client unavailable.");
      if (!publicClient) throw new Error("RPC client unavailable.");

      // 1. Switch chains if needed.
      if (connectedChainId !== params.fromChainId) {
        params.onStatus?.("switching");
        await switchChainAsync({ chainId: params.fromChainId });
      }

      // 2. ERC-20 approval (only when source is a token, not native).
      if (params.approvalAddress && !isNative(params.fromTokenAddress)) {
        const required = BigInt(params.fromAmount);
        const currentAllowance = (await publicClient.readContract({
          address: params.fromTokenAddress as Hex,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, params.approvalAddress as Hex],
        })) as bigint;

        if (currentAllowance < required) {
          params.onStatus?.("approving");
          const approveHash = await walletClient.writeContract({
            address: params.fromTokenAddress as Hex,
            abi: erc20Abi,
            functionName: "approve",
            args: [params.approvalAddress as Hex, required],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          params.onStatus?.("approved");
        }
      }

      // 3. Send the bridge tx (LI.FI returns hex strings).
      params.onStatus?.("signing");
      const hash = await walletClient.sendTransaction({
        to: params.txRequest.to as Hex,
        data: params.txRequest.data as Hex,
        value: params.txRequest.value ? BigInt(params.txRequest.value) : 0n,
        gas: params.txRequest.gasLimit ? BigInt(params.txRequest.gasLimit) : undefined,
        // Let viem pick gasPrice from the network unless LI.FI insists.
      });

      // 4. Wait for source-chain inclusion before handing off to LI.FI status polling.
      params.onStatus?.("confirming");
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
    [address, walletClient, publicClient, connectedChainId, switchChainAsync],
  );

  return { address, sendBridgeTx };
};
