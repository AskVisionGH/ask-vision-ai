import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Whenever a signed-in user has a Solana wallet connected, record the
 * (user_id, wallet_address) pair in `wallet_links` so the admin panel
 * (and any future tracking features) can see which on-chain wallets a
 * given account has used. Idempotent thanks to the unique index.
 */
export const useWalletAutoLink = () => {
  const { session } = useAuth();
  const { connected, publicKey } = useWallet();
  const lastLinkedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!connected || !publicKey) return;
    const address = publicKey.toBase58();
    const cacheKey = `${session.user.id}:${address}`;
    if (lastLinkedRef.current === cacheKey) return;
    lastLinkedRef.current = cacheKey;

    supabase
      .from("wallet_links")
      .upsert(
        { user_id: session.user.id, wallet_address: address },
        { onConflict: "user_id,wallet_address", ignoreDuplicates: true },
      )
      .then(({ error }) => {
        if (error) {
          // Reset so we retry on the next connect cycle.
          lastLinkedRef.current = null;
          // eslint-disable-next-line no-console
          console.warn("[useWalletAutoLink] failed", error.message);
        }
      });
  }, [session?.user?.id, connected, publicKey]);
};
