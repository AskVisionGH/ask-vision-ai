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
import { evmChainBadge, solanaBadge } from "@/lib/chain-badge";

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

  // Multi-chain rule: a user can have BOTH a Solana and an EVM wallet
  // connected at the same time. The header pill prefers showing the Solana
  // address (most users are SOL-first) and falls back to EVM. The full list
  // of connected wallets shows up in the dropdown.

  const activeAddress = publicKey?.toBase58() ?? (evmConnected ? evmAddress ?? null : null);
  const anyConnected = connected || evmConnected;
  const short = activeAddress
    ? `${activeAddress.slice(0, 4)}…${activeAddress.slice(-4)}`
    : "";

  // Chain badge — small coloured dot + 3-letter ticker so users instantly
  // see which network the connected wallet is on. Solana takes precedence
  // when both are connected.
  const chainBadge = connected
    ? solanaBadge()
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
