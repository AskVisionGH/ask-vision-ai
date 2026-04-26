import { useEffect, useMemo, useState } from "react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  useAccount,
  useConnect,
  useConnectors,
  useDisconnect as useEvmDisconnect,
} from "wagmi";
import { Loader2, Wallet, History as HistoryIcon, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  detectWalletChain,
  readLastUsedWallets,
  shortAddress,
  type LastUsedWallet,
  type WalletChain,
} from "@/lib/wallet-history";
import { cn } from "@/lib/utils";

/**
 * Flat wallet chooser.
 *
 * Top section: previously used / registered wallets (one-tap reconnect).
 * Bottom section: every wallet we support across chains. Clicking a wallet
 * directly opens that wallet's extension/app — the user picks the chain &
 * account inside the wallet itself.
 *
 * Chain selection is intentionally NOT split here: most wallets (Phantom,
 * Coinbase, Trust, MetaMask, Rabby, WalletConnect) support multiple chains,
 * and forcing the user to pre-pick a chain in our UI causes wrong-network
 * mismatches.
 */

interface LinkedWallet {
  address: string;
  chain: WalletChain;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type WalletKind = "solana" | "evm" | "walletconnect-evm" | "walletconnect-solana";

interface SupportedWallet {
  /** Stable id used by the row (also used as React key). */
  id: string;
  label: string;
  blurb: string;
  kind: WalletKind;
  /** Adapter / connector matcher — case-insensitive substring on `name`. */
  match: (name: string) => boolean;
}

// Canonical list of wallets we support. Each wallet appears ONCE; if it
// supports both ecosystems (Phantom, Coinbase, Trust) we let the wallet
// itself pick the chain after the user opens it.
const SUPPORTED_WALLETS: SupportedWallet[] = [
  {
    id: "phantom",
    label: "Phantom",
    blurb: "Solana · Ethereum",
    kind: "solana",
    match: (n) => n === "phantom",
  },
  {
    id: "solflare",
    label: "Solflare",
    blurb: "Solana",
    kind: "solana",
    match: (n) => n === "solflare",
  },
  {
    id: "backpack",
    label: "Backpack",
    blurb: "Solana",
    kind: "solana",
    match: (n) => n === "backpack",
  },
  {
    id: "coinbase",
    label: "Coinbase Wallet",
    blurb: "Solana · Ethereum",
    kind: "solana",
    match: (n) => n === "coinbase wallet",
  },
  {
    id: "trust",
    label: "Trust Wallet",
    blurb: "Solana · Ethereum",
    kind: "solana",
    match: (n) => n === "trust" || n === "trust wallet",
  },
  {
    id: "metamask",
    label: "MetaMask",
    blurb: "Ethereum & EVM chains",
    kind: "evm",
    match: (n) => n === "metamask",
  },
  {
    id: "rabby",
    label: "Rabby",
    blurb: "Ethereum & EVM chains",
    kind: "evm",
    match: (n) => n === "rabby wallet" || n === "rabby",
  },
  {
    id: "rainbow",
    label: "Rainbow",
    blurb: "Ethereum & EVM chains",
    kind: "evm",
    match: (n) => n === "rainbow",
  },
  {
    id: "walletconnect",
    label: "WalletConnect",
    blurb: "Scan with any mobile wallet",
    kind: "walletconnect-evm",
    match: (n) => n.includes("walletconnect"),
  },
];

export const WalletChooser = ({ open, onOpenChange }: Props) => {
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingSolanaWalletName, setPendingSolanaWalletName] =
    useState<WalletName | null>(null);
  const [search, setSearch] = useState("");

  // ---------------------------------------------------------------------------
  // Solana two-step handoff. `select()` is async via state, so we wait until
  // the chosen adapter is reflected in `selectedSolWallet`, then `connect()`.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!pendingSolanaWalletName) return;
    if (selectedSolWallet?.adapter.name !== pendingSolanaWalletName) return;
    if (solConnected || solConnecting) return;

    let cancelled = false;
    void (async () => {
      try {
        await connectSolWallet();
        if (!cancelled) onOpenChange(false);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (!/user rejected|user cancel|user closed/i.test(msg)) {
          toast.error("Couldn't open that wallet", { description: msg });
        }
      } finally {
        if (!cancelled) {
          setPendingSolanaWalletName(null);
          setBusyId(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    pendingSolanaWalletName,
    selectedSolWallet?.adapter.name,
    solConnected,
    solConnecting,
    connectSolWallet,
    onOpenChange,
  ]);

  // Reset transient state when the chooser closes.
  useEffect(() => {
    if (!open) {
      setBusyId(null);
      setPendingSolanaWalletName(null);
      setSearch("");
    }
  }, [open]);

  // Refresh recent + linked rows every time the chooser opens.
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

  // ---------------------------------------------------------------------------
  // Recent + registered (deduped) — the top section. Each row tries to resolve
  // a wallet brand from history so we can re-open the same wallet directly.
  // ---------------------------------------------------------------------------
  type RecentRow = {
    address: string;
    chain: WalletChain;
    walletName?: string;
    source: "linked" | "recent";
    isActive: boolean;
  };

  const recentRows: RecentRow[] = useMemo(() => {
    const activeSol =
      solConnected && solPublicKey ? solPublicKey.toBase58() : null;
    const activeEvm =
      evmConnected && evmAddress ? evmAddress.toLowerCase() : null;
    const recentByKey = new Map<string, LastUsedWallet>(
      recent.map((r) => [`${r.chain}:${r.address.toLowerCase()}`, r]),
    );
    const seen = new Set<string>();
    const out: RecentRow[] = [];

    for (const l of linked) {
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
  }, [linked, recent, solConnected, solPublicKey, evmConnected, evmAddress]);

  // ---------------------------------------------------------------------------
  // Click handlers
  // ---------------------------------------------------------------------------
  const openSolanaAdapter = async (walletName: WalletName, busyKey: string) => {
    setBusyId(busyKey);
    try {
      const isSameAdapter = selectedSolWallet?.adapter.name === walletName;
      if (solConnected) {
        try { await disconnectSolWallet(); } catch { /* ignore */ }
      }
      // wallet-adapter ignores `select(name)` if it matches the current
      // adapter; clear first so same-wallet reconnects (Phantom→Phantom) work.
      if (isSameAdapter) {
        selectSolWallet(null);
        await new Promise((r) => setTimeout(r, 0));
      }
      setPendingSolanaWalletName(walletName);
      selectSolWallet(walletName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/user rejected|user cancel|user closed/i.test(msg)) {
        toast.error("Couldn't open that wallet", { description: msg });
      }
      setBusyId(null);
      setPendingSolanaWalletName(null);
    }
  };

  const openEvmConnector = async (connectorId: string, busyKey: string) => {
    const target = evmConnectors.find((c) => c.id === connectorId);
    if (!target) {
      toast.error("Wallet not detected", {
        description: "Install the extension and reload the page.",
      });
      return;
    }
    setBusyId(busyKey);
    try {
      if (evmConnected) {
        try { await disconnectEvm(); } catch { /* ignore */ }
      }
      await connectEvm({ connector: target });
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/user rejected|user cancel|user closed/i.test(msg)) {
        toast.error("Couldn't open that wallet", { description: msg });
      }
    } finally {
      setBusyId(null);
    }
  };

  /** Open a wallet by brand from the supported list. */
  const handleOpenWallet = async (w: SupportedWallet) => {
    const busyKey = `wallet:${w.id}`;

    if (w.kind === "solana") {
      const adapter = solWallets.find((sw) =>
        w.match(sw.adapter.name.toLowerCase()),
      );
      // Some Solana-capable wallets (Phantom, Coinbase, Trust) also expose
      // an EVM connector via wagmi. If the Solana adapter isn't installed
      // or detected, fall back to the EVM connector — the user can switch
      // chains inside the wallet.
      if (adapter) {
        await openSolanaAdapter(adapter.adapter.name, busyKey);
        return;
      }
      const evmFallback = evmConnectors.find((c) =>
        w.match(c.name.toLowerCase()),
      );
      if (evmFallback) {
        await openEvmConnector(evmFallback.id, busyKey);
        return;
      }
      toast.error(`${w.label} not detected`, {
        description: "Install the extension or app and reload the page.",
      });
      return;
    }

    if (w.kind === "walletconnect-evm") {
      const wc = evmConnectors.find((c) => w.match(c.name.toLowerCase()));
      if (wc) {
        await openEvmConnector(wc.id, busyKey);
        return;
      }
      toast.error("WalletConnect unavailable");
      return;
    }

    // EVM wallet
    const connector = evmConnectors.find((c) => w.match(c.name.toLowerCase()));
    if (!connector) {
      toast.error(`${w.label} not detected`, {
        description: "Install the extension and reload the page.",
      });
      return;
    }
    await openEvmConnector(connector.id, busyKey);
  };

  /** Reconnect a previously used / registered address by reopening the same
   *  wallet brand. Falls back to a brand-agnostic open if the wallet name
   *  isn't recorded. */
  const handleReconnectRecent = async (row: RecentRow) => {
    if (row.isActive) {
      onOpenChange(false);
      return;
    }
    const busyKey = `recent:${row.chain}:${row.address}`;
    const knownName = (row.walletName ?? "").toLowerCase().trim();
    const supported = knownName
      ? SUPPORTED_WALLETS.find((w) => w.match(knownName))
      : undefined;

    if (supported) {
      // Reopen the same brand directly so the extension shows its account
      // picker for the right wallet.
      await handleOpenWallet({ ...supported, id: `${supported.id}` });
      return;
    }

    // Unknown brand → for Solana we can still open the standard adapter list
    // by chain; for EVM we open the first matching connector. As a last
    // resort, just toast and let the user pick from the list below.
    if (row.chain === "solana") {
      const adapter = solWallets[0];
      if (adapter) {
        await openSolanaAdapter(adapter.adapter.name, busyKey);
        return;
      }
    } else {
      const connector = evmConnectors[0];
      if (connector) {
        await openEvmConnector(connector.id, busyKey);
        return;
      }
    }

    toast.info("Pick a wallet from the list below to reconnect.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-md flex-col overflow-hidden rounded-2xl border-border bg-card p-0 sm:max-h-[calc(100vh-4rem)]">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle className="text-center text-lg font-light">
            Choose a wallet
          </DialogTitle>
          <DialogDescription className="text-center text-xs text-muted-foreground">
            Reuse a previous wallet, or pick one from the list to open it.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {/* Recent / registered */}
        <div className="mt-2 space-y-1.5">
          {loadingLinked ? (
            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Loading your wallets…
            </div>
          ) : (
            recentRows.map((row) => {
              const busyKey = `recent:${row.chain}:${row.address}`;
              const isBusy = busyId === busyKey;
              return (
                <button
                  key={`${row.chain}:${row.address}`}
                  type="button"
                  disabled={!!busyId}
                  onClick={() => handleReconnectRecent(row)}
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
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest",
                          row.chain === "solana"
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-accent/40 bg-accent/10 text-accent-foreground",
                        )}
                      >
                        {row.chain === "solana" ? "Solana" : "EVM"}
                      </span>
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
                  {isBusy && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Divider label */}
        <div className="mt-4 flex items-center gap-2">
          <div className="h-px flex-1 bg-border/60" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
            All supported wallets
          </span>
          <div className="h-px flex-1 bg-border/60" />
        </div>

        {/* Flat wallet list */}
        <div className="mt-3 grid grid-cols-1 gap-1.5">
          {SUPPORTED_WALLETS.map((w) => {
            const busyKey = `wallet:${w.id}`;
            const isBusy = busyId === busyKey;
            return (
              <button
                key={w.id}
                type="button"
                disabled={!!busyId}
                onClick={() => handleOpenWallet(w)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border border-border/60 bg-secondary/40 px-3 py-2.5 text-left transition-all ease-vision",
                  "hover:border-primary/40 hover:bg-secondary disabled:opacity-60",
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Wallet className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {w.label}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] uppercase tracking-widest text-muted-foreground/70">
                    {w.blurb}
                  </div>
                </div>
                {isBusy && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
          We never auto-reconnect — you stay in control.
        </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
