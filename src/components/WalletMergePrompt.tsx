import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import type { MergeCandidate } from "@/hooks/useWalletAutoLink";

const shortAddr = (addr: string) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

interface Props {
  candidate: MergeCandidate | null;
  merging: boolean;
  onAccept: () => Promise<{ ok: boolean; error?: string }>;
  onDismiss: () => void;
}

/**
 * Renders a one-time prompt when the connected wallet is already linked
 * to a separate wallet-only account, offering to absorb that account's
 * data into the user's current account.
 */
export const WalletMergePrompt = ({ candidate, merging, onAccept, onDismiss }: Props) => {
  const open = !!candidate;

  const handleConfirm = async () => {
    const res = await onAccept();
    if (res.ok) {
      toast({
        title: "Accounts merged",
        description: "Your old wallet account's chats and contacts now live in this account.",
      });
    } else {
      toast({
        title: "Merge failed",
        description: res.error ?? "Please try again or contact support.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !merging && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge wallet account?</DialogTitle>
          <DialogDescription>
            We noticed the wallet{" "}
            <span className="font-mono text-foreground">
              {candidate ? shortAddr(candidate.walletAddress) : ""}
            </span>{" "}
            was previously used to sign in directly, creating a separate account.
            Merge it into your current account so your old chats, contacts and
            tracked wallets all live in one place.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss} disabled={merging}>
            Not now
          </Button>
          <Button onClick={handleConfirm} disabled={merging}>
            {merging ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Merging…
              </>
            ) : (
              "Merge accounts"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
