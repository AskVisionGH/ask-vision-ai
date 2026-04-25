import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  isAndroid,
  isIOS,
  shouldUseCustomMobileSheet,
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
  const { wallets, select, connect } = useWallet();
  const [mobileSheet, setMobileSheet] = useState(false);

  const open = () => {
    if (shouldUseCustomMobileSheet()) {
      setMobileSheet(true);
      return;
    }
    setVisible(true);
  };

  // On Android we route every wallet pick through the Mobile Wallet Adapter
  // (the only thing that can actually reach Phantom/Solflare/etc. from a
  // regular Chrome tab). On iOS we deep-link into the wallet's in-app
  // browser because MWA isn't available there.
  const pickWallet = async (target: "phantom" | "solflare" | "mwa") => {
    if (isIOS()) {
      if (target === "phantom") openInPhantom();
      else if (target === "solflare") openInSolflare();
      else {
        // No MWA on iOS — surface the standard modal as a last resort.
        setMobileSheet(false);
        setVisible(true);
      }
      return;
    }

    if (isAndroid()) {
      const mwa = wallets.find((w) =>
        w.adapter.name.toLowerCase().includes("mobile wallet adapter"),
      );
      if (!mwa) {
        toast.error("Mobile Wallet Adapter not available");
        return;
      }
      try {
        select(mwa.adapter.name);
        // `select` is async-applied; `connect` against the new adapter
        // sometimes races, so let the next tick run first.
        await new Promise((r) => setTimeout(r, 0));
        await connect();
        setMobileSheet(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Couldn't open wallet";
        if (!/user rejected|user cancel/i.test(msg)) {
          toast.error("Wallet connection failed", { description: msg });
        }
      }
      return;
    }

    // Fallback: open the standard modal.
    setMobileSheet(false);
    setVisible(true);
  };

  const Picker = (
    <Dialog open={mobileSheet} onOpenChange={setMobileSheet}>
      <DialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-light">
            Connect a wallet
          </DialogTitle>
          <DialogDescription className="text-center text-xs text-muted-foreground">
            {isAndroid()
              ? "Pick the wallet you have installed — we'll hand off to it."
              : "Mobile wallets need to open this site in their built-in browser to connect."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-2">
          <button
            type="button"
            onClick={() => pickWallet("phantom")}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted ease-vision"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#AB9FF2] text-base">
              👻
            </span>
            <span className="flex-1">{isIOS() ? "Open in Phantom" : "Phantom"}</span>
          </button>

          <button
            type="button"
            onClick={() => pickWallet("solflare")}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted ease-vision"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFCC00] text-base">
              ☀️
            </span>
            <span className="flex-1">{isIOS() ? "Open in Solflare" : "Solflare"}</span>
          </button>

          {isAndroid() && (
            <button
              type="button"
              onClick={() => pickWallet("mwa")}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted ease-vision"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                📱
              </span>
              <span className="flex-1">Other wallet (Backpack, Trust…)</span>
            </button>
          )}
        </div>

        <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
          {isAndroid()
            ? "Don't have one? Install Phantom or Solflare from the Play Store."
            : "Don't have one? Install Phantom or Solflare first."}
        </p>
      </DialogContent>
    </Dialog>
  );

  return { open, Picker };
};
