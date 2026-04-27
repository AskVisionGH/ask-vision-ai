import { useState } from "react";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowDownToLine, Check, Copy, Loader2, Wallet } from "lucide-react";
import { FundVisionWalletDialog } from "@/components/wallet/FundVisionWalletDialog";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/**
 * Vision Wallet — accordion item that matches the rest of the Settings
 * menu styling. One-click create, fully managed by our backend via
 * Privy Server Wallets.
 */
export const VisionWalletCard = () => {
  const { loading, working, solanaAddress, evmAddress, createWallet } =
    useVisionWallet();
  const [copied, setCopied] = useState<"solana" | "evm" | null>(null);
  const [fundOpen, setFundOpen] = useState(false);

  const handleCreate = async () => {
    try {
      await createWallet();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create wallet",
      );
    }
  };

  const copy = async (label: "solana" | "evm", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const hasWallet = Boolean(solanaAddress || evmAddress);
  const isComplete = Boolean(solanaAddress && evmAddress);

  return (
    <AccordionItem
      value="vision-wallet"
      className="rounded-2xl border border-border bg-card/40 px-6 backdrop-blur-md"
    >
      <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline [&[data-state=open]]:pb-3">
        <span className="flex items-center gap-2">
          <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
          Vision Wallet
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-5">
        <p className="mb-4 text-xs text-muted-foreground">
          One magic wallet that trades on every chain — no extension, no seed
          phrase. Managed securely for you.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : hasWallet ? (
          <div className="space-y-4">
            {solanaAddress && (
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Solana
                </Label>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
                  <p className="flex-1 truncate font-mono text-xs text-foreground">
                    {solanaAddress}
                  </p>
                  <button
                    type="button"
                    onClick={() => copy("solana", solanaAddress)}
                    className="shrink-0 text-muted-foreground hover:text-foreground ease-vision"
                    aria-label="Copy Solana address"
                  >
                    {copied === "solana" ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )}
            {evmAddress && (
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Ethereum &amp; EVM chains
                </Label>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
                  <p className="flex-1 truncate font-mono text-xs text-foreground">
                    {evmAddress}
                  </p>
                  <button
                    type="button"
                    onClick={() => copy("evm", evmAddress)}
                    className="shrink-0 text-muted-foreground hover:text-foreground ease-vision"
                    aria-label="Copy EVM address"
                  >
                    {copied === "evm" ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )}
            {!isComplete && (
              <div className="flex justify-end">
                <Button
                  onClick={handleCreate}
                  disabled={working}
                  variant="outline"
                  size="sm"
                >
                  {working && (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  )}
                  Finish wallet setup
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={working} size="sm">
              {working && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Create Vision Wallet
            </Button>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
};
