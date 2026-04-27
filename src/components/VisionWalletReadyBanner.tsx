import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowRightLeft, Sparkles, X } from "lucide-react";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { FundVisionWalletDialog } from "@/components/wallet/FundVisionWalletDialog";

const DISMISS_KEY = "vision_wallet_ready_banner_dismissed_v1";

/**
 * VisionWalletReadyBanner — small inline banner shown on the empty Chat
 * landing for users who already provisioned a Vision Wallet. It explains
 * that the wallet is *already connected* (no "Connect wallet" needed) and
 * gives one-click access to deposit and trade.
 *
 * Dismissed state is stored in localStorage, so the banner appears once
 * per browser per user and never nags again.
 */
export const VisionWalletReadyBanner = () => {
  const vision = useVisionWallet();
  const [dismissed, setDismissed] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* localStorage unavailable — show the banner */
    }
  }, []);

  const hasVision = Boolean(vision.solanaAddress || vision.evmAddress);
  if (vision.loading || !hasVision || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <div className="ease-vision animate-fade-up relative mt-6 w-full max-w-md overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] to-transparent p-4 text-left shadow-soft">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="ease-vision absolute right-2 top-2 text-muted-foreground/60 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 pr-4">
            <p className="font-mono text-[11px] uppercase tracking-widest text-primary">
              Vision Wallet · ready
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">
              Your Vision Wallet is already linked — no "Connect wallet" needed.
              Deposit funds to start trading with one-click signing.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFundOpen(true)}
                className="ease-vision inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
              >
                <ArrowDownToLine className="h-3 w-3" />
                Deposit
              </button>
              <Link
                to="/trade"
                className="ease-vision inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-foreground hover:bg-secondary"
              >
                <ArrowRightLeft className="h-3 w-3" />
                Open Trade
              </Link>
            </div>
          </div>
        </div>
      </div>

      <FundVisionWalletDialog open={fundOpen} onOpenChange={setFundOpen} />
    </>
  );
};
