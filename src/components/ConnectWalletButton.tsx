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

interface Props {
  className?: string;
  size?: "default" | "lg";
}

/** Pill-shaped connect button matching Vision aesthetic. */
export const ConnectWalletButton = ({ className, size = "lg" }: Props) => {
  const [chooserOpen, setChooserOpen] = useState(false);
  const { connected, publicKey, disconnect, connecting, wallet } = useWallet();
  const { address: evmAddress, isConnected: evmConnected, connector: evmConnector } = useAccount();
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

  // The header pill prefers showing the Solana address (most users are
  // SOL-first) and falls back to the EVM address when only EVM is connected.
  const activeAddress = publicKey?.toBase58() ?? (evmConnected ? evmAddress ?? null : null);
  const anyConnected = connected || evmConnected;
  const short = activeAddress
    ? `${activeAddress.slice(0, 4)}…${activeAddress.slice(-4)}`
    : "";

  if (anyConnected) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size={size}
              className={cn(
                "rounded-full font-mono text-xs tracking-wide bg-secondary text-foreground hover:bg-muted border border-border ease-vision",
                className,
              )}
            >
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
