// Detects whether the page is running inside a third-party app's embedded
// WebView (Telegram, Instagram, Facebook, TikTok, LinkedIn, Twitter/X,
// Snapchat, Line, WeChat, etc.).
//
// Why we care: Google blocks OAuth in embedded WebViews with
// `disallowed_useragent` (Error 403). Apple Sign-In and many wallets also
// misbehave. The only fix is for the user to open the link in their real
// default browser — so we surface a prominent banner on /auth.

export type InAppBrowser =
  | "telegram"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "twitter"
  | "snapchat"
  | "line"
  | "wechat"
  | "phantom"
  | "metamask"
  | "trust"
  | "coinbase"
  | "rainbow"
  | "okx"
  | "bitget"
  | "solflare"
  | "backpack"
  | "generic";

export interface InAppBrowserInfo {
  isInApp: boolean;
  app: InAppBrowser | null;
  /** Friendly name to show the user. */
  label: string | null;
}

export function detectInAppBrowser(): InAppBrowserInfo {
  if (typeof navigator === "undefined") {
    return { isInApp: false, app: null, label: null };
  }
  const ua = navigator.userAgent || "";

  // Ordered checks — most specific first. Telegram's WebView reports as
  // either "Telegram" (Android) or just plain Safari on iOS, so we also
  // sniff a Telegram-injected global.
  const win = globalThis as Record<string, unknown> & {
    solana?: { isPhantom?: boolean; isBackpack?: boolean; isSolflare?: boolean };
    phantom?: { solana?: { isPhantom?: boolean } };
    ethereum?: {
      isMetaMask?: boolean;
      isCoinbaseWallet?: boolean;
      isTrust?: boolean;
      isTrustWallet?: boolean;
      isRainbow?: boolean;
      isOkxWallet?: boolean;
      isOKExWallet?: boolean;
      isBitKeep?: boolean;
      isPhantom?: boolean;
    };
  };

  // Provider-injected globals (e.g. window.phantom, window.ethereum.isMetaMask)
  // are AMBIGUOUS: they're true both for desktop browser extensions AND for
  // in-app wallet browsers on mobile. We only treat them as evidence of an
  // in-app browser when we're actually on mobile — otherwise Brave/Chrome
  // desktop users with the Phantom extension installed get false positives.
  const ua_isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const mobileGlobal = (check: () => boolean) => () => ua_isMobile && check();

  const tests: Array<[InAppBrowser, string, RegExp | (() => boolean)]> = [
    ["telegram", "Telegram", /Telegram/i],
    [
      "telegram",
      "Telegram",
      () =>
        typeof (globalThis as { Telegram?: unknown }).Telegram !== "undefined",
    ],
    ["instagram", "Instagram", /Instagram/i],
    ["facebook", "Facebook", /FBAN|FBAV|FB_IAB/i],
    ["tiktok", "TikTok", /BytedanceWebview|musical_ly|TikTok/i],
    ["linkedin", "LinkedIn", /LinkedInApp/i],
    ["twitter", "X (Twitter)", /Twitter/i],
    ["snapchat", "Snapchat", /Snapchat/i],
    ["line", "LINE", /\bLine\//i],
    ["wechat", "WeChat", /MicroMessenger/i],
    // Wallet in-app browsers — Google blocks OAuth in all of these with
    // `disallowed_useragent`. UA sniff first, then provider-injected globals
    // (only on mobile, to avoid catching desktop extensions).
    ["phantom", "Phantom", /Phantom/i],
    [
      "phantom",
      "Phantom",
      mobileGlobal(
        () =>
          Boolean(win.phantom?.solana?.isPhantom) ||
          Boolean(win.solana?.isPhantom) ||
          Boolean(win.ethereum?.isPhantom),
      ),
    ],
    ["metamask", "MetaMask", /MetaMaskMobile/i],
    ["metamask", "MetaMask", mobileGlobal(() => Boolean(win.ethereum?.isMetaMask))],
    ["trust", "Trust Wallet", /Trust\/|TrustWallet/i],
    [
      "trust",
      "Trust Wallet",
      mobileGlobal(() => Boolean(win.ethereum?.isTrust || win.ethereum?.isTrustWallet)),
    ],
    ["coinbase", "Coinbase Wallet", /CoinbaseWallet|CoinbaseBrowser/i],
    ["coinbase", "Coinbase Wallet", mobileGlobal(() => Boolean(win.ethereum?.isCoinbaseWallet))],
    ["rainbow", "Rainbow", /Rainbow/i],
    ["rainbow", "Rainbow", mobileGlobal(() => Boolean(win.ethereum?.isRainbow))],
    ["okx", "OKX Wallet", /OKApp|OKEx/i],
    [
      "okx",
      "OKX Wallet",
      mobileGlobal(() => Boolean(win.ethereum?.isOkxWallet || win.ethereum?.isOKExWallet)),
    ],
    ["bitget", "Bitget Wallet", /BitKeep|Bitget/i],
    ["bitget", "Bitget Wallet", mobileGlobal(() => Boolean(win.ethereum?.isBitKeep))],
    ["solflare", "Solflare", /Solflare/i],
    ["solflare", "Solflare", mobileGlobal(() => Boolean(win.solana?.isSolflare))],
    ["backpack", "Backpack", /Backpack/i],
    ["backpack", "Backpack", mobileGlobal(() => Boolean(win.solana?.isBackpack))],
  ];

  for (const [app, label, test] of tests) {
    const matches = typeof test === "function" ? test() : test.test(ua);
    if (matches) return { isInApp: true, app, label };
  }

  // Generic catch-all: iOS WebView with no Safari token usually means an
  // embedded view (real Safari always includes "Safari/").
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const looksLikeIOSWebView =
    isIOS && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua);
  if (looksLikeIOSWebView) {
    return { isInApp: true, app: "generic", label: "an in-app browser" };
  }

  // Android wv (WebView) token.
  if (/Android/i.test(ua) && /; wv\)/i.test(ua)) {
    return { isInApp: true, app: "generic", label: "an in-app browser" };
  }

  return { isInApp: false, app: null, label: null };
}
