import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Compass, Plus, Wallet2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { CreateWalletDialog } from "@/components/CreateWalletDialog";
import { cn } from "@/lib/utils";

const STORAGE_PREFIX = "vision:wallet-prompt-dismissed:";

interface Props {
  /** True once we've confirmed the user has zero linked wallets in the DB. */
  needsWallet: boolean;
}

/**
 * One-time prompt shown to email/password signups (no OAuth, no wallet) the
 * first time they reach /chat. Encourages them to either connect an existing
 * wallet, generate a brand-new one in-browser, or skip for now.
 *
 * Dismissal is tracked per-user in localStorage (`vision:wallet-prompt-dismissed:<uid>`)
 * so we don't nag the same person every visit. If they connect or create a
 * wallet, we record dismissal automatically.
 */
export const WalletOnboardingPrompt = ({ needsWallet }: Props) => {
  const { user } = useAuth();
  const { setVisible } = useWalletModal();
  const { connected } = useWallet();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // `app_metadata.provider` is "email" for email/password signups and
  // "google" / "apple" / etc. for OAuth. We only nag email signups because
  // OAuth users are typically Web2-natives we want to drip-educate, while
  // wallet-adapter signins already have a wallet by definition.
  const provider = user?.app_metadata?.provider;
  const isEmailSignup = provider === "email";

  const storageKey = user ? `${STORAGE_PREFIX}${user.id}` : null;

  useEffect(() => {
    if (!user || !storageKey) return;
    if (!isEmailSignup) return;
    if (!needsWallet) return;
    if (connected) return;
    // Already dismissed in a previous session for this user.
    if (typeof window !== "undefined" && window.localStorage.getItem(storageKey)) {
      return;
    }
    // Small delay so the modal doesn't slam in over the chat fade-in.
    const t = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(t);
  }, [user, storageKey, isEmailSignup, needsWallet, connected]);

  // If the user connects a wallet at any point (via this prompt or otherwise),
  // mark dismissed and close.
  useEffect(() => {
    if (!storageKey) return;
    if (connected) {
      window.localStorage.setItem(storageKey, "connected");
      setOpen(false);
    }
  }, [connected, storageKey]);

  const dismiss = (reason: "skip" | "connect" | "create") => {
    if (storageKey) window.localStorage.setItem(storageKey, reason);
    setOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismiss("skip"))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unlock the full Vision</DialogTitle>
            <DialogDescription>
              You can chat without one, but a wallet lets you swap, send, and
              act on what we find together. Pick what fits.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 pt-2">
            <PromptOption
              icon={<Wallet2 className="h-5 w-5" />}
              title="Connect existing wallet"
              description="Phantom, Solflare, Backpack — the usual suspects."
              onClick={() => {
                dismiss("connect");
                // Wallet adapter modal handles the rest. If they actually
                // connect, the `connected` effect above will also persist
                // dismissal.
                setVisible(true);
              }}
              accent
            />
            <PromptOption
              icon={<Plus className="h-5 w-5" />}
              title="Create a new wallet"
              description="Generated in your browser. We never see the private key."
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
            />
            <PromptOption
              icon={<Compass className="h-5 w-5" />}
              title="Browse without a wallet"
              description="Look around first. You can connect later from the top bar."
              onClick={() => dismiss("skip")}
            />
          </div>
        </DialogContent>
      </Dialog>

      <CreateWalletDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onDone={() => dismiss("create")}
      />
    </>
  );
};

const PromptOption = ({
  icon,
  title,
  description,
  onClick,
  accent = false,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  accent?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left ease-vision",
      accent
        ? "border-primary/40 bg-primary/5 hover:border-primary/60 hover:bg-primary/10"
        : "border-border bg-card/30 hover:border-primary/30 hover:bg-card",
    )}
  >
    <span
      className={cn(
        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
        accent ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground",
      )}
    >
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
    </div>
  </button>
);
