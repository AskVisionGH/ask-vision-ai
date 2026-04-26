import { useEffect, useMemo, useState } from "react";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
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

/**
 * Generate a brand-new Solana keypair entirely in the browser, show the
 * private key + public key once, and require explicit confirmation that the
 * user has saved them before letting them continue.
 *
 * Security model:
 * - Keypair is generated client-side via `Keypair.generate()` (uses
 *   `crypto.getRandomValues` under the hood — cryptographically secure).
 * - The secret never touches the network. We never POST it anywhere, never
 *   write it to localStorage, and discard the in-memory copy when the
 *   dialog closes (React unmount).
 * - User must check "I've saved my private key" before the Done button
 *   becomes enabled. There is no recovery — losing the key = losing funds.
 */
export const CreateWalletDialog = ({ open, onOpenChange, onDone }: Props) => {
  // Generate exactly once when the dialog opens. Memoizing on `open` ensures
  // a fresh key for each open cycle (e.g. user closes + reopens) and prevents
  // re-generating on every render.
  const keypair = useMemo(() => (open ? Keypair.generate() : null), [open]);
  const publicKey = keypair?.publicKey.toBase58() ?? "";
  const secretKeyB58 = useMemo(
    () => (keypair ? bs58.encode(keypair.secretKey) : ""),
    [keypair],
  );

  const [revealed, setRevealed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset reveal/ack state every time the dialog re-opens so we never bleed
  // confirmation across separate wallet creations.
  useEffect(() => {
    if (open) {
      setRevealed(false);
      setAcknowledged(false);
    }
  }, [open]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy", { description: "Select and copy manually." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            Your new Solana wallet
          </DialogTitle>
          <DialogDescription>
            Generated locally in your browser. We never see or store your
            private key — if you lose it, your funds are gone forever.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
                Private key (base58)
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
                  onClick={() => copy(secretKeyB58, "Private key")}
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
              {revealed ? secretKeyB58 : "•".repeat(64)}
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
                  like <strong>Phantom</strong>, <strong>Solflare</strong>, or{" "}
                  <strong>Backpack</strong> to use it.
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
