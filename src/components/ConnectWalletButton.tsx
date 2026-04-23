import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  size?: "default" | "lg";
}

/** Pill-shaped connect button matching Vision aesthetic. */
export const ConnectWalletButton = ({ className, size = "lg" }: Props) => {
  const { setVisible } = useWalletModal();
  const { connected, publicKey, disconnect, connecting } = useWallet();

  const short = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : "";

  if (connected) {
    return (
      <Button
        onClick={() => disconnect()}
        size={size}
        className={cn(
          "rounded-full font-mono text-xs tracking-wide bg-secondary text-foreground hover:bg-muted border border-border ease-vision",
          className,
        )}
      >
        {short}
      </Button>
    );
  }

  return (
    <Button
      onClick={() => setVisible(true)}
      disabled={connecting}
      size={size}
      className={cn(
        "rounded-full font-medium px-7 bg-primary text-primary-foreground hover:bg-primary/90 ease-vision shadow-glow",
        className,
      )}
    >
      {connecting ? "Connecting…" : "Connect wallet to begin"}
    </Button>
  );
};
