// Mobile wallet deep-linking helpers.
//
// On mobile browsers (Safari/Chrome), desktop wallet *extensions* don't exist,
// so `PhantomWalletAdapter.connect()` just fails silently. The UX solution
// every Solana dApp uses is to deep-link the user into the wallet's in-app
// browser, which exposes `window.solana` / `window.solflare` and lets
// wallet-adapter connect normally.

export const isMobile = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|opera mini|iemobile|mobile/i.test(
    navigator.userAgent,
  );
};

export const isAndroid = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
};

export const isIOS = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
};

/** True when we're already inside a wallet's in-app browser. */
export const isInWalletBrowser = (): boolean => {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    phantom?: { solana?: unknown };
    solflare?: unknown;
    solana?: { isPhantom?: boolean };
    backpack?: unknown;
  };
  return Boolean(
    w.phantom?.solana || w.solflare || w.solana?.isPhantom || w.backpack,
  );
};

/**
 * Android browsers can stay in-place and hand off via the Solana Mobile Wallet
 * Adapter, which preserves the user's logged-in browser session. iOS browsers
 * still generally need the wallet's in-app browser for wallet connection.
 */
export const shouldUseWalletDeepLinks = (): boolean => {
  if (!isMobile() || isInWalletBrowser()) return false;
  return isIOS() && !isAndroid();
};

/**
 * Redirect the mobile user into Phantom's in-app browser pointed at the
 * current URL. From there wallet-adapter connects normally.
 */
export const openInPhantom = () => {
  const url = encodeURIComponent(window.location.href);
  // Phantom universal link — opens the Phantom app's built-in browser.
  window.location.href = `https://phantom.app/ul/browse/${url}?ref=${url}`;
};

/** Same idea for Solflare. */
export const openInSolflare = () => {
  const url = encodeURIComponent(window.location.href);
  window.location.href = `https://solflare.com/ul/v1/browse/${url}?ref=${url}`;
};
