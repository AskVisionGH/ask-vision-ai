import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWalletPicker } from "@/components/WalletPicker";
import { LogOut, Repeat } from "lucide-react";

interface Props {
  className?: string;
  size?: "default" | "lg";
}

/** Pill-shaped connect button matching Vision aesthetic. */
export const ConnectWalletButton = ({ className, size = "lg" }: Props) => {
  const { open, Picker } = useWalletPicker();
  const { connected, publicKey, disconnect, connecting } = useWallet();

  const short = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : "";

  if (connected) {
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
                // Disconnect the current wallet first so the picker doesn't
                // immediately reconnect to it. Then open the wallet picker.
                try { await disconnect(); } catch { /* ignore */ }
                open();
              }}
            >
              <Repeat className="mr-2 h-3.5 w-3.5" />
              Switch wallet
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => disconnect()}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {Picker}
      </>
    );
  }

  return (
    <>
      <Button
        onClick={open}
        disabled={connecting}
        size={size}
        className={cn(
          "rounded-full font-medium px-7 bg-primary text-primary-foreground hover:bg-primary/90 ease-vision shadow-glow",
          className,
        )}
      >
        {connecting ? "Connecting…" : "Connect wallet to begin"}
      </Button>
      {Picker}
    </>
  );
};
