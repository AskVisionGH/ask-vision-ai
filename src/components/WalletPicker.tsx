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
  isInThirdPartyWebView,
  openInPhantom,
  openInSolflare,
  shouldUseCustomMobileSheet,
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

  // Mobile bridge order:
  //   - Android: Mobile Wallet Adapter (native, fastest, supports any wallet)
  //   - iOS:     WalletConnect (Reown) — opens the wallet app via deep link,
  //              user signs, control returns to Safari. No in-app browser.
  // Both keep the user in their original browser session, which means the
  // logged-in Vision account is preserved.
  const connectVia = async (adapterMatcher: (name: string) => boolean, label: string) => {
    const wallet = wallets.find((w) => adapterMatcher(w.adapter.name.toLowerCase()));
    if (!wallet) {
      toast.error(`${label} not available`);
      return;
    }
    try {
      select(wallet.adapter.name);
      await new Promise((r) => setTimeout(r, 0));
      await connect();
      setMobileSheet(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't open wallet";
      if (!/user rejected|user cancel|user closed/i.test(msg)) {
        toast.error("Wallet connection failed", { description: msg });
      }
    }
  };

  const pickWallet = async (target: "phantom" | "solflare" | "other") => {
    if (isAndroid()) {
      // If we're in a third-party webview (Telegram, X, Instagram, etc.) on
      // Android, MWA's intent broadcast can't escape the embedded view and
      // either silently fails or bounces to the Play Store. Deep-link the
      // user into the wallet's in-app browser instead, where wallet-adapter
      // can connect via the injected provider.
      if (isInThirdPartyWebView()) {
        if (target === "solflare") openInSolflare();
        else openInPhantom();
        return;
      }
      // MWA handles the wallet picker itself on Android — for any target we
      // just kick off MWA, which lets the user choose the right wallet.
      await connectVia((n) => n.includes("mobile wallet adapter"), "Mobile Wallet Adapter");
      return;
    }

    if (isIOS()) {
      if (target === "other") {
        await connectVia((n) => n.includes("walletconnect"), "WalletConnect");
        return;
      }
      // Phantom & Solflare both speak WalletConnect — the WC modal on iOS
      // automatically deep-links into the wallet the user picks there.
      await connectVia((n) => n.includes("walletconnect"), "WalletConnect");
      return;
    }

    setMobileSheet(false);
    setVisible(true);
  };

  // Manual fallback: if MWA / WalletConnect didn't work (no app installed,
  // intent blocked, etc.), let the user jump straight into the wallet's
  // in-app browser. This always works as long as the wallet is installed.
  const openWalletBrowser = (wallet: "phantom" | "solflare") => {
    setMobileSheet(false);
    if (wallet === "solflare") openInSolflare();
    else openInPhantom();
  };

  const Picker = (
    <Dialog open={mobileSheet} onOpenChange={setMobileSheet}>
      <DialogContent className="max-w-sm rounded-2xl border-border bg-card p-6">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-light">
            Connect a wallet
          </DialogTitle>
          <DialogDescription className="text-center text-xs text-muted-foreground">
            Pick a wallet — you'll approve the connection in the wallet app
            and come right back here.
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
            <span className="flex-1">Phantom</span>
          </button>

          <button
            type="button"
            onClick={() => pickWallet("solflare")}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted ease-vision"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFCC00] text-base">
              ☀️
            </span>
            <span className="flex-1">Solflare</span>
          </button>

          <button
            type="button"
            onClick={() => pickWallet("other")}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted ease-vision"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              📱
            </span>
            <span className="flex-1">Other wallet (Backpack, Trust…)</span>
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-border/60 bg-secondary/40 p-3">
          <p className="text-[11px] font-medium text-foreground">
            Not working? Open in the wallet app
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            If tapping above does nothing or sends you to the app store, use
            your wallet's built-in browser instead.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => openWalletBrowser("phantom")}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted ease-vision"
            >
              Open in Phantom
            </button>
            <button
              type="button"
              onClick={() => openWalletBrowser("solflare")}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted ease-vision"
            >
              Open in Solflare
            </button>
          </div>
        </div>

        <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
          Don't have a wallet? Install Phantom or Solflare first.
        </p>
      </DialogContent>
    </Dialog>
  );

  return { open, Picker };
};
