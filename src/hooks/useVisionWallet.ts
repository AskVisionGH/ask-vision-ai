import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type VisionWalletRow = {
  id: string;
  user_id: string;
  privy_user_id: string | null;
  solana_address: string | null;
  evm_address: string | null;
  solana_wallet_id: string | null;
  evm_wallet_id: string | null;
  origin: "created" | "imported_seed" | "imported_key";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * useVisionWallet — single source of truth for the user's Vision Wallet.
 *
 * Vision Wallet is a fully managed (custodial) wallet provisioned by our
 * backend via Privy Server Wallets. Each user gets one Solana + one EVM
 * wallet under the hood, presented to the user as a single "Vision Wallet".
 *
 * No Privy SDK runs in the browser — wallet creation is a single call to
 * the `create-vision-wallet` edge function.
 */
export function useVisionWallet() {
  const { session } = useAuth();
  const supabaseUserId = session?.user?.id ?? null;

  const [row, setRow] = useState<VisionWalletRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabaseUserId) {
      setRow(null);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("vision_wallets")
      .select("*")
      .eq("user_id", supabaseUserId)
      .eq("is_active", true)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      console.warn("[useVisionWallet] load failed", error);
    }
    setRow((data as VisionWalletRow | null) ?? null);
    setLoading(false);
  }, [supabaseUserId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Create the Vision Wallet (or finish creating any missing chain).
   * Calls our backend, which provisions the wallet via Privy Server
   * Wallets and persists the addresses.
   */
  const createWallet = useCallback(async () => {
    if (!supabaseUserId) throw new Error("Not signed in");
    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-vision-wallet",
        { body: {} },
      );
      if (error) {
        throw new Error(error.message || "Wallet creation failed");
      }
      const errMsg = (data as { error?: string } | null)?.error;
      if (errMsg) throw new Error(errMsg);
      await refresh();
      toast.success("Vision Wallet created");
    } catch (err) {
      console.error("[useVisionWallet] createWallet failed", err);
      throw err;
    } finally {
      setWorking(false);
    }
  }, [supabaseUserId, refresh]);

  return {
    // status
    ready: true,
    loading,
    working,

    // data
    row,
    solanaAddress: row?.solana_address ?? null,
    evmAddress: row?.evm_address ?? null,

    // actions
    createWallet,
    refresh,
  };
}
