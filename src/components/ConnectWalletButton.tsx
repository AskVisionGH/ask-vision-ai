import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAccount, useDisconnect as useEvmDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { WalletChooser } from "@/components/WalletChooser";
import { FundVisionWalletDialog } from "@/components/wallet/FundVisionWalletDialog";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { recordLastUsedWallet } from "@/lib/wallet-history";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  Check,
  Copy,
  LogOut,
  Plus,
  Repeat,
  Sparkles,
} from "lucide-react";
import { evmChainBadge, solanaBadge } from "@/lib/chain-badge";

interface Props {
  className?: string;
  size?: "default" | "lg";
}

/**
 * Pill-shaped wallet button. Surfaces three things in priority order:
 *   1. A connected EXTERNAL wallet (Solana / EVM via wallet-adapter / wagmi)
 *   2. The user's VISION WALLET (managed, server-signed) when present
 *   3. A "Connect wallet" CTA for users with neither
 *
 * Vision Wallet is the recommended default for trading, so when the user
 * hasn't connected an external wallet but does have a Vision Wallet, we
 * show a "Vision Wallet active" pill that links to /trade and exposes the
 * deposit dialog — instead of pretending nothing is connected.
 */
export const ConnectWalletButton = ({ className, size = "lg" }: Props) => {
  const [chooserOpen, setChooserOpen] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const [copied, setCopied] = useState<"external" | "vision-sol" | "vision-evm" | null>(null);
  const { connected, publicKey, disconnect, connecting, wallet } = useWallet();
  const { address: evmAddress, isConnected: evmConnected, connector: evmConnector, chainId: evmChainId } = useAccount();
  const { disconnect: evmDisconnect } = useEvmDisconnect();
  const vision = useVisionWallet();
  const hasVision = Boolean(vision.solanaAddress || vision.evmAddress);

  // Persist successful connects to the "last used" history so the chooser
  // can offer one-click reconnects on future visits.
  useEffect(() => {
    if (connected && publicKey && wallet?.adapter?.name) {
      recordLastUsedWallet({
        address: publicKey.toBase58(),
        chain: "solana",
        walletName: wallet.adapter.name,
      });
    }
  }, [connected, publicKey, wallet?.adapter?.name]);
  useEffect(() => {
    if (evmConnected && evmAddress && evmConnector?.name) {
      recordLastUsedWallet({
        address: evmAddress.toLowerCase(),
        chain: "evm",
        walletName: evmConnector.name,
      });
    }
  }, [evmConnected, evmAddress, evmConnector?.name]);

  const copyTo = async (key: NonNullable<typeof copied>, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* ignore clipboard failures */
    }
  };

  const externalAddress = publicKey?.toBase58() ?? (evmConnected ? evmAddress ?? null : null);
  const externalConnected = connected || evmConnected;
  const shortExternal = externalAddress
    ? `${externalAddress.slice(0, 4)}…${externalAddress.slice(-4)}`
    : "";
  const shortVisionSol = vision.solanaAddress
    ? `${vision.solanaAddress.slice(0, 4)}…${vision.solanaAddress.slice(-4)}`
    : null;
  const shortVisionEvm = vision.evmAddress
    ? `${vision.evmAddress.slice(0, 4)}…${vision.evmAddress.slice(-4)}`
    : null;

  // Chain badge for the connected external wallet (Solana takes precedence
  // when both chains are active).
  const chainBadge = connected
    ? solanaBadge()
    : evmConnected
      ? evmChainBadge(evmChainId)
      : null;

  // ---------- 1. Connected external wallet ----------
  if (externalConnected) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size={size}
              className={cn(
                "rounded-full font-mono text-xs tracking-wide bg-secondary text-foreground hover:bg-muted border border-border ease-vision gap-2",
                className,
              )}
            >
              {chainBadge && (
                <span className="flex items-center gap-1.5 pr-1.5 mr-0.5 border-r border-border/60">
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", chainBadge.dotClass)}
                    aria-hidden
                  />
                  <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">
                    {chainBadge.label}
                  </span>
                </span>
              )}
              {shortExternal}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
              External wallet
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                if (externalAddress) void copyTo("external", externalAddress);
              }}
            >
              {copied === "external" ? (
                <Check className="mr-2 h-3.5 w-3.5 text-up" />
              ) : (
                <Copy className="mr-2 h-3.5 w-3.5" />
              )}
              {copied === "external" ? "Copied" : "Copy address"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setChooserOpen(true)}>
              <Repeat className="mr-2 h-3.5 w-3.5" />
              Switch wallet
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                try { if (connected) await disconnect(); } catch { /* ignore */ }
                try { if (evmConnected) evmDisconnect(); } catch { /* ignore */ }
              }}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Disconnect
            </DropdownMenuItem>

            {/* Always surface the user's Vision Wallet so they remember it
                exists — even when an external wallet is connected. */}
            {hasVision && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary">
                  <Sparkles className="h-3 w-3" /> Vision Wallet
                </DropdownMenuLabel>
                {shortVisionSol && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      if (vision.solanaAddress) void copyTo("vision-sol", vision.solanaAddress);
                    }}
                  >
                    {copied === "vision-sol" ? (
                      <Check className="mr-2 h-3.5 w-3.5 text-up" />
                    ) : (
                      <Copy className="mr-2 h-3.5 w-3.5" />
                    )}
                    SOL · {shortVisionSol}
                  </DropdownMenuItem>
                )}
                {shortVisionEvm && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      if (vision.evmAddress) void copyTo("vision-evm", vision.evmAddress);
                    }}
                  >
                    {copied === "vision-evm" ? (
                      <Check className="mr-2 h-3.5 w-3.5 text-up" />
                    ) : (
                      <Copy className="mr-2 h-3.5 w-3.5" />
                    )}
                    EVM · {shortVisionEvm}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setFundOpen(true)}>
                  <ArrowDownToLine className="mr-2 h-3.5 w-3.5" />
                  Deposit to Vision
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/trade">
                    <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                    Trade with Vision
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <WalletChooser open={chooserOpen} onOpenChange={setChooserOpen} />
        <FundVisionWalletDialog open={fundOpen} onOpenChange={setFundOpen} />
      </>
    );
  }

  // ---------- 2. Vision Wallet only (no external connected) ----------
  if (hasVision) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size={size}
              className={cn(
                "rounded-full font-mono text-xs tracking-wide bg-primary/15 text-primary hover:bg-primary/20 border border-primary/30 ease-vision gap-2",
                className,
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="flex items-center gap-1.5 pr-1.5 border-r border-primary/30">
                <span className="text-[10px] font-semibold tracking-wider">
                  VISION
                </span>
              </span>
              {shortVisionSol ?? shortVisionEvm}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" /> Vision Wallet — active
            </DropdownMenuLabel>
            <div className="px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground">
              Already linked to your account. Use it on /trade — no popups, one-click sign.
            </div>
            {shortVisionSol && (
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  if (vision.solanaAddress) void copyTo("vision-sol", vision.solanaAddress);
                }}
              >
                {copied === "vision-sol" ? (
                  <Check className="mr-2 h-3.5 w-3.5 text-up" />
                ) : (
                  <Copy className="mr-2 h-3.5 w-3.5" />
                )}
                SOL · {shortVisionSol}
              </DropdownMenuItem>
            )}
            {shortVisionEvm && (
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  if (vision.evmAddress) void copyTo("vision-evm", vision.evmAddress);
                }}
              >
                {copied === "vision-evm" ? (
                  <Check className="mr-2 h-3.5 w-3.5 text-up" />
                ) : (
                  <Copy className="mr-2 h-3.5 w-3.5" />
                )}
                EVM · {shortVisionEvm}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setFundOpen(true)}>
              <ArrowDownToLine className="mr-2 h-3.5 w-3.5" />
              Deposit funds
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/trade">
                <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                Open Trade
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setChooserOpen(true)}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Also connect external wallet
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <WalletChooser open={chooserOpen} onOpenChange={setChooserOpen} />
        <FundVisionWalletDialog open={fundOpen} onOpenChange={setFundOpen} />
      </>
    );
  }

  // ---------- 3. Nothing yet — connect or create ----------
  // While the Vision Wallet record is still loading for the first time,
  // render a stable neutral placeholder instead of the "Connect wallet" CTA.
  // Otherwise navigating between pages would briefly flash this CTA before
  // the Vision pill resolves.
  if (vision.loading && !hasVision && !externalConnected) {
    return (
      <div
        aria-hidden
        className={cn(
          "h-10 w-40 rounded-full border border-border/60 bg-secondary/40 animate-pulse",
          size === "lg" && "h-11 w-48",
          className,
        )}
      />
    );
  }

  return (
    <>
      <Button
        onClick={() => setChooserOpen(true)}
        disabled={connecting}
        size={size}
        className={cn(
          "rounded-full font-medium px-7 bg-primary text-primary-foreground hover:bg-primary/90 ease-vision shadow-glow",
          className,
        )}
      >
        {connecting ? "Connecting…" : "Connect wallet to begin"}
      </Button>
      <WalletChooser open={chooserOpen} onOpenChange={setChooserOpen} />
    </>
  );
};
