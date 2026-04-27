import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Check, Copy, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useVisionWallet } from "@/hooks/useVisionWallet";

interface FundVisionWalletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which chain tab to focus first */
  defaultChain?: "solana" | "evm";
}

/**
 * FundVisionWalletDialog — shows the user's Vision Wallet deposit addresses
 * for Solana and EVM chains, with QR codes, copy buttons, and a live native
 * balance read for Solana. Users send funds to these addresses to top up.
 *
 * IMPORTANT: deposits are on-chain transfers from the user's *external*
 * source (CEX, other wallet) into the Vision Wallet. We do not initiate
 * anything — we just present the destination address.
 */
export function FundVisionWalletDialog({
  open,
  onOpenChange,
  defaultChain = "solana",
}: FundVisionWalletDialogProps) {
  const { solanaAddress, evmAddress, loading } = useVisionWallet();
  const { connection } = useConnection();
  const [copied, setCopied] = useState<"solana" | "evm" | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Live SOL balance — refreshes when dialog opens, then polls every 15s
  // while open so users see incoming deposits without manually refreshing.
  useEffect(() => {
    if (!open || !solanaAddress) return;
    let cancelled = false;
    const fetchBalance = async () => {
      try {
        setRefreshing(true);
        const owner = new PublicKey(solanaAddress);
        const lamports = await connection.getBalance(owner);
        if (!cancelled) setSolBalance(lamports / LAMPORTS_PER_SOL);
      } catch {
        if (!cancelled) setSolBalance(null);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };
    void fetchBalance();
    const id = window.setInterval(fetchBalance, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, solanaAddress, connection]);

  const copy = async (label: "solana" | "evm", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const initialTab =
    defaultChain === "evm" && evmAddress ? "evm" : "solana";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fund your Vision Wallet</DialogTitle>
          <DialogDescription>
            Send funds to one of these addresses from your exchange or
            another wallet. Deposits arrive in seconds on Solana, ~1–5
            minutes on EVM chains.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading wallet…
          </div>
        ) : !solanaAddress && !evmAddress ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p>
              Your Vision Wallet hasn't been created yet. Create it from
              the Vision Wallet panel in Settings before funding.
            </p>
          </div>
        ) : (
          <Tabs defaultValue={initialTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="solana" disabled={!solanaAddress}>
                Solana
              </TabsTrigger>
              <TabsTrigger value="evm" disabled={!evmAddress}>
                Ethereum &amp; EVM
              </TabsTrigger>
            </TabsList>

            {solanaAddress && (
              <TabsContent value="solana" className="space-y-4 pt-4">
                <div className="flex justify-center rounded-xl border border-border bg-white p-4">
                  <QRCodeSVG value={solanaAddress} size={180} level="M" />
                </div>
                <AddressBlock
                  label="Solana address"
                  value={solanaAddress}
                  copied={copied === "solana"}
                  onCopy={() => copy("solana", solanaAddress)}
                />
                <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">
                    Current SOL balance
                  </span>
                  <span className="font-mono text-foreground">
                    {solBalance === null ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      `${solBalance.toFixed(4)} SOL`
                    )}
                    {refreshing && solBalance !== null && (
                      <Loader2 className="ml-2 inline h-3 w-3 animate-spin opacity-50" />
                    )}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Send SOL or any SPL token (USDC, JUP, etc.) to this
                  address. Only use the <strong>Solana network</strong> —
                  funds sent on other chains will be lost.
                </p>
              </TabsContent>
            )}

            {evmAddress && (
              <TabsContent value="evm" className="space-y-4 pt-4">
                <div className="flex justify-center rounded-xl border border-border bg-white p-4">
                  <QRCodeSVG value={evmAddress} size={180} level="M" />
                </div>
                <AddressBlock
                  label="EVM address (works on all EVM chains)"
                  value={evmAddress}
                  copied={copied === "evm"}
                  onCopy={() => copy("evm", evmAddress)}
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Same address works on Ethereum, Base, Arbitrum, Polygon,
                  BSC, Optimism, and other EVM chains. Make sure you
                  select the correct network when sending — funds sent on
                  the wrong network may be lost.
                </p>
              </TabsContent>
            )}
          </Tabs>
        )}

        <div className="flex justify-end pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddressBlock({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
        <p className="flex-1 break-all font-mono text-xs text-foreground">
          {value}
        </p>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Copy address"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
