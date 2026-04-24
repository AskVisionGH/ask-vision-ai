import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface SmartWalletRow {
  id: string;
  user_id: string;
  address: string;
  label: string;
  twitter_handle: string | null;
  notes: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CuratedWallet {
  address: string;
  label: string;
  twitter_handle: string | null;
  category: string | null;
  /**
   * Verification tag for the curated entry. We reuse the seed table's
   * `notes` column for this:
   *   - "verified"  → address sourced from a confident public reference
   *   - "community" → widely circulated but not personally confirmed
   * Anything else (or null) is treated as unverified.
   */
  notes: string | null;
}

export interface SmartWalletInput {
  address: string;
  label: string;
  twitter_handle?: string | null;
  notes?: string | null;
  is_default?: boolean;
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const useSmartWallets = () => {
  const { user } = useAuth();
  const [tracked, setTracked] = useState<SmartWalletRow[]>([]);
  const [curated, setCurated] = useState<CuratedWallet[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [trackedResp, curatedResp] = await Promise.all([
      user
        ? supabase
            .from("smart_wallets")
            .select("*")
            .order("label", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("smart_wallets_global_seed")
        .select("address, label, twitter_handle, category, notes")
        .order("label", { ascending: true }),
    ]);
    if (!trackedResp.error && trackedResp.data) setTracked(trackedResp.data as SmartWalletRow[]);
    if (!curatedResp.error && curatedResp.data) setCurated(curatedResp.data as CuratedWallet[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const trackedAddresses = new Set(tracked.map((w) => w.address));

  const addWallet = useCallback(
    async (input: SmartWalletInput): Promise<SmartWalletRow | { error: string }> => {
      if (!user) return { error: "Not signed in" };
      const address = input.address.trim();
      const label = input.label.trim();
      if (!label) return { error: "Label required" };
      if (!BASE58_RE.test(address)) return { error: "Invalid Solana wallet address" };

      const { data, error } = await supabase
        .from("smart_wallets")
        .insert({
          user_id: user.id,
          address,
          label,
          twitter_handle: input.twitter_handle?.trim() || null,
          notes: input.notes?.trim() || null,
          is_default: input.is_default ?? false,
        })
        .select("*")
        .single();
      if (error) {
        if (error.code === "23505") return { error: "You already track this wallet" };
        return { error: error.message };
      }
      setTracked((prev) =>
        [...prev, data as SmartWalletRow].sort((a, b) => a.label.localeCompare(b.label)),
      );
      return data as SmartWalletRow;
    },
    [user],
  );

  const removeWallet = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from("smart_wallets").delete().eq("id", id);
    if (error) return false;
    setTracked((prev) => prev.filter((w) => w.id !== id));
    return true;
  }, []);

  const toggleCurated = useCallback(
    async (cur: CuratedWallet, currentlyTracked: boolean): Promise<boolean> => {
      if (currentlyTracked) {
        const row = tracked.find((t) => t.address === cur.address);
        if (!row) return true;
        return removeWallet(row.id);
      }
      const result = await addWallet({
        address: cur.address,
        label: cur.label,
        twitter_handle: cur.twitter_handle,
        is_default: true,
      });
      return !("error" in result);
    },
    [tracked, addWallet, removeWallet],
  );

  return {
    tracked,
    trackedAddresses,
    curated,
    loading,
    refresh,
    addWallet,
    removeWallet,
    toggleCurated,
  };
};
