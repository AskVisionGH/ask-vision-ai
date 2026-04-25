import { useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  shouldUseWalletDeepLinks,
  openInPhantom,
  openInSolflare,
} from "@/lib/mobile-wallet";

/**
 * Hook that returns an `open()` function for the wallet picker.
 *
 * On desktop and inside a wallet's in-app browser, it delegates to the
 * standard wallet-adapter modal. On plain mobile browsers (where no extension
 * provider exists), it shows a small sheet offering to deep-link into
 * Phantom / Solflare's in-app browser — otherwise clicking "Phantom" in the
 * default modal does nothing because `window.solana` is undefined.
 */
export const useWalletPicker = () => {
  const { setVisible } = useWalletModal();
  const [mobileSheet, setMobileSheet] = useState(false);

  const open = () => {
    if (shouldUseWalletDeepLinks()) {
      setMobileSheet(true);
      return;
    }
    setVisible(true);
  };

  const Picker = (
    <Dialog open={mobileSheet} onOpenChange={setMobileSheet}>
      <DialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-light">
            Open Vision in your wallet
          </DialogTitle>
          <DialogDescription className="text-center text-xs text-muted-foreground">
            Mobile wallets need to open this site in their built-in browser to
            connect.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-2">
          <button
            type="button"
            onClick={openInPhantom}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted ease-vision"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#AB9FF2] text-base">
              👻
            </span>
            <span className="flex-1">Open in Phantom</span>
          </button>

          <button
            type="button"
            onClick={openInSolflare}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted ease-vision"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFCC00] text-base">
              ☀️
            </span>
            <span className="flex-1">Open in Solflare</span>
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
          Don't have one? Install Phantom or Solflare first.
        </p>
      </DialogContent>
    </Dialog>
  );

  return { open, Picker };
};
