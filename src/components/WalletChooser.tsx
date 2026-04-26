import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAccount, useConnect, useConnectors } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
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
    select: selectSolWallet,
    publicKey: solPublicKey,
    connected: solConnected,
  } = useWallet();
  const { setVisible: setSolModalVisible } = useWalletModal();

  // EVM side
  const evmConnectors = useConnectors();
  const { connectAsync: connectEvm } = useConnect();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { openConnectModal: openRainbowKit } = useConnectModal();

  const [linked, setLinked] = useState<LinkedWallet[]>([]);
  const [recent, setRecent] = useState<LastUsedWallet[]>([]);
  const [loadingLinked, setLoadingLinked] = useState(false);
  const [busyAddress, setBusyAddress] = useState<string | null>(null);

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
        const preferredTarget = row.walletName
          ? solWallets.find(
              (w) =>
                w.adapter.name.toLowerCase() === row.walletName!.toLowerCase(),
            )
          : null;

        const candidates = preferredTarget
          ? [preferredTarget]
          : solWallets.filter(
              (w) => typeof (w.adapter as { autoConnect?: () => Promise<void> }).autoConnect === "function",
            );

        for (const candidate of candidates) {
          try {
            const adapter = candidate.adapter;
            selectSolWallet(adapter.name);

            // Already on the right address — nothing to do.
            if (adapter.publicKey?.toBase58() === row.address) {
              recordLastUsedWallet({
                address: row.address,
                chain: "solana",
                walletName: adapter.name,
              });
              onOpenChange(false);
              return;
            }

            // If the adapter is currently connected to a *different* address
            // (typical when "Switch wallet" is pressed), we have to disconnect
            // first — Phantom won't show its account picker otherwise.
            const wasConnected = !!adapter.publicKey;
            if (wasConnected) {
              try {
                await adapter.disconnect();
              } catch {
                /* ignore */
              }
            }

            // Try a silent reconnect first (works when the site is already
            // trusted for the target address). If that lands on the wrong
            // address, fall through to the explicit `connect()` which opens
            // Phantom's account picker.
            const tryAutoConnect =
              !wasConnected &&
              typeof (adapter as { autoConnect?: () => Promise<void> }).autoConnect === "function";
            if (tryAutoConnect) {
              try {
                await (adapter as { autoConnect: () => Promise<void> }).autoConnect();
                if (adapter.publicKey?.toBase58() === row.address) {
                  recordLastUsedWallet({
                    address: row.address,
                    chain: "solana",
                    walletName: adapter.name,
                  });
                  onOpenChange(false);
                  return;
                }
                // Wrong address — disconnect so the explicit connect can prompt.
                try {
                  await adapter.disconnect();
                } catch {
                  /* ignore */
                }
              } catch {
                /* fall through to explicit connect */
              }
            }

            // Explicit connect — Phantom will surface its account picker so
            // the user can switch to the registered address. We close the
            // chooser optimistically so its overlay doesn't block the popup.
            onOpenChange(false);
            await adapter.connect();
            recordLastUsedWallet({
              address: adapter.publicKey?.toBase58() ?? row.address,
              chain: "solana",
              walletName: adapter.name,
            });
            return;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (/user rejected|user cancel|user closed/i.test(msg)) {
              return;
            }
          }
        }

        toast.error("Couldn't reconnect that wallet", {
          description: row.walletName
            ? `${row.walletName} didn't silently reconnect to ${shortAddress(row.address)}.`
            : `No installed Solana wallet silently reconnected to ${shortAddress(row.address)}.`,
        });
        return;
      }

      // EVM branch
      const target = row.walletName
        ? evmConnectors.find(
            (c) => c.name.toLowerCase() === row.walletName!.toLowerCase(),
          )
        : null;
      if (target) {
        try {
          await connectEvm({ connector: target });
          recordLastUsedWallet({
            address: row.address,
            chain: "evm",
            walletName: target.name,
          });
          onOpenChange(false);
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/user rejected|user cancel|user closed/i.test(msg)) {
            // Connector not available (e.g. wallet uninstalled) — surface the
            // RainbowKit modal so they can pick another.
            openRainbowKit?.();
            onOpenChange(false);
          }
          return;
        }
      }
      openRainbowKit?.();
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't reconnect wallet", {
        description: e instanceof Error ? e.message : "Try the new-wallet button below.",
      });
    } finally {
      setBusyAddress(null);
    }
  };

  const handleNewSolana = () => {
    onOpenChange(false);
    setSolModalVisible(true);
  };

  const handleNewEvm = () => {
    onOpenChange(false);
    if (openRainbowKit) openRainbowKit();
    else toast.error("EVM wallet modal isn't ready yet");
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

        <p className="mt-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
          We never auto-reconnect — you stay in control.
        </p>
      </DialogContent>
    </Dialog>
  );
};