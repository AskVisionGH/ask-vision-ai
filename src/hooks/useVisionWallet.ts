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
 * Module-level cache keyed by Supabase user id. Without this, every page
 * navigation remounts `useVisionWallet`, which starts with `row = null`
 * and triggers a refetch — causing the wallet pill in the header to
 * briefly flash back to "Connect wallet" before the row reloads.
 */
const cache = new Map<string, VisionWalletRow | null>();
const inflight = new Map<string, Promise<void>>();
type Listener = (row: VisionWalletRow | null) => void;
const listeners = new Map<string, Set<Listener>>();

function notify(userId: string, row: VisionWalletRow | null) {
  cache.set(userId, row);
  const set = listeners.get(userId);
  if (set) for (const fn of set) fn(row);
}

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

  // Seed from cache so navigation between pages doesn't blank the pill.
  const [row, setRow] = useState<VisionWalletRow | null>(() =>
    supabaseUserId ? cache.get(supabaseUserId) ?? null : null,
  );
  const cached = supabaseUserId ? cache.has(supabaseUserId) : false;
  const [loading, setLoading] = useState(!cached && Boolean(supabaseUserId));
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (!supabaseUserId) {
      setRow(null);
      return;
    }
    if (opts?.force) {
      cache.delete(supabaseUserId);
      inflight.delete(supabaseUserId);
    }
    // De-dupe concurrent fetches across components
    let promise = inflight.get(supabaseUserId);
    if (!promise) {
      setLoading(true);
      promise = (async () => {
        const { data, error } = await supabase
          .from("vision_wallets")
          .select("*")
          .eq("user_id", supabaseUserId)
          .eq("is_active", true)
          .maybeSingle();
        if (error && error.code !== "PGRST116") {
          console.warn("[useVisionWallet] load failed", error);
        }
        notify(supabaseUserId, (data as VisionWalletRow | null) ?? null);
      })().finally(() => {
        inflight.delete(supabaseUserId);
      });
      inflight.set(supabaseUserId, promise);
    }
    await promise;
    setLoading(false);
  }, [supabaseUserId]);

  // Subscribe to cache updates so all mounted instances stay in sync.
  useEffect(() => {
    if (!supabaseUserId) return;
    const listener: Listener = (next) => setRow(next);
    let set = listeners.get(supabaseUserId);
    if (!set) {
      set = new Set();
      listeners.set(supabaseUserId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }, [supabaseUserId]);

  useEffect(() => {
    // Only fetch if we don't already have a cached value for this user.
    if (supabaseUserId && !cache.has(supabaseUserId)) {
      void refresh();
    }
  }, [refresh, supabaseUserId]);

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
      await refresh({ force: true });
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
