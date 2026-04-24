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
import { useWalletAutoLink } from "@/hooks/useWalletAutoLink";
import { toast } from "@/hooks/use-toast";

const shortAddr = (addr: string) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

/**
 * Renders a one-time prompt when the connected wallet is already linked
 * to a separate wallet-only account, offering to absorb that account's
 * data into the user's current account.
 */
export const WalletMergePrompt = () => {
  const { mergeCandidate, merging, acceptMerge, dismissMerge } = useWalletAutoLink();
  const open = !!mergeCandidate;

  const onConfirm = async () => {
    const res = await acceptMerge();
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
    <Dialog open={open} onOpenChange={(o) => !o && !merging && dismissMerge()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge wallet account?</DialogTitle>
          <DialogDescription>
            We noticed the wallet{" "}
            <span className="font-mono text-foreground">
              {mergeCandidate ? shortAddr(mergeCandidate.walletAddress) : ""}
            </span>{" "}
            was previously used to sign in directly, creating a separate account.
            Merge it into your current account so your old chats, contacts and
            tracked wallets all live in one place.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={dismissMerge} disabled={merging}>
            Not now
          </Button>
          <Button onClick={onConfirm} disabled={merging}>
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
