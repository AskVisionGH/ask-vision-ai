import { useVisionWallet } from "@/hooks/useVisionWallet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";

/**
 * Vision Wallet card — one-click create, fully managed by our backend
 * via Privy Server Wallets. No email codes, no iframes.
 */
export const VisionWalletCard = () => {
  const { loading, working, solanaAddress, evmAddress, createWallet } =
    useVisionWallet();

  const handleCreate = async () => {
    try {
      await createWallet();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create wallet",
      );
    }
  };

  const hasWallet = Boolean(solanaAddress || evmAddress);
  const isComplete = Boolean(solanaAddress && evmAddress);

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2 mb-2">
        <Wallet className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Vision Wallet</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        One magic wallet that trades on every chain — no extension, no seed
        phrase. Managed securely for you.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : hasWallet ? (
        <div className="space-y-4">
          {solanaAddress && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                Solana
              </Label>
              <p className="font-mono text-sm break-all">{solanaAddress}</p>
            </div>
          )}
          {evmAddress && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                Ethereum &amp; EVM chains
              </Label>
              <p className="font-mono text-sm break-all">{evmAddress}</p>
            </div>
          )}
          {!isComplete && (
            <Button
              onClick={handleCreate}
              disabled={working}
              variant="secondary"
            >
              {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Finish wallet setup
            </Button>
          )}
        </div>
      ) : (
        <Button onClick={handleCreate} disabled={working}>
          {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Vision Wallet
        </Button>
      )}
    </section>
  );
};
