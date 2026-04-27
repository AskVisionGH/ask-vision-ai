import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePrivy,
  useLoginWithEmail,
  useCreateWallet as useCreateEvmWallet,
} from "@privy-io/react-auth";
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

type EmbeddedAddresses = {
  solana: string | null;
  evm: string | null;
};

/**
 * Pull embedded wallet addresses out of the Privy user object.
 * Privy stores embedded wallets as linked accounts of type "wallet" with
 * walletClientType === "privy". chainType is "solana" or "ethereum".
 * Note: a single EVM address works for ALL EVM chains (Ethereum, Base,
 * Arbitrum, Polygon, BSC, etc.).
 */
function getEmbeddedAddresses(privyUser: unknown): EmbeddedAddresses {
  const out: EmbeddedAddresses = { solana: null, evm: null };
  if (!privyUser || typeof privyUser !== "object") return out;
  const accounts = (privyUser as { linkedAccounts?: unknown[] })
    .linkedAccounts;
  if (!Array.isArray(accounts)) return out;
  for (const acc of accounts) {
    if (!acc || typeof acc !== "object") continue;
    const a = acc as Record<string, unknown>;
    if (
      a.type !== "wallet" ||
      a.walletClientType !== "privy" ||
      typeof a.address !== "string"
    )
      continue;
    if (a.chainType === "solana" && !out.solana) out.solana = a.address;
    if (a.chainType === "ethereum" && !out.evm) out.evm = a.address;
  }
  return out;
}

/**
 * useVisionWallet — single source of truth for the user's Vision-managed
 * (Privy embedded) wallet. Each user gets BOTH a Solana and an EVM
 * embedded wallet under one Privy login, so trade flows can route to the
 * right chain (and bridge cross-chain via LiFi).
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
  const { createWallet: createEvmWallet } = useCreateEvmWallet();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  const [row, setRow] = useState<VisionWalletRow | null>(null);
  const [loadingRow, setLoadingRow] = useState(false);
  const [working, setWorking] = useState(false);

  const addresses = useMemo(
    () => getEmbeddedAddresses(privyUser),
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

  // Persist (upsert) the wallet record once at least one embedded
  // address is available. We re-upsert if either address changes.
  useEffect(() => {
    if (!supabaseUserId || !privyUser?.id) return;
    if (!addresses.solana && !addresses.evm) return;
    if (
      row &&
      row.privy_user_id === privyUser.id &&
      row.solana_address === addresses.solana &&
      row.evm_address === addresses.evm
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
            solana_address: addresses.solana,
            evm_address: addresses.evm,
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
  }, [supabaseUserId, privyUser?.id, addresses.solana, addresses.evm, row]);

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
   * Create the Vision Wallet — both Solana and EVM embedded wallets.
   * If one already exists, only the missing one is created. The DB
   * sync effect picks up the new addresses and upserts the row.
   */
  const createWallet = useCallback(async () => {
    if (!authenticated) {
      throw new Error("Must be logged into Privy first");
    }
    setWorking(true);
    try {
      const tasks: Array<Promise<unknown>> = [];
      if (!addresses.solana) tasks.push(createSolanaWallet());
      if (!addresses.evm) tasks.push(createEvmWallet());
      if (tasks.length === 0) {
        toast.info("Vision Wallet already exists");
        return;
      }
      // Privy SDK requires sequential creation (each wallet bumps the
      // user record), so we await one at a time.
      if (!addresses.solana) await createSolanaWallet();
      if (!addresses.evm) await createEvmWallet();
      toast.success("Vision Wallet created");
    } finally {
      setWorking(false);
    }
  }, [
    authenticated,
    addresses.solana,
    addresses.evm,
    createSolanaWallet,
    createEvmWallet,
  ]);

  /**
   * Disconnect this device from Privy. The on-chain wallets are
   * preserved — the user can recover them on any device by logging
   * back in with the same email.
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
    solanaAddress: addresses.solana ?? row?.solana_address ?? null,
    evmAddress: addresses.evm ?? row?.evm_address ?? null,
    privyUserId: privyUser?.id ?? null,

    // actions
    sendPrivyLoginCode,
    submitPrivyCode,
    createWallet,
    disconnect,
  };
}
