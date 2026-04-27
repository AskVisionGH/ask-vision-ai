import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SignChain = "solana" | "evm";

export interface SignAndSendParams {
  chain: SignChain;
  /** CAIP-2 chain id, e.g. "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" or "eip155:1" */
  caip2: string;
  /** Base64-serialized transaction (Solana, or serialized EVM tx) */
  transaction?: string;
  /** EVM unsigned transaction object (to/value/data/...) — alternative to `transaction` */
  tx?: Record<string, unknown>;
  /** Override RPC method (defaults: signAndSendTransaction / eth_sendTransaction) */
  method?:
    | "signAndSendTransaction"
    | "signTransaction"
    | "eth_sendTransaction"
    | "eth_signTransaction";
  /** Solana sponsorship */
  sponsor?: boolean;
}

export interface SignAndSendResult {
  ok: true;
  hash: string | null;
  signature: string | null;
  transaction_id: string | null;
  raw: unknown;
}

/**
 * useVisionWalletSigner — sign + broadcast transactions from the user's
 * Vision Wallet via the `sign-and-send-tx` edge function (Privy Server
 * Wallets RPC under the hood).
 */
export function useVisionWalletSigner() {
  const [signing, setSigning] = useState(false);

  const signAndSend = useCallback(
    async (params: SignAndSendParams): Promise<SignAndSendResult> => {
      setSigning(true);
      try {
        const { data, error } = await supabase.functions.invoke(
          "sign-and-send-tx",
          { body: params },
        );
        if (error) throw new Error(error.message || "sign-and-send-tx failed");
        const errMsg = (data as { error?: string } | null)?.error;
        if (errMsg) throw new Error(errMsg);
        return data as SignAndSendResult;
      } finally {
        setSigning(false);
      }
    },
    [],
  );

  return { signing, signAndSend };
}
