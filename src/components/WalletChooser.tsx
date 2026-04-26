import { useEffect, useMemo, useState } from "react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAccount, useConnect, useConnectors, useDisconnect as useEvmDisconnect } from "wagmi";
import { Loader2, Plus, Wallet, History as HistoryIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  detectWalletChain,
  readLastUsedWallets,
  recordLastUsedWallet,
  shortAddress,
  type LastUsedWallet,
  type WalletChain,
} from "@/lib/wallet-history";
import { cn } from "@/lib/utils";

/**
 * Unified wallet chooser shown anywhere we ask the user to "connect".
 *
 * Goals (per product req):
 *  - Stop silently auto-reconnecting; always present a chooser.
 *  - Surface every address linked to the current account (`wallet_links`),
 *    plus the most recently used wallets on this device.
 *  - Let the user reconnect a known address with a single click — we
 *    pre-select the matching adapter / connector so the wallet modal doesn't
 *    list every option again.
 *  - Provide explicit "Connect new Solana / EVM wallet" CTAs for the cases
 *    where the user wants to add a wallet that isn't on the list.
 */

interface LinkedWallet {
  address: string;
  chain: WalletChain;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Optional preference — affects which "Connect new" button is highlighted
   *  and ordering of the linked list. */
  preferredChain?: WalletChain | null;
}

const ChainBadge = ({ chain }: { chain: WalletChain }) => (
  <span
    className={cn(
      "rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest",
      chain === "solana"
        ? "border-primary/40 bg-primary/10 text-primary"
        : "border-accent/40 bg-accent/10 text-accent-foreground",
    )}
  >
    {chain === "solana" ? "Solana" : "EVM"}
  </span>
);

export const WalletChooser = ({ open, onOpenChange, preferredChain }: Props) => {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  // Solana side
  const {
    wallets: solWallets,
    wallet: selectedSolWallet,
    select: selectSolWallet,
    publicKey: solPublicKey,
    connected: solConnected,
    connecting: solConnecting,
    connect: connectSolWallet,
    disconnect: disconnectSolWallet,
  } = useWallet();

  // EVM side
  const evmConnectors = useConnectors();
  const { connectAsync: connectEvm } = useConnect();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { disconnectAsync: disconnectEvm } = useEvmDisconnect();

  const [linked, setLinked] = useState<LinkedWallet[]>([]);
  const [recent, setRecent] = useState<LastUsedWallet[]>([]);
  const [loadingLinked, setLoadingLinked] = useState(false);
  const [busyAddress, setBusyAddress] = useState<string | null>(null);
  const [showSolanaOptions, setShowSolanaOptions] = useState(false);
  const [pendingSolanaWalletName, setPendingSolanaWalletName] = useState<WalletName | null>(null);
  const [solanaTargetAddress, setSolanaTargetAddress] = useState<string | null>(null);
  const [showEvmOptions, setShowEvmOptions] = useState(false);
  const [pendingEvmConnectorId, setPendingEvmConnectorId] = useState<string | null>(null);
  const [evmTargetAddress, setEvmTargetAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setShowSolanaOptions(false);
      setPendingSolanaWalletName(null);
      setSolanaTargetAddress(null);
      setShowEvmOptions(false);
      setPendingEvmConnectorId(null);
      setEvmTargetAddress(null);
    }
  }, [open]);

  // Refresh last-used + linked rows every time the chooser opens, so newly
  // connected wallets show up without remounting.
  useEffect(() => {
    if (!open) return;
    setRecent(readLastUsedWallets());
    if (!userId) {
      setLinked([]);
      return;
    }
    let cancelled = false;
    setLoadingLinked(true);
    (async () => {
      const { data, error } = await supabase
        .from("wallet_links")
        .select("wallet_address")
        .eq("user_id", userId);
      if (cancelled) return;
      if (error) {
        setLinked([]);
      } else {
        const rows: LinkedWallet[] = (data ?? [])
          .map((r) => {
            const chain = detectWalletChain(r.wallet_address);
            return chain ? { address: r.wallet_address, chain } : null;
          })
          .filter((x): x is LinkedWallet => x !== null);
        setLinked(rows);
      }
      setLoadingLinked(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  // Combined list: linked first (deduped against recent), then recent-only.
  // Active address is rendered with a "Connected" pill and skips reconnect.
  type Row = {
    address: string;
    chain: WalletChain;
    walletName?: string;
    source: "linked" | "recent";
    isActive: boolean;
  };

  const rows: Row[] = useMemo(() => {
    const activeSol = solConnected && solPublicKey ? solPublicKey.toBase58() : null;
    const activeEvm = evmConnected && evmAddress ? evmAddress.toLowerCase() : null;
    const recentByKey = new Map<string, LastUsedWallet>(
      recent.map((r) => [`${r.chain}:${r.address.toLowerCase()}`, r]),
    );
    const seen = new Set<string>();
    const out: Row[] = [];

    const linkedSorted = [...linked].sort((a, b) => {
      if (preferredChain) {
        if (a.chain === preferredChain && b.chain !== preferredChain) return -1;
        if (b.chain === preferredChain && a.chain !== preferredChain) return 1;
      }
      return 0;
    });

    for (const l of linkedSorted) {
      const key = `${l.chain}:${l.address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const recentMatch = recentByKey.get(key);
      out.push({
        address: l.address,
        chain: l.chain,
        walletName: recentMatch?.walletName,
        source: "linked",
        isActive:
          (l.chain === "solana" && l.address === activeSol) ||
          (l.chain === "evm" && l.address.toLowerCase() === activeEvm),
      });
    }

    for (const r of recent) {
      const key = `${r.chain}:${r.address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        address: r.address,
        chain: r.chain,
        walletName: r.walletName,
        source: "recent",
        isActive:
          (r.chain === "solana" && r.address === activeSol) ||
          (r.chain === "evm" && r.address.toLowerCase() === activeEvm),
      });
    }

    return out;
  }, [linked, recent, preferredChain, solConnected, solPublicKey, evmConnected, evmAddress]);

  const handleReconnect = async (row: Row) => {
    if (row.isActive) {
      onOpenChange(false);
      return;
    }
    setBusyAddress(row.address);
    try {
      if (row.chain === "solana") {
        setSolanaTargetAddress(row.address);
        setShowSolanaOptions(true);
        setShowEvmOptions(false);
        return;
      }

      // EVM branch — show explicit provider chooser, never auto-launch a
      // connector based on stored history.
      setEvmTargetAddress(row.address);
      setShowEvmOptions(true);
      setShowSolanaOptions(false);
      return;
    } catch (e) {
      toast.error("Couldn't reconnect wallet", {
        description: e instanceof Error ? e.message : "Try the new-wallet button below.",
      });
    } finally {
      setBusyAddress(null);
    }
  };

  const handleNewSolana = () => {
    setSolanaTargetAddress(null);
    setShowSolanaOptions((v) => !v);
    setShowEvmOptions(false);
  };

  const handleSelectNewSolanaWallet = async (walletName: WalletName) => {
    setPendingSolanaWalletName(walletName);

    try {
      if (solConnected) {
        try {
          await disconnectSolWallet();
        } catch {
          /* ignore */
        }
      }

      selectSolWallet(walletName);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await connectSolWallet();
      setShowSolanaOptions(false);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/user rejected|user cancel|user closed/i.test(msg)) {
        toast.error("Couldn't connect that wallet", {
          description: msg,
        });
      }
    } finally {
      setPendingSolanaWalletName(null);
      setBusyAddress(null);
    }
  };

  const handleNewEvm = () => {
    setEvmTargetAddress(null);
    setShowEvmOptions((v) => !v);
    setShowSolanaOptions(false);
  };

  const handleSelectEvmConnector = async (connectorId: string) => {
    const target = evmConnectors.find((c) => c.id === connectorId);
    if (!target) return;
    setPendingEvmConnectorId(connectorId);

    try {
      if (evmConnected) {
        try {
          await disconnectEvm();
        } catch {
          /* ignore */
        }
      }

      await connectEvm({ connector: target });
      setShowEvmOptions(false);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/user rejected|user cancel|user closed/i.test(msg)) {
        toast.error("Couldn't connect that wallet", { description: msg });
      }
    } finally {
      setPendingEvmConnectorId(null);
      setBusyAddress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border-border bg-card p-6">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-light">
            Choose a wallet
          </DialogTitle>
          <DialogDescription className="text-center text-xs text-muted-foreground">
            Reuse one of your registered wallets, or connect a new one.
          </DialogDescription>
        </DialogHeader>

        {/* Registered + recent list */}
        <div className="mt-2 space-y-1.5">
          {loadingLinked ? (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Loading your wallets…
            </div>
          ) : rows.length === 0 ? (
            <p className="px-1 pb-1 text-center text-[11px] text-muted-foreground">
              No registered wallets yet — pick a chain below to connect one.
            </p>
          ) : (
            rows.map((row) => {
              const isBusy = busyAddress === row.address;
              return (
                <button
                  key={`${row.chain}:${row.address}`}
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleReconnect(row)}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-xl border border-border/70 bg-secondary/60 px-3 py-2.5 text-left transition-all ease-vision",
                    "hover:border-primary/40 hover:bg-secondary disabled:opacity-60",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      row.chain === "solana"
                        ? "bg-primary/15 text-primary"
                        : "bg-accent/20 text-accent-foreground",
                    )}
                  >
                    <Wallet className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs text-foreground">
                        {shortAddress(row.address)}
                      </span>
                      <ChainBadge chain={row.chain} />
                      {row.isActive && (
                        <span className="rounded-full border border-primary/50 bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-primary">
                          Connected
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                      {row.source === "linked" ? (
                        <span>Registered</span>
                      ) : (
                        <>
                          <HistoryIcon className="h-3 w-3" />
                          <span>Last used</span>
                        </>
                      )}
                      {row.walletName && (
                        <>
                          <span>·</span>
                          <span className="normal-case tracking-normal text-muted-foreground">
                            {row.walletName}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </button>
              );
            })
          )}
        </div>

        {/* New wallet CTAs */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleNewSolana}
            className={cn(
              "ease-vision flex flex-col items-center gap-1 rounded-xl border border-border/70 bg-secondary/50 px-3 py-3 text-xs hover:border-primary/50 hover:bg-secondary",
              preferredChain === "solana" && "border-primary/60 bg-primary/10",
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span className="font-medium text-foreground">Solana wallet</span>
            <span className="text-[10px] text-muted-foreground">Phantom, Solflare…</span>
          </button>
          <button
            type="button"
            onClick={handleNewEvm}
            className={cn(
              "ease-vision flex flex-col items-center gap-1 rounded-xl border border-border/70 bg-secondary/50 px-3 py-3 text-xs hover:border-accent/50 hover:bg-secondary",
              preferredChain === "evm" && "border-accent/60 bg-accent/10",
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span className="font-medium text-foreground">EVM wallet</span>
            <span className="text-[10px] text-muted-foreground">MetaMask, Rabby…</span>
          </button>
        </div>

        {showSolanaOptions && (
          <div className="mt-2 space-y-1.5 rounded-xl border border-border/70 bg-secondary/35 p-2">
            {solanaTargetAddress && (
              <p className="px-1 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                Choose a Solana wallet for {shortAddress(solanaTargetAddress)}
              </p>
            )}
            {solWallets.map((walletOption) => {
              const isPending = pendingSolanaWalletName === walletOption.adapter.name;
              const isSelected = selectedSolWallet?.adapter.name === walletOption.adapter.name;

              return (
                <button
                  key={walletOption.adapter.name}
                  type="button"
                  disabled={!!pendingSolanaWalletName}
                  onClick={() => handleSelectNewSolanaWallet(walletOption.adapter.name)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-left text-xs transition-all ease-vision hover:border-primary/40 hover:bg-background/70 disabled:opacity-60",
                    isSelected && "border-primary/50 bg-primary/10",
                  )}
                >
                  <span className="truncate font-medium text-foreground">
                    {walletOption.adapter.name}
                  </span>
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        {showEvmOptions && (
          <div className="mt-2 space-y-1.5 rounded-xl border border-border/70 bg-secondary/35 p-2">
            {evmTargetAddress && (
              <p className="px-1 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                Choose an EVM wallet for {shortAddress(evmTargetAddress)}
              </p>
            )}
            {evmConnectors.length === 0 ? (
              <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">
                No EVM wallet extensions detected.
              </p>
            ) : (
              evmConnectors.map((connector) => {
                const isPending = pendingEvmConnectorId === connector.id;
                return (
                  <button
                    key={connector.id}
                    type="button"
                    disabled={!!pendingEvmConnectorId}
                    onClick={() => handleSelectEvmConnector(connector.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-left text-xs transition-all ease-vision hover:border-accent/40 hover:bg-background/70 disabled:opacity-60",
                    )}
                  >
                    <span className="truncate font-medium text-foreground">
                      {connector.name}
                    </span>
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        )}

        <p className="mt-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
          We never auto-reconnect — you stay in control.
        </p>
      </DialogContent>
    </Dialog>
  );
};