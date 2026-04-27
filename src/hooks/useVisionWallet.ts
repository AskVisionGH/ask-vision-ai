import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy, useLoginWithEmail } from "@privy-io/react-auth";
import { useCreateWallet as useCreateSolanaWallet } from "@privy-io/react-auth/solana";
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
 * Pull the embedded Solana wallet address out of the Privy user object.
 * Privy stores embedded wallets as linked accounts of type "wallet" with
 * walletClientType === "privy" and chainType === "solana".
 */
function getEmbeddedSolanaAddress(privyUser: unknown): string | null {
  if (!privyUser || typeof privyUser !== "object") return null;
  const accounts = (privyUser as { linkedAccounts?: unknown[] })
    .linkedAccounts;
  if (!Array.isArray(accounts)) return null;
  for (const acc of accounts) {
    if (!acc || typeof acc !== "object") continue;
    const a = acc as Record<string, unknown>;
    if (
      a.type === "wallet" &&
      a.walletClientType === "privy" &&
      a.chainType === "solana" &&
      typeof a.address === "string"
    ) {
      return a.address;
    }
  }
  return null;
}

/**
 * useVisionWallet — single source of truth for the user's Vision-managed
 * (Privy embedded) wallet. Trade flows should use this hook instead of
 * touching Privy directly, so we can centralise:
 *   - Privy <-> Supabase user binding
 *   - vision_wallets row sync
 *   - Solana address resolution
 *   - Signing API (added in Phase 2)
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
  const { createWallet: createSolanaWallet } = useCreateSolanaWallet();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  const [row, setRow] = useState<VisionWalletRow | null>(null);
  const [loadingRow, setLoadingRow] = useState(false);
  const [working, setWorking] = useState(false);

  const embeddedSolanaAddress = useMemo(
    () => getEmbeddedSolanaAddress(privyUser),
    [privyUser],
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
    if (!supabaseUserId || !privyUser?.id || !embeddedSolanaAddress) return;
    if (
      row &&
      row.privy_user_id === privyUser.id &&
      row.solana_address === embeddedSolanaAddress
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
            solana_address: embeddedSolanaAddress,
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
  }, [supabaseUserId, privyUser?.id, embeddedSolanaAddress, row]);

  /**
   * Step 1 of Privy login: send a one-time code to the user's Supabase
   * email. Caller should then prompt for the code and call submitPrivyCode.
   */
  const sendPrivyLoginCode = useCallback(async () => {
    if (!ready) throw new Error("Wallet system not ready");
    const email = session?.user?.email;
    if (!email) throw new Error("No Supabase email to bind to Privy");
    await sendCode({ email });
    toast.message("Check your email", {
      description: `We sent a 6-digit code to ${email}.`,
    });
    return email;
  }, [ready, session?.user?.email, sendCode]);

  /**
   * Step 2 of Privy login: submit the 6-digit code.
   */
  const submitPrivyCode = useCallback(
    async (code: string) => {
      await loginWithCode({ code });
    },
    [loginWithCode],
  );

  /**
   * Create a brand-new embedded Solana wallet. Caller must already be
   * Privy-authenticated (sendPrivyLoginCode + submitPrivyCode).
   */
  const createWallet = useCallback(async () => {
    if (!authenticated) {
      throw new Error("Must be logged into Privy first");
    }
    setWorking(true);
    try {
      await createSolanaWallet();
      toast.success("Vision Wallet created");
    } finally {
      setWorking(false);
    }
  }, [authenticated, createSolanaWallet]);

  /**
   * Disconnect this device from Privy. The on-chain wallet is preserved
   * — the user can recover it on any device by logging in with the same
   * email.
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
    solanaAddress: embeddedSolanaAddress ?? row?.solana_address ?? null,
    privyUserId: privyUser?.id ?? null,

    // actions
    sendPrivyLoginCode,
    submitPrivyCode,
    createWallet,
    disconnect,
  };
}
