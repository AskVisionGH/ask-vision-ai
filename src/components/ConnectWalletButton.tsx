import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAccount, useDisconnect as useEvmDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { WalletChooser } from "@/components/WalletChooser";
import { recordLastUsedWallet } from "@/lib/wallet-history";
import { LogOut, Repeat } from "lucide-react";

// EVM chain id → 3-letter ticker + brand-ish dot colour. Kept in-file
// because it's only used for the header pill badge.
const evmChainBadge = (chainId: number | undefined): { label: string; dotClass: string } => {
  switch (chainId) {
    case 1: return { label: "ETH", dotClass: "bg-[#627EEA]" };
    case 42161: return { label: "ARB", dotClass: "bg-[#28A0F0]" };
    case 10: return { label: "OPT", dotClass: "bg-[#FF0420]" };
    case 8453: return { label: "BAS", dotClass: "bg-[#0052FF]" };
    case 137: return { label: "POL", dotClass: "bg-[#8247E5]" };
    case 56: return { label: "BSC", dotClass: "bg-[#F0B90B]" };
    case 43114: return { label: "AVA", dotClass: "bg-[#E84142]" };
    case 59144: return { label: "LIN", dotClass: "bg-[#61DFFF]" };
    case 534352: return { label: "SCR", dotClass: "bg-[#FFEEDA]" };
    case 324: return { label: "ZKS", dotClass: "bg-[#8C8DFC]" };
    default: return { label: "EVM", dotClass: "bg-muted-foreground" };
  }
};

interface Props {
  className?: string;
  size?: "default" | "lg";
}

/** Pill-shaped connect button matching Vision aesthetic. */
export const ConnectWalletButton = ({ className, size = "lg" }: Props) => {
  const [chooserOpen, setChooserOpen] = useState(false);
  const { connected, publicKey, disconnect, connecting, wallet } = useWallet();
  const { address: evmAddress, isConnected: evmConnected, connector: evmConnector, chainId: evmChainId } = useAccount();
  const { disconnect: evmDisconnect } = useEvmDisconnect();

  // Persist successful connects to the "last used" history so the chooser
  // can offer one-click reconnects on future visits.
  useEffect(() => {
    if (connected && publicKey && wallet?.adapter?.name) {
      recordLastUsedWallet({
        address: publicKey.toBase58(),
        chain: "solana",
        walletName: wallet.adapter.name,
      });
    }
  }, [connected, publicKey, wallet?.adapter?.name]);
  useEffect(() => {
    if (evmConnected && evmAddress && evmConnector?.name) {
      recordLastUsedWallet({
        address: evmAddress.toLowerCase(),
        chain: "evm",
        walletName: evmConnector.name,
      });
    }
  }, [evmConnected, evmAddress, evmConnector?.name]);

  // Single-wallet invariant: the app must only ever have one chain connected.
  // If both ever end up live (e.g. lingering EVM session from a prior visit
  // when the user reconnects Solana), drop the EVM one. Solana is treated as
  // primary because the rest of the app is SOL-first.
  useEffect(() => {
    if (connected && evmConnected) {
      try { evmDisconnect(); } catch { /* ignore */ }
    }
  }, [connected, evmConnected, evmDisconnect]);

  // The header pill prefers showing the Solana address (most users are
  // SOL-first) and falls back to the EVM address when only EVM is connected.
  const activeAddress = publicKey?.toBase58() ?? (evmConnected ? evmAddress ?? null : null);
  const anyConnected = connected || evmConnected;
  const short = activeAddress
    ? `${activeAddress.slice(0, 4)}…${activeAddress.slice(-4)}`
    : "";

  // Chain badge — small coloured dot + 3-letter ticker so users instantly
  // see which network the connected wallet is on. Solana takes precedence
  // because of the single-wallet invariant above.
  const chainBadge: { label: string; dotClass: string } | null = connected
    ? { label: "SOL", dotClass: "bg-[#14F195]" }
    : evmConnected
      ? evmChainBadge(evmChainId)
      : null;


  if (anyConnected) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size={size}
              className={cn(
                "rounded-full font-mono text-xs tracking-wide bg-secondary text-foreground hover:bg-muted border border-border ease-vision gap-2",
                className,
              )}
            >
              {chainBadge && (
                <span className="flex items-center gap-1.5 pr-1.5 mr-0.5 border-r border-border/60">
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", chainBadge.dotClass)}
                    aria-hidden
                  />
                  <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">
                    {chainBadge.label}
                  </span>
                </span>
              )}
              {short}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onClick={async () => {
                // Open the chooser without dropping the current connection —
                // the user can pick another linked address or hit a
                // "Connect new" CTA. Disconnect happens implicitly when they
                // pick a different wallet.
                setChooserOpen(true);
              }}
            >
              <Repeat className="mr-2 h-3.5 w-3.5" />
              Switch wallet
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                try { if (connected) await disconnect(); } catch { /* ignore */ }
                try { if (evmConnected) evmDisconnect(); } catch { /* ignore */ }
              }}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <WalletChooser open={chooserOpen} onOpenChange={setChooserOpen} />
      </>
    );
  }

  return (
    <>
      <Button
        onClick={() => setChooserOpen(true)}
        disabled={connecting}
        size={size}
        className={cn(
          "rounded-full font-medium px-7 bg-primary text-primary-foreground hover:bg-primary/90 ease-vision shadow-glow",
          className,
        )}
      >
        {connecting ? "Connecting…" : "Connect wallet to begin"}
      </Button>
      <WalletChooser open={chooserOpen} onOpenChange={setChooserOpen} />
    </>
  );
};
