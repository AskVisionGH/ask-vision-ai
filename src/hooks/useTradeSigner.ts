import { useCallback, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { useVisionWalletSigner } from "@/hooks/useVisionWalletSigner";
import type { WalletSource } from "@/components/trade/WalletSourcePicker";

const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/**
 * useTradeSigner — single abstraction over "external wallet vs Vision Wallet"
 * for Solana trade flows (swap / limit / DCA / TP-SL).
 *
 * Two operations exposed:
 *   - signAndSend(tx)  → broadcasts the tx, returns signature.
 *                        Used for direct Jupiter v2 swaps and DCA fee transfers.
 *   - signOnly(tx)     → returns base64 signed tx WITHOUT broadcasting.
 *                        Used for Jupiter Trigger / Recurring flows where
 *                        the signed tx must be POSTed to Jupiter's /execute
 *                        endpoint via our edge function.
 *
 * For Vision Wallet, signing happens server-side via Privy Server Wallets.
 * For external wallets, signing happens via the connected wallet adapter
 * and broadcast goes through the standard `tx-submit` path (callers handle
 * that — this hook just signs).
 */
export function useTradeSigner(source: WalletSource) {
  const visionWallet = useVisionWallet();
  const visionSigner = useVisionWalletSigner();
  const externalWallet = useWallet();

  const activeAddress = useMemo(() => {
    return source === "vision"
      ? visionWallet.solanaAddress
      : externalWallet.publicKey?.toBase58() ?? null;
  }, [source, visionWallet.solanaAddress, externalWallet.publicKey]);

  const ready = source === "vision"
    ? Boolean(visionWallet.solanaAddress)
    : Boolean(externalWallet.connected && externalWallet.signTransaction);

  /**
   * Sign + broadcast a Solana tx. Returns the on-chain signature (or null
   * if the underlying signer didn't surface one — caller should surface).
   */
  const signAndSend = useCallback(
    async (tx: VersionedTransaction | Transaction): Promise<string | null> => {
      const txB64 = serializeTx(tx);
      if (source === "vision") {
        const res = await visionSigner.signAndSend({
          chain: "solana",
          caip2: SOLANA_CAIP2,
          transaction: txB64,
          method: "signAndSendTransaction",
        });
        // Privy returns the on-chain signature in `hash` for Solana.
        return res.hash ?? res.signature ?? null;
      }
      if (!externalWallet.signTransaction) throw new Error("No signer");
      // External wallets sign locally — caller is responsible for broadcast
      // via the existing `tx-submit` flow. We return the signed-tx base64
      // so the caller can pass it on. Differentiated from Vision by the
      // `kind` field on the result (see signAndSendForExternal pattern).
      throw new Error(
        "useTradeSigner.signAndSend is Vision-only — use signOnly + tx-submit for external",
      );
    },
    [source, visionSigner, externalWallet.signTransaction],
  );

  /**
   * Sign without broadcasting. Returns base64 signed tx for both wallet
   * sources, suitable for posting to Jupiter's `/execute` endpoint.
   */
  const signOnly = useCallback(
    async (tx: VersionedTransaction | Transaction): Promise<string> => {
      if (source === "vision") {
        const txB64 = serializeTx(tx);
        const res = await visionSigner.signAndSend({
          chain: "solana",
          caip2: SOLANA_CAIP2,
          transaction: txB64,
          method: "signTransaction",
        });
        // Privy returns base64 signed tx in `signature` field for signTransaction.
        const signed = res.signature ?? null;
        if (!signed) throw new Error("Vision Wallet didn't return signed tx");
        return signed;
      }
      if (!externalWallet.signTransaction) throw new Error("No external signer");
      const signed = (await externalWallet.signTransaction(tx as never)) as
        | VersionedTransaction
        | Transaction;
      return serializeSigned(signed);
    },
    [source, visionSigner, externalWallet.signTransaction],
  );

  return {
    source,
    ready,
    activeAddress,
    visionSigning: visionSigner.signing,
    /** Vision-only: sign + broadcast in one call. */
    signAndSend,
    /** Sign only — works for both sources. */
    signOnly,
    /** Whether the Vision Wallet exists at all (for prompts). */
    visionWalletExists: Boolean(visionWallet.solanaAddress),
    /** Provision the Vision Wallet if missing. */
    createVisionWallet: visionWallet.createWallet,
  };
}

function serializeTx(tx: VersionedTransaction | Transaction): string {
  const bytes =
    "version" in tx
      ? (tx as VersionedTransaction).serialize()
      : (tx as Transaction).serialize({ requireAllSignatures: false });
  return btoa(String.fromCharCode(...bytes));
}

function serializeSigned(tx: VersionedTransaction | Transaction): string {
  const bytes =
    "version" in tx
      ? (tx as VersionedTransaction).serialize()
      : (tx as Transaction).serialize({ requireAllSignatures: true });
  return btoa(String.fromCharCode(...bytes));
}
