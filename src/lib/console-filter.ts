// Silences noisy console errors that originate from wallet browser extensions
// (Phantom, MetaMask, etc.) rather than from our own app code.
//
// Phantom's injected provider hits its own RPC endpoints (eth.merkle.io,
// solana-mainnet.phantom.app, etc.) on every page load. When those requests
// are blocked by CORS or ad-blockers, the extension logs failures into the
// host page's console — even though they have nothing to do with the app.
//
// We pattern-match on the noisy strings and swallow them so real app errors
// stay visible. Anything we don't recognize passes through untouched.

const NOISY_PATTERNS: RegExp[] = [
  /eth\.merkle\.io/i,
  /solana-mainnet\.phantom\.app/i,
  /chain-proxy\.wallet\.coinbase\.com/i,
  /Access to fetch at .* has been blocked by CORS policy/i,
  /net::ERR_FAILED.*(merkle|phantom|coinbase|metamask)/i,
];

const isNoise = (args: unknown[]): boolean => {
  for (const arg of args) {
    const str =
      typeof arg === "string"
        ? arg
        : arg instanceof Error
          ? `${arg.message} ${arg.stack ?? ""}`
          : "";
    if (!str) continue;
    if (NOISY_PATTERNS.some((re) => re.test(str))) return true;
  }
  return false;
};

export const installConsoleFilter = () => {
  if (typeof window === "undefined") return;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    if (isNoise(args)) return;
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (isNoise(args)) return;
    originalWarn(...args);
  };

  // Window-level errors from extension scripts surface as "unhandled" even
  // though they don't touch our code. Suppress only when they match our
  // known-noise list.
  window.addEventListener("error", (e) => {
    if (isNoise([e.message, e.filename, e.error])) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const text =
      typeof reason === "string"
        ? reason
        : reason instanceof Error
          ? `${reason.message} ${reason.stack ?? ""}`
          : "";
    if (isNoise([text])) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });
};
