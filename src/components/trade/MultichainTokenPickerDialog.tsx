// Multichain token picker — shows tokens across Solana + every supported EVM
// chain in a single dialog, with per-chain filter chips and balance hydration.
//
// Why a separate component (vs extending TokenPickerDialog)?
//   The existing TokenPickerDialog is Solana-only and tightly bound to the
//   Jupiter token universe. This new picker surfaces the cross-chain "any
//   token, any chain" universe powered by the route-quote orchestrator and
//   has to deal with per-chain balances, addresses, and symbol collisions
//   (e.g. native ETH on 6 different chains). Keeping them separate avoids
//   ballooning the Solana picker for a different mental model.
//
// Returned token shape (`MultichainToken`) carries everything route-quote
// needs in one object so callers don't have to thread chainId separately.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2, X } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAccount } from "wagmi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TokenLogo } from "@/components/TokenLogo";
import { supabase } from "@/integrations/supabase/client";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { cn } from "@/lib/utils";

// -- Public types ------------------------------------------------------------

/**
 * Canonical chain identifier across the app.
 *   - "SOL" for Solana mainnet
 *   - numeric LI.FI / EVM chain id otherwise
 *
 * Matches what `route-quote` accepts for `fromChain` / `toChain`.
 */
export type ChainKey = "SOL" | number;

export interface MultichainToken {
  /** Mint (Solana) or 0x address (EVM). */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
  /** "SOL" or numeric chain id — same shape as ChainKey. */
  chainId: ChainKey;
  /** Optional wallet balance hydrated by the picker. */
  amount?: number;
  valueUsd?: number | null;
}

interface ChainOption {
  key: ChainKey;
  label: string;
  logo: string | null;
  /** Native token symbol (e.g. ETH, MATIC) — useful for the picker badge. */
  nativeSymbol: string;
  /** Numeric LI.FI chain id when calling bridge-tokens; "SOL" passes through. */
  lifiId: string;
}

/**
 * Static chain catalogue. Kept in-component (not a separate file) because the
 * picker is the only consumer right now. If we add more chains later, lift to
 * `src/lib/multichain-chains.ts`.
 *
 * IMPORTANT: keep in sync with:
 *   - supabase/functions/route-quote/index.ts (USDC_BY_CHAIN keys)
 *   - supabase/functions/evm-swap-quote/index.ts (SUPPORTED_CHAINS)
 *   - src/lib/evm-chains.ts (SUPPORTED_EVM_CHAINS)
 */
export const CHAINS: ChainOption[] = [
  { key: "SOL", label: "Solana", logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png", nativeSymbol: "SOL", lifiId: "SOL" },
  { key: 1, label: "Ethereum", logo: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg", nativeSymbol: "ETH", lifiId: "1" },
  { key: 8453, label: "Base", logo: "https://icons.llamao.fi/icons/chains/rsz_base.jpg", nativeSymbol: "ETH", lifiId: "8453" },
  { key: 42161, label: "Arbitrum", logo: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg", nativeSymbol: "ETH", lifiId: "42161" },
  { key: 10, label: "Optimism", logo: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg", nativeSymbol: "ETH", lifiId: "10" },
  { key: 137, label: "Polygon", logo: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg", nativeSymbol: "MATIC", lifiId: "137" },
  { key: 56, label: "BNB Chain", logo: "https://icons.llamao.fi/icons/chains/rsz_binance.jpg", nativeSymbol: "BNB", lifiId: "56" },
  { key: 43114, label: "Avalanche", logo: "https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg", nativeSymbol: "AVAX", lifiId: "43114" },
  { key: 59144, label: "Linea", logo: "https://icons.llamao.fi/icons/chains/rsz_linea.jpg", nativeSymbol: "ETH", lifiId: "59144" },
  { key: 534352, label: "Scroll", logo: "https://icons.llamao.fi/icons/chains/rsz_scroll.jpg", nativeSymbol: "ETH", lifiId: "534352" },
];

export const chainOption = (key: ChainKey): ChainOption | undefined =>
  CHAINS.find((c) => String(c.key) === String(key));

// Solana popular tokens — same set as TokenPickerDialog so users get a
// consistent baseline regardless of which picker they open.
const SOLANA_POPULAR: MultichainToken[] = [
  { symbol: "SOL", name: "Solana", address: "So11111111111111111111111111111111111111112", decimals: 9, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png", priceUsd: null, chainId: "SOL" },
  { symbol: "USDC", name: "USD Coin", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png", priceUsd: 1, chainId: "SOL" },
  { symbol: "USDT", name: "Tether", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg", priceUsd: 1, chainId: "SOL" },
  { symbol: "JUP", name: "Jupiter", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6, logo: "https://static.jup.ag/jup/icon.png", priceUsd: null, chainId: "SOL" },
  { symbol: "BONK", name: "Bonk", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5, logo: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I", priceUsd: null, chainId: "SOL" },
  { symbol: "WIF", name: "dogwifhat", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6, logo: "https://bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum.ipfs.nftstorage.link", priceUsd: null, chainId: "SOL" },
  { symbol: "JTO", name: "Jito", address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", decimals: 9, logo: "https://metadata.jito.network/token/jto/image", priceUsd: null, chainId: "SOL" },
  { symbol: "PYTH", name: "Pyth Network", address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", decimals: 6, logo: "https://pyth.network/token.svg", priceUsd: null, chainId: "SOL" },
  { symbol: "JLP", name: "Jupiter LP", address: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4", decimals: 6, logo: "https://static.jup.ag/jlp/icon.png", priceUsd: null, chainId: "SOL" },
  { symbol: "mSOL", name: "Marinade SOL", address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", decimals: 9, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png", priceUsd: null, chainId: "SOL" },
  { symbol: "RAY", name: "Raydium", address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6, logo: "https://img.raydium.io/icon/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R.png", priceUsd: null, chainId: "SOL" },
  { symbol: "ORCA", name: "Orca", address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", decimals: 6, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png", priceUsd: null, chainId: "SOL" },
];

// EVM popular tokens — kept tiny because each chain has its own native + USDC
// and the user can search for anything else. Data taken from the LI.FI token
// list / Coingecko canonical addresses.
const EVM_POPULAR: MultichainToken[] = [
  // Ethereum
  { symbol: "ETH", name: "Ethereum", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, logo: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg", priceUsd: null, chainId: 1 },
  { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, logo: null, priceUsd: 1, chainId: 1 },
  { symbol: "USDT", name: "Tether", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, logo: null, priceUsd: 1, chainId: 1 },
  { symbol: "WBTC", name: "Wrapped BTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, logo: null, priceUsd: null, chainId: 1 },
  { symbol: "DAI", name: "Dai", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, logo: null, priceUsd: 1, chainId: 1 },
  { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, logo: null, priceUsd: null, chainId: 1 },
  // Base
  { symbol: "ETH", name: "Ethereum", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, logo: "https://icons.llamao.fi/icons/chains/rsz_base.jpg", priceUsd: null, chainId: 8453 },
  { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, logo: null, priceUsd: 1, chainId: 8453 },
  { symbol: "cbBTC", name: "Coinbase BTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, logo: null, priceUsd: null, chainId: 8453 },
  { symbol: "AERO", name: "Aerodrome", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18, logo: null, priceUsd: null, chainId: 8453 },
  // Arbitrum
  { symbol: "ETH", name: "Ethereum", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, logo: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg", priceUsd: null, chainId: 42161 },
  { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, logo: null, priceUsd: 1, chainId: 42161 },
  { symbol: "ARB", name: "Arbitrum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, logo: null, priceUsd: null, chainId: 42161 },
  // Optimism
  { symbol: "ETH", name: "Ethereum", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, logo: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg", priceUsd: null, chainId: 10 },
  { symbol: "USDC", name: "USD Coin", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, logo: null, priceUsd: 1, chainId: 10 },
  { symbol: "OP", name: "Optimism", address: "0x4200000000000000000000000000000000000042", decimals: 18, logo: null, priceUsd: null, chainId: 10 },
  // Polygon
  { symbol: "MATIC", name: "Polygon", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, logo: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg", priceUsd: null, chainId: 137 },
  { symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, logo: null, priceUsd: 1, chainId: 137 },
  // BNB Chain
  { symbol: "BNB", name: "BNB", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, logo: "https://icons.llamao.fi/icons/chains/rsz_binance.jpg", priceUsd: null, chainId: 56 },
  { symbol: "USDC", name: "USD Coin", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, logo: null, priceUsd: 1, chainId: 56 },
  { symbol: "CAKE", name: "PancakeSwap", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18, logo: null, priceUsd: null, chainId: 56 },
  // Avalanche
  { symbol: "AVAX", name: "Avalanche", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, logo: "https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg", priceUsd: null, chainId: 43114 },
  { symbol: "USDC", name: "USD Coin", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6, logo: null, priceUsd: 1, chainId: 43114 },
  // Linea
  { symbol: "ETH", name: "Ethereum", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, logo: "https://icons.llamao.fi/icons/chains/rsz_linea.jpg", priceUsd: null, chainId: 59144 },
  // Scroll
  { symbol: "ETH", name: "Ethereum", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, logo: "https://icons.llamao.fi/icons/chains/rsz_scroll.jpg", priceUsd: null, chainId: 534352 },
];

const RECENT_KEY = "vision:recent-multichain-tokens";
const HOLDINGS_MIN_USD = 1;

const getRecent = (): MultichainToken[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const pushRecentMultichainToken = (t: MultichainToken) => {
  if (typeof window === "undefined") return;
  try {
    const cur = getRecent();
    // Dedupe by address+chain so the same token on two chains doesn't collapse.
    const key = `${t.chainId}:${t.address.toLowerCase()}`;
    const next = [
      t,
      ...cur.filter((c) => `${c.chainId}:${c.address.toLowerCase()}` !== key),
    ].slice(0, 8);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
};

const fmtPrice = (n: number | null) => {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  if (n < 0.001) return "";
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
};
const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const fmtAmount = (n: number) => {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSelect: (t: MultichainToken) => void;
  /**
   * Optional exclusion — used by swap UI so the user can't pick the same
   * token+chain on both legs. We compare by `address+chainId` so e.g. USDC
   * on Solana and USDC on Base remain independently selectable.
   */
  excludeKey?: string;
  /** Lock to a specific chain (used when the orchestrator pre-decides). */
  lockedChain?: ChainKey;
  /** Optional override label for the dialog title. */
  title?: string;
}

export const tokenKey = (t: { address: string; chainId: ChainKey }) =>
  `${t.chainId}:${t.address.toLowerCase()}`;

export const MultichainTokenPickerDialog = ({
  open,
  onOpenChange,
  onSelect,
  excludeKey,
  lockedChain,
  title = "Select a token",
}: Props) => {
  const { publicKey, connected } = useWallet();
  const { address: evmAddress } = useAccount();
  const visionWallet = useVisionWallet();

  // Address resolution: prefer Vision Wallet (custodial, always present once
  // user is signed in), fall back to whatever external wallet is connected.
  // This keeps the picker useful regardless of which wallet source the user
  // ends up choosing in TradeSwap.
  const solanaAddress =
    visionWallet.solanaAddress ?? (connected && publicKey ? publicKey.toBase58() : null);
  const evmFromAddress = visionWallet.evmAddress ?? evmAddress ?? null;

  const [query, setQuery] = useState("");
  const [activeChain, setActiveChain] = useState<ChainKey | "ALL">(
    lockedChain ?? "ALL",
  );
  const [results, setResults] = useState<MultichainToken[]>([]);
  const [searching, setSearching] = useState(false);
  const [holdings, setHoldings] = useState<MultichainToken[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  // Pre-loaded "trending" tokens for the active chain shown when there's no
  // search query yet, so users always see a meaningful list of choices.
  const [trending, setTrending] = useState<Record<string, MultichainToken[]>>({});
  const [trendingLoading, setTrendingLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const recent = useMemo(() => (open ? getRecent() : []), [open]);

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setActiveChain(lockedChain ?? "ALL");
    }
  }, [open, lockedChain]);

  // ---------- Hydrate holdings (Solana + each EVM chain) ----------
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHoldings([]);
    setHoldingsLoading(true);

    const tasks: Array<Promise<MultichainToken[]>> = [];

    if (solanaAddress) {
      tasks.push(
        supabase.functions
          .invoke("wallet-balance", { body: { address: solanaAddress } })
          .then(({ data, error }) => {
            if (error || !data || data.error) return [];
            const list = Array.isArray(data.holdings) ? data.holdings : [];
            return list
              .filter((h: any) => (h.valueUsd ?? 0) >= HOLDINGS_MIN_USD)
              .map((h: any): MultichainToken => ({
                symbol: h.symbol ?? "?",
                name: h.name ?? h.symbol ?? "Unknown",
                address: h.mint,
                decimals: h.decimals ?? 9,
                logo: h.logo ?? null,
                priceUsd: typeof h.priceUsd === "number" ? h.priceUsd : null,
                amount: typeof h.amount === "number" ? h.amount : 0,
                valueUsd: typeof h.valueUsd === "number" ? h.valueUsd : null,
                chainId: "SOL",
              }))
              .filter((t: MultichainToken) => !!t.address);
          })
          .catch(() => []),
      );
    }

    if (evmFromAddress) {
      // Hydrate every EVM chain in parallel. evm-wallet-balance handles its
      // own per-chain caching, so this is cheap on subsequent opens.
      for (const chain of CHAINS) {
        if (chain.key === "SOL") continue;
        tasks.push(
          supabase.functions
            .invoke("evm-wallet-balance", {
              body: { address: evmFromAddress, chainId: Number(chain.key) },
            })
            .then(({ data, error }) => {
              if (error || !data || data.error) return [];
              const list = Array.isArray(data.holdings) ? data.holdings : [];
              return list
                .filter((h: any) => (h.valueUsd ?? 0) >= HOLDINGS_MIN_USD)
                .map((h: any): MultichainToken => {
                  // evm-wallet-balance reports the native asset as 0x0000…0000.
                  // 0x's swap API + route-quote want the EIP-7528 placeholder
                  // 0xEeeE… for native, so normalize here once instead of
                  // every consumer handling it.
                  const rawAddr = h.address ?? h.mint;
                  const isNative = typeof rawAddr === "string" && /^0x0{40}$/i.test(rawAddr);
                  return {
                    symbol: h.symbol ?? "?",
                    name: h.name ?? h.symbol ?? "Unknown",
                    address: isNative ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : rawAddr,
                    decimals: h.decimals ?? 18,
                    logo: h.logo ?? h.logoURI ?? null,
                    priceUsd: typeof h.priceUsd === "number" ? h.priceUsd : null,
                    amount: typeof h.amount === "number" ? h.amount : 0,
                    valueUsd: typeof h.valueUsd === "number" ? h.valueUsd : null,
                    chainId: chain.key,
                  };
                })
                .filter((t: MultichainToken) => !!t.address);
            })
            .catch(() => []),
        );
      }
    }

    Promise.all(tasks)
      .then((groups) => {
        if (cancelled) return;
        const flat = groups.flat();
        flat.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
        setHoldings(flat);
      })
      .finally(() => {
        if (!cancelled) setHoldingsLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, solanaAddress, evmFromAddress]);

  // ---------- Hydrate Solana popular prices via Jupiter ----------
  useEffect(() => {
    if (!open) return;
    const mints = SOLANA_POPULAR.filter((t) => t.priceUsd == null).map((t) => t.address);
    if (mints.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`);
        if (!r.ok) return;
        const data = (await r.json()) as Record<string, { usdPrice?: number }>;
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const [mint, info] of Object.entries(data)) {
          if (typeof info?.usdPrice === "number") next[mint] = info.usdPrice;
        }
        setLivePrices((prev) => ({ ...prev, ...next }));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // ---------- Hydrate "Trending" tokens for the active chain ----------
  // When the user has no query yet, we want to surface a meaningful list
  // (top tokens by liquidity / verified) per chain. Cached in component
  // state keyed by chain so switching chips is instant after first fetch.
  useEffect(() => {
    if (!open) return;
    const cacheKey = String(activeChain);
    if (trending[cacheKey]) return;
    let cancelled = false;
    setTrendingLoading(true);
    (async () => {
      try {
        if (activeChain === "ALL" || activeChain === "SOL") {
          // Jupiter "toporganicscore" returns a strong list of established
          // Solana tokens. Falls back to verified=true if unavailable.
          const r = await fetch(
            "https://lite-api.jup.ag/tokens/v2/toporganicscore/24h?limit=30",
          );
          if (!r.ok) return;
          const arr = await r.json();
          if (cancelled || !Array.isArray(arr)) return;
          const list: MultichainToken[] = arr
            .map((t: any): MultichainToken => ({
              symbol: t.symbol ?? "?",
              name: t.name ?? "Unknown",
              address: t.id ?? t.address ?? "",
              decimals: t.decimals ?? 9,
              logo: t.icon ?? t.logoURI ?? null,
              priceUsd: typeof t.usdPrice === "number" ? t.usdPrice : null,
              chainId: "SOL",
            }))
            .filter((t) => !!t.address);
          setTrending((prev) => ({ ...prev, [cacheKey]: list }));
        } else {
          // EVM: pull bridge-tokens (LI.FI) and take the top verified ones
          // by priceUsd presence. They're already returned in popularity-ish
          // order by LI.FI.
          const chain = chainOption(activeChain as ChainKey);
          if (!chain) return;
          const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bridge-tokens?chain=${chain.lifiId}`;
          const resp = await fetch(url, {
            headers: {
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
          });
          if (!resp.ok) return;
          const data = await resp.json();
          if (cancelled) return;
          const raw = Array.isArray(data.tokens) ? data.tokens : [];
          const list: MultichainToken[] = raw
            .filter((t: any) => t.symbol && t.address)
            .slice(0, 40)
            .map((t: any): MultichainToken => ({
              symbol: t.symbol,
              name: t.name ?? t.symbol,
              address: t.address,
              decimals: t.decimals ?? 18,
              logo: t.logo ?? null,
              priceUsd: t.priceUsd ?? null,
              chainId: chain.key,
            }));
          setTrending((prev) => ({ ...prev, [cacheKey]: list }));
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setTrendingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeChain, trending]);

  // ---------- Search ----------
  // When activeChain === "ALL" or "SOL" we use Jupiter (broad memecoin coverage).
  // Otherwise we hit bridge-tokens for the selected EVM chain (LI.FI list).
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const tasks: Array<Promise<MultichainToken[]>> = [];

        const includeSolana = activeChain === "ALL" || activeChain === "SOL";
        if (includeSolana) {
          tasks.push(
            fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(q)}`)
              .then((r) => (r.ok ? r.json() : []))
              .then((arr: any[]) =>
                (Array.isArray(arr) ? arr : []).slice(0, 20).map((t: any): MultichainToken => ({
                  symbol: t.symbol ?? "?",
                  name: t.name ?? "Unknown",
                  address: t.id ?? t.address ?? "",
                  decimals: t.decimals ?? 9,
                  logo: t.icon ?? t.logoURI ?? null,
                  priceUsd: typeof t.usdPrice === "number" ? t.usdPrice : null,
                  chainId: "SOL",
                })).filter((t) => !!t.address),
              )
              .catch(() => []),
          );
        }

        const evmChains: ChainOption[] =
          activeChain === "ALL"
            ? CHAINS.filter((c) => c.key !== "SOL")
            : activeChain === "SOL"
              ? []
              : [chainOption(activeChain)].filter(Boolean) as ChainOption[];

        for (const chain of evmChains) {
          tasks.push(
            supabase.functions
              .invoke("bridge-tokens", { body: undefined })
              .then(() => null) // placeholder so the GET below runs instead
              .catch(() => null)
              .then(async () => {
                // bridge-tokens is GET-only — call the function via fetch.
                const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bridge-tokens?chain=${chain.lifiId}`;
                const resp = await fetch(url, {
                  headers: {
                    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                    Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
                  },
                });
                if (!resp.ok) return [] as MultichainToken[];
                const data = await resp.json();
                const list = Array.isArray(data.tokens) ? data.tokens : [];
                const ql = q.toLowerCase();
                return list
                  .filter((t: any) => {
                    if (!t.symbol || !t.address) return false;
                    const sym = String(t.symbol).toLowerCase();
                    const name = String(t.name ?? "").toLowerCase();
                    const addr = String(t.address).toLowerCase();
                    return sym.includes(ql) || name.includes(ql) || addr === ql;
                  })
                  .slice(0, 15)
                  .map((t: any): MultichainToken => ({
                    symbol: t.symbol,
                    name: t.name ?? t.symbol,
                    address: t.address,
                    decimals: t.decimals ?? 18,
                    logo: t.logo ?? null,
                    priceUsd: t.priceUsd ?? null,
                    chainId: chain.key,
                  }));
              }),
          );
        }

        const groups = await Promise.all(tasks);
        const flat = groups.flat();

        // Rank: exact symbol match > has price > alphabetical.
        const ql = q.toLowerCase();
        flat.sort((a, b) => {
          const aExact = a.symbol.toLowerCase() === ql ? 1 : 0;
          const bExact = b.symbol.toLowerCase() === ql ? 1 : 0;
          if (aExact !== bExact) return bExact - aExact;
          const aHasPrice = a.priceUsd != null ? 1 : 0;
          const bHasPrice = b.priceUsd != null ? 1 : 0;
          if (aHasPrice !== bHasPrice) return bHasPrice - aHasPrice;
          return a.symbol.localeCompare(b.symbol);
        });

        setResults(flat.slice(0, 60));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, activeChain]);

  // ---------- Filtering helpers ----------
  const filterByChain = <T extends MultichainToken>(list: T[]): T[] => {
    if (activeChain === "ALL") return list;
    return list.filter((t) => String(t.chainId) === String(activeChain));
  };
  const filterExcluded = <T extends MultichainToken>(list: T[]): T[] =>
    excludeKey ? list.filter((t) => tokenKey(t) !== excludeKey) : list;
  const withLivePrice = <T extends MultichainToken>(t: T): T =>
    t.priceUsd != null ? t : { ...t, priceUsd: livePrices[t.address] ?? null };

  const visibleHoldings = filterExcluded(filterByChain(holdings));
  const heldKeys = new Set(visibleHoldings.map(tokenKey));
  const visibleRecent = filterExcluded(filterByChain(recent))
    .filter((t) => !heldKeys.has(tokenKey(t)))
    .map(withLivePrice);
  const recentKeys = new Set(visibleRecent.map(tokenKey));
  const popularPool = [...SOLANA_POPULAR, ...EVM_POPULAR];
  const visiblePopular = filterExcluded(filterByChain(popularPool))
    .filter((t) => !heldKeys.has(tokenKey(t)) && !recentKeys.has(tokenKey(t)))
    .map(withLivePrice);
  const popularKeys = new Set(visiblePopular.map(tokenKey));
  // Pull trending list for the active chain (or merge ALL on "ALL").
  const trendingPool: MultichainToken[] =
    activeChain === "ALL"
      ? Object.values(trending).flat()
      : trending[String(activeChain)] ?? [];
  const visibleTrending = filterExcluded(filterByChain(trendingPool)).filter(
    (t) =>
      !heldKeys.has(tokenKey(t)) &&
      !recentKeys.has(tokenKey(t)) &&
      !popularKeys.has(tokenKey(t)),
  );

  const showResults = query.trim().length > 0;

  const pick = (t: MultichainToken) => {
    pushRecentMultichainToken(t);
    onSelect(t);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b border-border/60 px-5 pb-3 pt-5">
          <DialogTitle className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {title}
          </DialogTitle>
        </DialogHeader>

        {/* Search box */}
        <div className="border-b border-border/60 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any token on any chain…"
              className="h-9 border-border/60 bg-secondary/40 pl-8 pr-8 text-sm placeholder:text-muted-foreground/50"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Chain chips — hidden when locked to a specific chain */}
        {!lockedChain && (
          <div className="scrollbar-none flex gap-1.5 overflow-x-auto border-b border-border/60 px-4 py-2">
            <ChainChip
              active={activeChain === "ALL"}
              onClick={() => setActiveChain("ALL")}
              label="All chains"
              logo={null}
            />
            {CHAINS.map((c) => (
              <ChainChip
                key={String(c.key)}
                active={String(activeChain) === String(c.key)}
                onClick={() => setActiveChain(c.key)}
                label={c.label}
                logo={c.logo}
              />
            ))}
          </div>
        )}

        {/* List */}
        <div className="max-h-[420px] overflow-y-auto">
          {showResults ? (
            <div className="px-2 py-2">
              {searching && results.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground/60">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : filterExcluded(results).length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground/60">
                  No tokens found.
                </div>
              ) : (
                filterExcluded(results).map((t) => (
                  <TokenRow key={tokenKey(t)} token={t} onSelect={pick} />
                ))
              )}
            </div>
          ) : (
            <>
              {(solanaAddress || evmFromAddress) && (
                <div className="px-2 py-2">
                  <SectionLabel>Your wallet</SectionLabel>
                  {holdingsLoading && visibleHoldings.length === 0 ? (
                    <div className="flex items-center justify-center py-4 text-muted-foreground/60">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </div>
                  ) : visibleHoldings.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground/60">
                      No tokens worth $1+ on {activeChain === "ALL" ? "any chain" : chainOption(activeChain as ChainKey)?.label ?? "this chain"}.
                    </p>
                  ) : (
                    visibleHoldings.map((t) => (
                      <TokenRow key={`h-${tokenKey(t)}`} token={t} onSelect={pick} />
                    ))
                  )}
                </div>
              )}
              {visibleRecent.length > 0 && (
                <div className="px-2 py-2">
                  <SectionLabel>Recent</SectionLabel>
                  {visibleRecent.map((t) => (
                    <TokenRow key={`r-${tokenKey(t)}`} token={t} onSelect={pick} />
                  ))}
                </div>
              )}
              {visiblePopular.length > 0 && (
                <div className="px-2 py-2">
                  <SectionLabel>Popular</SectionLabel>
                  {visiblePopular.map((t) => (
                    <TokenRow key={`p-${tokenKey(t)}`} token={t} onSelect={pick} />
                  ))}
                </div>
              )}
              {(visibleTrending.length > 0 || trendingLoading) && (
                <div className="px-2 py-2">
                  <SectionLabel>Trending</SectionLabel>
                  {trendingLoading && visibleTrending.length === 0 ? (
                    <div className="flex items-center justify-center py-4 text-muted-foreground/60">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </div>
                  ) : (
                    visibleTrending.map((t) => (
                      <TokenRow key={`t-${tokenKey(t)}`} token={t} onSelect={pick} />
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="px-3 pb-1 pt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
    {children}
  </div>
);

const ChainChip = ({
  active,
  onClick,
  label,
  logo,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  logo: string | null;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "ease-vision flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
      active
        ? "border-primary/60 bg-primary/15 text-foreground"
        : "border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
    )}
  >
    {logo ? (
      <img src={logo} alt="" className="h-3.5 w-3.5 rounded-full" />
    ) : (
      <div className="h-3.5 w-3.5 rounded-full bg-gradient-to-br from-primary/40 to-primary/10" />
    )}
    {label}
  </button>
);

const TokenRow = ({
  token,
  onSelect,
}: {
  token: MultichainToken;
  onSelect: (t: MultichainToken) => void;
}) => {
  const showHolding = typeof token.amount === "number" && token.amount > 0;
  const chain = chainOption(token.chainId);
  return (
    <button
      type="button"
      onClick={() => onSelect(token)}
      className={cn(
        "ease-vision flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
        "hover:bg-secondary/60",
      )}
    >
      <div className="relative">
        <TokenLogo logo={token.logo} symbol={token.symbol} size={32} />
        {chain?.logo && (
          <img
            src={chain.logo}
            alt=""
            className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border border-background"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{token.symbol}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {token.name}
          {chain && <span className="ml-1.5 text-muted-foreground/60">· {chain.label}</span>}
        </p>
      </div>
      <div className="flex flex-col items-end">
        {showHolding ? (
          <>
            <span className="font-mono text-[11px] text-foreground">
              {fmtAmount(token.amount!)}
            </span>
            {token.valueUsd != null && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {fmtUsd(token.valueUsd)}
              </span>
            )}
          </>
        ) : (
          token.priceUsd != null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {fmtPrice(token.priceUsd)}
            </span>
          )
        )}
      </div>
    </button>
  );
};
