import { useEffect, useMemo, useState } from "react";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AlertTriangle, Check, Copy, Eye, EyeOff, Import, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

type Chain = "solana" | "ethereum";

interface GeneratedWallet {
  publicKey: string;
  secretKey: string;
}

/**
 * Generate a brand-new wallet (Solana or Ethereum) entirely in the browser,
 * show the private key + public key once, and require explicit confirmation
 * that the user has saved them before letting them continue.
 *
 * Security model:
 * - Solana: `Keypair.generate()` → `crypto.getRandomValues` under the hood.
 * - Ethereum: viem's `generatePrivateKey()` → also CSPRNG.
 * - The secret never touches the network. We never POST it anywhere, never
 *   write it to localStorage, and discard the in-memory copy when the
 *   dialog closes (React unmount).
 * - User must check "I've saved my private key" before the Done button
 *   becomes enabled. There is no recovery — losing the key = losing funds.
 */
export const CreateWalletDialog = ({ open, onOpenChange, onDone }: Props) => {
  const [chain, setChain] = useState<Chain>("solana");

  // Generate a fresh wallet whenever the dialog opens OR the user switches
  // chain. Memoizing on (open, chain) ensures a brand-new key per cycle and
  // prevents re-generating on every render.
  const wallet: GeneratedWallet | null = useMemo(() => {
    if (!open) return null;
    if (chain === "solana") {
      const kp = Keypair.generate();
      return {
        publicKey: kp.publicKey.toBase58(),
        secretKey: bs58.encode(kp.secretKey),
      };
    }
    // Ethereum: viem returns 0x-prefixed hex private key + derives address.
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    return { publicKey: account.address, secretKey: pk };
  }, [open, chain]);

  const publicKey = wallet?.publicKey ?? "";
  const secretKey = wallet?.secretKey ?? "";

  const [revealed, setRevealed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset reveal/ack state every time the dialog re-opens OR chain changes
  // so we never bleed confirmation across separate wallet creations.
  useEffect(() => {
    if (open) {
      setRevealed(false);
      setAcknowledged(false);
    }
  }, [open, chain]);

  // Reset chain selection on close so reopening starts fresh on Solana.
  useEffect(() => {
    if (!open) setChain("solana");
  }, [open]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy", { description: "Select and copy manually." });
    }
  };

  const isSol = chain === "solana";
  const secretLabel = isSol ? "Private key (base58)" : "Private key (hex)";
  const walletApps = isSol
    ? "Phantom, Solflare, or Backpack"
    : "MetaMask, Rabby, or Rainbow";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            Your new {isSol ? "Solana" : "Ethereum"} wallet
          </DialogTitle>
          <DialogDescription>
            Generated locally in your browser. We never see or store your
            private key — if you lose it, your funds are gone forever.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Chain selector */}
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Network
            </label>
            <div className="grid grid-cols-2 gap-2">
              <ChainOption
                label="Solana"
                sublabel="SOL · SPL tokens"
                active={chain === "solana"}
                onClick={() => setChain("solana")}
              />
              <ChainOption
                label="Ethereum"
                sublabel="ETH · EVM chains"
                active={chain === "ethereum"}
                onClick={() => setChain("ethereum")}
              />
            </div>
            {!isSol && (
              <p className="text-[11px] text-muted-foreground/70">
                Same address works on Ethereum, Base, Arbitrum, Optimism, and
                other EVM chains.
              </p>
            )}
          </div>

          {/* Public address — safe to share */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">
                Public address
              </label>
              <button
                type="button"
                onClick={() => copy(publicKey, "Address")}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
            </div>
            <div className="rounded-lg border border-border bg-card/30 p-3 font-mono text-xs break-all">
              {publicKey}
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Safe to share — this is your wallet's public identity.
            </p>
          </div>

          {/* Private key — danger zone */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs uppercase tracking-wider text-destructive">
                {secretLabel}
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {revealed ? (
                    <>
                      <EyeOff className="h-3 w-3" /> Hide
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" /> Reveal
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => copy(secretKey, "Private key")}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  disabled={!revealed}
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              </div>
            </div>
            <div
              className={cn(
                "rounded-lg border p-3 font-mono text-xs break-all transition-colors",
                revealed
                  ? "border-destructive/50 bg-destructive/5"
                  : "border-border bg-card/30 select-none",
              )}
            >
              {revealed ? secretKey : "•".repeat(64)}
            </div>
          </div>

          {/* Warning + acknowledgement */}
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="space-y-2 text-xs text-foreground/90">
                <p>
                  <strong>Save it now.</strong> Paste it into a password
                  manager or write it down on paper. We have no copy and
                  cannot recover it for you.
                </p>
                <p className="text-muted-foreground">
                  Anyone with this key can drain your wallet. Never share it
                  with support, in chats, or paste into untrusted sites.
                </p>
              </div>
            </div>
          </div>

          {/* How to actually use this wallet */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex gap-2">
              <Import className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="space-y-2 text-xs text-foreground/90">
                <p>
                  <strong>Next step: import it into a wallet app.</strong> This
                  key on its own can't sign transactions — you need a wallet
                  like <strong>{walletApps}</strong> to use it.
                </p>
                <p className="text-muted-foreground">
                  In your wallet app, choose{" "}
                  <em>Add / Import wallet → Import private key</em> and paste
                  the key above. Then come back and connect it here.
                </p>
              </div>
            </div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm text-foreground">
              I've saved my private key somewhere safe. I understand it
              cannot be recovered if lost.
            </span>
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onDone();
              onOpenChange(false);
            }}
            disabled={!acknowledged}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Check className="mr-1.5 h-4 w-4" />
            I'm done — close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ChainOption = ({
  label,
  sublabel,
  active,
  onClick,
}: {
  label: string;
  sublabel: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "rounded-lg border px-3 py-2 text-left ease-vision",
      active
        ? "border-primary/60 bg-primary/10"
        : "border-border bg-card/30 hover:border-primary/30 hover:bg-card",
    )}
  >
    <div className={cn("text-sm font-medium", active ? "text-foreground" : "text-foreground/90")}>
      {label}
    </div>
    <div className="text-[11px] text-muted-foreground">{sublabel}</div>
  </button>
);
