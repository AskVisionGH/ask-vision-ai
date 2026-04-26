import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2, X } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TokenLogo } from "@/components/TokenLogo";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface TokenMeta {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
}

/** Holding row decorated with optional wallet amount/value for the "Your wallet" section. */
interface HoldingMeta extends TokenMeta {
  amount?: number;
  valueUsd?: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSelect: (t: TokenMeta) => void;
  excludeAddress?: string;
}

const POPULAR: TokenMeta[] = [
  { symbol: "SOL", name: "Solana", address: "So11111111111111111111111111111111111111112", decimals: 9, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png", priceUsd: null },
  { symbol: "USDC", name: "USD Coin", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png", priceUsd: 1 },
  { symbol: "USDT", name: "Tether", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg", priceUsd: 1 },
  { symbol: "JUP", name: "Jupiter", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6, logo: null, priceUsd: null },
  { symbol: "BONK", name: "Bonk", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5, logo: null, priceUsd: null },
  { symbol: "WIF", name: "dogwifhat", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6, logo: null, priceUsd: null },
  { symbol: "JTO", name: "Jito", address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", decimals: 9, logo: null, priceUsd: null },
];

const RECENT_KEY = "vision:recent-tokens";
/** Hide tokens worth less than this in the "Your wallet" section to suppress airdrop spam / dust. */
const HOLDINGS_MIN_USD = 1;

const getRecent = (): TokenMeta[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const pushRecentToken = (t: TokenMeta) => {
  if (typeof window === "undefined") return;
  try {
    const cur = getRecent();
    const next = [t, ...cur.filter((c) => c.address !== t.address)].slice(0, 6);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
};

// Display rule: only show prices we can render meaningfully at 3 decimals.
// Anything below $0.001 (sub-tenth-of-a-cent) is hidden so we don't print
// "$0.000" or scientific notation noise. Bigger-cap tokens (BONK, etc.) often
// fall below this; that's intentional — the unit price isn't useful at that
// scale, the user cares about market cap / their holding value instead.
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

export const TokenPickerDialog = ({ open, onOpenChange, onSelect, excludeAddress }: Props) => {
  const { publicKey, connected } = useWallet();
  const walletAddress = connected && publicKey ? publicKey.toBase58() : null;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TokenMeta[]>([]);
  const [searching, setSearching] = useState(false);
  const [holdings, setHoldings] = useState<HoldingMeta[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const recent = useMemo(() => (open ? getRecent() : []), [open]);
  // Live prices for POPULAR + recent tokens (those rows are hardcoded without
  // a price, so we hydrate via Jupiter's price API on open).
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const debounceRef = useRef<number | null>(null);

  // Reset query/results when dialog closes.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  // Hydrate prices for tokens we ship with priceUsd=null (POPULAR + recent).
  useEffect(() => {
    if (!open) return;
    const mints = Array.from(
      new Set(
        [...POPULAR, ...recent]
          .filter((t) => t.priceUsd == null)
          .map((t) => t.address)
          .filter(Boolean),
      ),
    );
    if (mints.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`,
        );
        if (!r.ok) return;
        const data = (await r.json()) as Record<string, { usdPrice?: number }>;
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const [mint, info] of Object.entries(data)) {
          if (typeof info?.usdPrice === "number") next[mint] = info.usdPrice;
        }
        setLivePrices((prev) => ({ ...prev, ...next }));
      } catch {
        /* ignore — fall back to no price */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, recent]);

  // Fetch wallet holdings when the dialog opens. Cached per session by Supabase
  // edge runtime, so re-opens are cheap.
  useEffect(() => {
    if (!open || !walletAddress) {
      if (!walletAddress) setHoldings([]);
      return;
    }
    let cancelled = false;
    setHoldingsLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("wallet-balance", {
          body: { address: walletAddress },
        });
        if (cancelled) return;
        if (error || !data || data.error) {
          setHoldings([]);
          return;
        }
        const list = Array.isArray(data.holdings) ? data.holdings : [];
        const mapped: HoldingMeta[] = list
          .filter((h: any) => (h.valueUsd ?? 0) >= HOLDINGS_MIN_USD)
          .map((h: any) => ({
            symbol: h.symbol ?? "?",
            name: h.name ?? h.symbol ?? "Unknown",
            address: h.mint,
            decimals: h.decimals ?? 9,
            logo: h.logo ?? null,
            priceUsd: typeof h.priceUsd === "number" ? h.priceUsd : null,
            amount: typeof h.amount === "number" ? h.amount : 0,
            valueUsd: typeof h.valueUsd === "number" ? h.valueUsd : null,
          }))
          .filter((t: HoldingMeta) => !!t.address)
          .sort((a: HoldingMeta, b: HoldingMeta) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
        setHoldings(mapped);
      } catch {
        if (!cancelled) setHoldings([]);
      } finally {
        if (!cancelled) setHoldingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, walletAddress]);

  // Debounced Jupiter token search.
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
        const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(q)}`);
        if (!r.ok) {
          setResults([]);
          return;
        }
        const arr = await r.json();
        const tokens: TokenMeta[] = (Array.isArray(arr) ? arr : [])
          .slice(0, 30)
          .map((t: any) => ({
            symbol: t.symbol ?? "?",
            name: t.name ?? "Unknown",
            address: t.id ?? t.address ?? "",
            decimals: t.decimals ?? 9,
            logo: t.icon ?? t.logoURI ?? null,
            priceUsd: typeof t.usdPrice === "number" ? t.usdPrice : (typeof t.price === "number" ? t.price : null),
          }))
          .filter((t) => t.address);
        setResults(tokens);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const filterExcluded = <T extends TokenMeta>(list: T[]): T[] =>
    excludeAddress ? list.filter((t) => t.address !== excludeAddress) : list;

  const showResults = query.trim().length > 0;

  const pick = (t: TokenMeta) => {
    pushRecentToken(t);
    onSelect(t);
    onOpenChange(false);
  };

  // Hydrate any token whose price is null with the live price we fetched.
  const withLivePrice = <T extends TokenMeta>(t: T): T =>
    t.priceUsd != null ? t : { ...t, priceUsd: livePrices[t.address] ?? null };

  // Section dedupe: holdings → recent → popular. A token only appears in its
  // first matching section so the picker doesn't repeat the same row.
  const visibleHoldings = filterExcluded(holdings);
  const holdingMints = new Set(visibleHoldings.map((h) => h.address));
  const visibleRecent = filterExcluded(recent)
    .filter((t) => !holdingMints.has(t.address))
    .map(withLivePrice);
  const recentMints = new Set(visibleRecent.map((t) => t.address));
  const visiblePopular = filterExcluded(POPULAR)
    .filter((t) => !holdingMints.has(t.address) && !recentMints.has(t.address))
    .map(withLivePrice);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b border-border/60 px-5 pb-3 pt-5">
          <DialogTitle className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Select a token
          </DialogTitle>
        </DialogHeader>
        <div className="border-b border-border/60 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, symbol or paste mint…"
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
                filterExcluded(results).map((t) => <TokenRow key={t.address} token={t} onSelect={pick} />)
              )}
            </div>
          ) : (
            <>
              {walletAddress && (
                <div className="px-2 py-2">
                  <SectionLabel>Your wallet</SectionLabel>
                  {holdingsLoading && visibleHoldings.length === 0 ? (
                    <div className="flex items-center justify-center py-4 text-muted-foreground/60">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </div>
                  ) : visibleHoldings.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground/60">
                      No tokens worth $1+ in this wallet.
                    </p>
                  ) : (
                    visibleHoldings.map((t) => (
                      <TokenRow key={`h-${t.address}`} token={t} onSelect={pick} />
                    ))
                  )}
                </div>
              )}
              {visibleRecent.length > 0 && (
                <div className="px-2 py-2">
                  <SectionLabel>Recent</SectionLabel>
                  {visibleRecent.map((t) => (
                    <TokenRow key={`r-${t.address}`} token={t} onSelect={pick} />
                  ))}
                </div>
              )}
              <div className="px-2 py-2">
                <SectionLabel>Popular</SectionLabel>
                {visiblePopular.map((t) => (
                  <TokenRow key={`p-${t.address}`} token={t} onSelect={pick} />
                ))}
              </div>
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

const TokenRow = ({ token, onSelect }: { token: HoldingMeta; onSelect: (t: TokenMeta) => void }) => {
  const showHolding = typeof token.amount === "number" && token.amount > 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(token)}
      className={cn(
        "ease-vision flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
        "hover:bg-secondary/60",
      )}
    >
      <TokenLogo logo={token.logo} symbol={token.symbol} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{token.symbol}</p>
        <p className="truncate text-[11px] text-muted-foreground">{token.name}</p>
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
