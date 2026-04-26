import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAccount } from "wagmi";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type MergeCandidate = {
  walletAddress: string;
  orphanUserId: string;
};

/**
 * Auto-link a connected wallet to the signed-in user, AND detect when the
 * wallet is already linked to a *different* (wallet-only) account so the
 * UI can offer a merge prompt.
 *
 * - If wallet has no link → insert (user_id, wallet_address).
 * - If wallet links only to the current user → no-op.
 * - If wallet links to another user → expose `mergeCandidate` so a dialog
 *   can ask the user to absorb that account into theirs.
 */
export const useWalletAutoLink = () => {
  const { session } = useAuth();
  const { connected, publicKey } = useWallet();
  // EVM side (wagmi). Address is lowercased so wallet_links rows are
  // canonicalised and we don't accidentally double-insert checksum variants.
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const handledRef = useRef<string | null>(null);
  const [mergeCandidate, setMergeCandidate] = useState<MergeCandidate | null>(null);
  const [merging, setMerging] = useState(false);

  // Shared linker — handles both Solana base58 addresses and lowercased EVM
  // addresses. We dedupe per (userId, address) to avoid hammering wallet_links
  // when adapters re-emit the same connect event.
  const linkAddress = (userId: string, address: string) => {
    const cacheKey = `${userId}:${address}`;
    if (handledRef.current === cacheKey) return;
    handledRef.current = cacheKey;

    (async () => {
      const { data: existing, error } = await supabase
        .from("wallet_links")
        .select("user_id")
        .eq("wallet_address", address);
      if (error) {
        console.warn("[useWalletAutoLink] lookup failed", error.message);
        handledRef.current = null;
        return;
      }

      const owners = existing ?? [];
      const ownedByMe = owners.some((r) => r.user_id === userId);
      const otherOwner = owners.find((r) => r.user_id !== userId);

      if (otherOwner) {
        // Don't insert another row — the unique index would block it. Instead
        // surface a merge prompt; the merge function will re-parent and
        // dedupe.
        setMergeCandidate({ walletAddress: address, orphanUserId: otherOwner.user_id });
        return;
      }

      if (!ownedByMe) {
        const { error: insertErr } = await supabase
          .from("wallet_links")
          .insert({ user_id: userId, wallet_address: address });
        if (insertErr) {
          console.warn("[useWalletAutoLink] insert failed", insertErr.message);
          handledRef.current = null;
        }
      }
    })();
  };

  // Solana branch.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    if (!connected || !publicKey) {
      handledRef.current = null;
      return;
    }
    linkAddress(userId, publicKey.toBase58());
  }, [session?.user?.id, connected, publicKey]);

  // EVM branch — fires whenever a wagmi connector reports an address.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    if (!evmConnected || !evmAddress) return;
    linkAddress(userId, evmAddress.toLowerCase());
  }, [session?.user?.id, evmConnected, evmAddress]);

  const acceptMerge = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!mergeCandidate) return { ok: false, error: "Nothing to merge" };
    setMerging(true);
    try {
      const { data, error } = await supabase.functions.invoke("merge-wallet-account", {
        body: { walletAddress: mergeCandidate.walletAddress },
      });
      if (error) return { ok: false, error: error.message };
      if (!data?.merged) return { ok: false, error: "Nothing to merge" };
      setMergeCandidate(null);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Merge failed" };
    } finally {
      setMerging(false);
    }
  };

  const dismissMerge = () => setMergeCandidate(null);

  return { mergeCandidate, merging, acceptMerge, dismissMerge };
};
