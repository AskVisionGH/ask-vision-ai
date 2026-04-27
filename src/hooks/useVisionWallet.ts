import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy, useLoginWithEmail } from "@privy-io/react-auth";
import {
  useWallets as useSolanaWallets,
  useCreateWallet as useCreateSolanaWallet,
} from "@privy-io/react-auth/solana";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type VisionWalletRow = {
  id: string;
  user_id: string;
  privy_user_id: string;
  solana_address: string | null;
  evm_address: string | null;
  origin: "created" | "imported_seed" | "imported_key";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * useVisionWallet — single source of truth for the user's Vision-managed
 * (Privy embedded) wallet. Trade flows should use this hook instead of
 * touching Privy directly, so we can centralise:
 *   - Privy <-> Supabase user binding
 *   - vision_wallets row sync
 *   - Solana address resolution
 *   - Signing API
 */
export function useVisionWallet() {
  const { session } = useAuth();
  const supabaseUserId = session?.user?.id ?? null;

  const {
    ready,
    authenticated,
    user: privyUser,
    logout: privyLogout,
  } = usePrivy();
  const { wallets: solanaWallets, createWallet: createSolanaWallet } =
    useSolanaWallets();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  const [row, setRow] = useState<VisionWalletRow | null>(null);
  const [loadingRow, setLoadingRow] = useState(false);
  const [working, setWorking] = useState(false);

  // Pick the embedded Solana wallet (not an external one).
  const embeddedSolana = useMemo(
    () => solanaWallets.find((w) => w.walletClientType === "privy") ?? null,
    [solanaWallets],
  );

  // Load existing row whenever the Supabase user changes.
  useEffect(() => {
    if (!supabaseUserId) {
      setRow(null);
      return;
    }
    let cancelled = false;
    setLoadingRow(true);
    supabase
      .from("vision_wallets")
      .select("*")
      .eq("user_id", supabaseUserId)
      .eq("is_active", true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error && error.code !== "PGRST116") {
          console.warn("[useVisionWallet] load failed", error);
        }
        setRow((data as VisionWalletRow | null) ?? null);
        setLoadingRow(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabaseUserId]);

  // Persist (upsert) the wallet record once Privy + Supabase + an
  // embedded Solana address are all available.
  useEffect(() => {
    if (!supabaseUserId || !privyUser?.id || !embeddedSolana?.address) return;
    if (
      row &&
      row.privy_user_id === privyUser.id &&
      row.solana_address === embeddedSolana.address
    ) {
      return; // already in sync
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("vision_wallets")
        .upsert(
          {
            user_id: supabaseUserId,
            privy_user_id: privyUser.id,
            solana_address: embeddedSolana.address,
            origin: row?.origin ?? "created",
            is_active: true,
          },
          { onConflict: "user_id" },
        )
        .select()
        .single();
      if (cancelled) return;
      if (error) {
        console.error("[useVisionWallet] upsert failed", error);
        return;
      }
      setRow(data as VisionWalletRow);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabaseUserId, privyUser?.id, embeddedSolana?.address, row]);

  /**
   * Ensure the user is logged in to Privy. We bind Privy to the same
   * email used in Supabase by sending a one-time code. If Privy already
   * has a session, this is a no-op.
   */
  const ensurePrivyLogin = useCallback(async () => {
    if (!ready) throw new Error("Wallet system not ready");
    if (authenticated) return;
    const email = session?.user?.email;
    if (!email) throw new Error("No Supabase email to bind to Privy");
    await sendCode({ email });
    toast.message("Check your email", {
      description: `We sent a code to ${email} to set up your Vision Wallet.`,
    });
    // The actual code-entry UI will be wired in Phase 2; for now we
    // throw so callers can show a "code sent" state.
    throw new Error("PRIVY_CODE_SENT");
  }, [ready, authenticated, session?.user?.email, sendCode]);

  /**
   * Submit the 6-digit code the user got via email to complete Privy login.
   */
  const submitPrivyCode = useCallback(
    async (code: string) => {
      await loginWithCode({ code });
    },
    [loginWithCode],
  );

  /**
   * Create a brand-new embedded Solana wallet. Caller must already be
   * Privy-authenticated (call ensurePrivyLogin first).
   */
  const createWallet = useCallback(async () => {
    if (!authenticated) {
      await ensurePrivyLogin();
      return;
    }
    setWorking(true);
    try {
      await createSolanaWallet();
      toast.success("Vision Wallet created");
    } finally {
      setWorking(false);
    }
  }, [authenticated, createSolanaWallet, ensurePrivyLogin]);

  /**
   * Disconnect this device from Privy. The on-chain wallet is preserved
   * — user can recover via email + Privy.
   */
  const disconnect = useCallback(async () => {
    await privyLogout();
  }, [privyLogout]);

  return {
    // status
    ready,
    authenticated,
    loading: loadingRow,
    working,

    // data
    row,
    solanaAddress: embeddedSolana?.address ?? row?.solana_address ?? null,
    privyUserId: privyUser?.id ?? null,

    // actions
    ensurePrivyLogin,
    submitPrivyCode,
    createWallet,
    disconnect,

    // raw handles for advanced flows (signing, etc.)
    embeddedSolana,
  };
}
