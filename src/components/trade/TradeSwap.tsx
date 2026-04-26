import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  Loader2,
  Settings as SettingsIcon,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Info,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TokenLogo } from "@/components/TokenLogo";
import { TradeTabs, type TradeTab } from "@/components/trade/TradeTabs";
import {
  TokenPickerDialog,
  pushRecentToken,
  type TokenMeta,
} from "@/components/trade/TokenPickerDialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

const SOL_TOKEN: TokenMeta = {
  symbol: "SOL",
  name: "Solana",
  address: "So11111111111111111111111111111111111111112",
  decimals: 9,
  logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  priceUsd: null,
};

const SLIPPAGE_PRESETS = [
  { label: "0.1%", bps: 10 },
  { label: "0.5%", bps: 50 },
  { label: "1.0%", bps: 100 },
];

const QUOTE_DEBOUNCE_MS = 350;
const QUOTE_REFRESH_MS = 15_000;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

interface QuoteData {
  input: TokenMeta & { amountUi: number; amountAtomic: number; valueUsd: number | null };
  output: TokenMeta & { amountUi: number; amountAtomic: number; valueUsd: number | null };
  rate: number;
  priceImpactPct: number | null;
  slippageBps: number;
  route: { ammKey: string | null; label: string; inputMint: string | null; outputMint: string | null }[];
  estNetworkFeeSol: number;
  platformFee: { bps: number; amountUi: number; symbol: string; valueUsd: number | null } | null;
}

type Phase =
  | { name: "idle" }
  | { name: "building" }
  | { name: "awaiting_signature" }
  | { name: "submitting" }
  | { name: "confirming"; signature: string; startedAt: number }
  | { name: "success"; signature: string; durationMs: number; outUi: number; outSymbol: string; inUi: number; inSymbol: string }
  | { name: "cancelled"; inUi: number; inSymbol: string; outUi: number; outSymbol: string }
  | { name: "error"; message: string };

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "$0.00";
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toExponential(2)}`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
};
const fmtAmount = (n: number) => {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.000001) return n.toExponential(3);
  if (Math.abs(n) < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (Math.abs(n) < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
const truncSig = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

const impactBucket = (pct: number | null) => {
  if (pct == null) return { color: "text-muted-foreground" };
  const a = Math.abs(pct);
  if (a < 1) return { color: "text-up" };
  if (a < 3) return { color: "text-amber-400" };
  return { color: "text-down" };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const supaPost = async (fn: string, body: unknown, attempt = 0): Promise<any> => {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as any).context;
    let serverMsg: string | null = null;
    let status: number | undefined;
    if (ctx) {
      status = ctx.status;
      if (typeof ctx.json === "function") {
        try {
          const parsed = await ctx.json();
          if (parsed?.error) serverMsg = String(parsed.error);
        } catch { /* ignore */ }
      }
    }
    // Transparently retry transient cold-start / runtime failures
    const transient =
      status === 503 ||
      status === 504 ||
      (serverMsg ?? error.message ?? "").toLowerCase().includes("temporarily unavailable") ||
      (serverMsg ?? error.message ?? "").toLowerCase().includes("runtime_error");
    if (transient && attempt < 2) {
      await sleep(400 * (attempt + 1));
      return supaPost(fn, body, attempt + 1);
    }
    throw new Error(serverMsg ?? error.message ?? `${fn} failed`);
  }
  if (data && typeof data === "object" && "error" in (data as any) && (data as any).error) {
    throw new Error((data as any).error);
  }
  return data;
};

interface TradeSwapProps {
  tab: TradeTab;
  onTabChange: (t: TradeTab) => void;
}

export const TradeSwap = ({ tab, onTabChange }: TradeSwapProps) => {
  const [inputToken, setInputToken] = useState<TokenMeta>(SOL_TOKEN);
  const [outputToken, setOutputToken] = useState<TokenMeta | null>(null);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [customSlippage, setCustomSlippage] = useState("");
  const [dynamicSlippage, setDynamicSlippage] = useState(true);

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [pickerSide, setPickerSide] = useState<"in" | "out" | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [inputBalance, setInputBalance] = useState<number | null>(null);

  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Load balance for whichever token is selected on the input side.
  // SOL → native lamports; SPL → sum of parsed token accounts for that mint.
  useEffect(() => {
    if (!connected || !publicKey) {
      setInputBalance(null);
      return;
    }
    let cancelled = false;
    const owner = new PublicKey(publicKey.toBase58());
    setInputBalance(null);
    (async () => {
      try {
        if (inputToken.address === SOL_TOKEN.address) {
          const lamports = await connection.getBalance(owner);
          if (!cancelled) setInputBalance(lamports / LAMPORTS_PER_SOL);
        } else {
          const mint = new PublicKey(inputToken.address);
          const resp = await connection.getParsedTokenAccountsByOwner(owner, { mint });
          let total = 0;
          for (const acc of resp.value) {
            const ui = acc.account.data.parsed?.info?.tokenAmount?.uiAmount;
            if (typeof ui === "number") total += ui;
          }
          if (!cancelled) setInputBalance(total);
        }
      } catch {
        if (!cancelled) setInputBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection, inputToken.address, phase.name]);


  const numericAmount = useMemo(() => {
    const n = parseFloat(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  // Debounced quote fetch.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!outputToken || numericAmount <= 0) {
      setQuoteLoading(false);
      return;
    }
    setQuoteLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const fresh = await supaPost("swap-quote", {
          inputToken: inputToken.address,
          outputToken: outputToken.address,
          amount: numericAmount,
          slippageBps,
          dynamicSlippage,
        });
        if (!mounted.current) return;
        setQuote(fresh);
        setQuoteError(null);
      } catch (e) {
        if (!mounted.current) return;
        setQuote(null);
        setQuoteError(e instanceof Error ? e.message : "Couldn't fetch quote");
      } finally {
        if (mounted.current) setQuoteLoading(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [inputToken.address, outputToken?.address, numericAmount, slippageBps, dynamicSlippage]);

  // Auto-refresh quote every 15s while idle and we have one.
  useEffect(() => {
    if (!quote || phase.name !== "idle" || !outputToken) return;
    const timer = window.setInterval(async () => {
      if (!mounted.current) return;
      setRefreshing(true);
      try {
        const fresh = await supaPost("swap-quote", {
          inputToken: inputToken.address,
          outputToken: outputToken.address,
          amount: numericAmount,
          slippageBps,
          dynamicSlippage,
        });
        if (mounted.current && !fresh.error) {
          setQuote(fresh);
          setQuoteError(null);
        }
      } catch {
        /* keep stale quote */
      } finally {
        if (mounted.current) setRefreshing(false);
      }
    }, QUOTE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [quote, phase.name, inputToken.address, outputToken?.address, numericAmount, slippageBps]);

  const flip = () => {
    if (!outputToken) return;
    const newIn = outputToken;
    const newOut = inputToken;
    setInputToken(newIn);
    setOutputToken(newOut);
    if (quote) {
      setAmount(String(quote.output.amountUi || ""));
    }
  };

  const handleAmountChange = (v: string) => {
    // Allow only digits and a single dot.
    if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
  };

  const handleMax = () => {
    if (inputBalance == null) return;
    if (inputToken.address === SOL_TOKEN.address) {
      // Reserve a bit for rent + fees on native SOL
      const reserve = 0.01;
      const max = Math.max(0, inputBalance - reserve);
      setAmount(max > 0 ? max.toFixed(6) : "");
    } else {
      // SPL tokens — full balance is spendable
      setAmount(inputBalance > 0 ? String(inputBalance) : "");
    }
  };

  const handlePickToken = (t: TokenMeta) => {
    if (pickerSide === "in") {
      if (outputToken && outputToken.address === t.address) {
        setOutputToken(inputToken);
      }
      setInputToken(t);
    } else if (pickerSide === "out") {
      if (inputToken.address === t.address) {
        setInputToken(outputToken ?? SOL_TOKEN);
      }
      setOutputToken(t);
    }
    pushRecentToken(t);
  };

  const insufficient =
    inputBalance != null &&
    numericAmount > 0 &&
    numericAmount >
      (inputToken.address === SOL_TOKEN.address
        ? Math.max(0, inputBalance - 0.005)
        : inputBalance);


  const handleSwap = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction || !quote || !outputToken) return;
    const startedAt = Date.now();
    try {
      setPhase({ name: "building" });
      const built = await supaPost("swap-build", {
        userPublicKey: publicKey.toBase58(),
        inputMint: quote.input.address,
        outputMint: quote.output.address,
        amount: quote.input.amountAtomic,
        slippageBps: quote.slippageBps,
      });
      if (!built.swapTransaction) throw new Error("No transaction returned");

      setPhase({ name: "awaiting_signature" });
      const txBytes = Uint8Array.from(atob(built.swapTransaction), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);

      let signed: VersionedTransaction;
      try {
        signed = await signTransaction(tx);
      } catch {
        if (mounted.current) setPhase({
          name: "cancelled",
          inUi: quote.input.amountUi,
          inSymbol: quote.input.symbol,
          outUi: quote.output.amountUi,
          outSymbol: quote.output.symbol,
        });
        return;
      }

      setPhase({ name: "submitting" });
      const signedB64 = btoa(String.fromCharCode(...signed.serialize()));
      const submitted = await supaPost("tx-submit", {
        signedTransaction: signedB64,
        kind: "swap",
        valueUsd: quote.input.valueUsd ?? quote.output.valueUsd ?? null,
        inputMint: quote.input.address,
        outputMint: quote.output.address,
        inputAmount: quote.input.amountUi,
        outputAmount: quote.output.amountUi,
        walletAddress: publicKey.toBase58(),
      });
      const signature = submitted.signature as string;
      if (!signature) throw new Error("No signature returned from submit");

      setPhase({ name: "confirming", signature, startedAt });
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (!mounted.current) return;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const status = await supaPost("tx-status", { signature });
          if (status.status === "confirmed") {
            if (!mounted.current) return;
            // Record the per-user platform fee. Best-effort — never block UX.
            void supaPost("record-swap-fee", {
              signature,
              valueUsd: quote.input.valueUsd ?? quote.output.valueUsd ?? null,
              feeUsd: quote.platformFee?.valueUsd ?? null,
              feeAmountUi: quote.platformFee?.amountUi ?? null,
              feeSymbol: quote.platformFee?.symbol ?? null,
              feeMint: quote.output.address,
              inputMint: quote.input.address,
              outputMint: quote.output.address,
            }).catch((e) => console.warn("record-swap-fee failed:", e));
            setPhase({
              name: "success",
              signature,
              durationMs: Date.now() - startedAt,
              outUi: quote.output.amountUi,
              outSymbol: quote.output.symbol,
              inUi: quote.input.amountUi,
              inSymbol: quote.input.symbol,
            });
            return;
          }
          if (status.status === "failed") {
            throw new Error(status.err ?? "Transaction failed on-chain");
          }
        } catch {
          continue;
        }
      }
      throw new Error("Confirmation timed out. Check Solscan for status.");
    } catch (e) {
      if (!mounted.current) return;
      setPhase({ name: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }, [connected, publicKey, signTransaction, quote, outputToken]);

  const resetSwap = () => {
    setAmount("");
    setQuote(null);
    setPhase({ name: "idle" });
  };

  // ---------- Success view ----------
  if (phase.name === "success") {
    return (
      <div className="ease-vision animate-fade-up w-full max-w-[440px] overflow-hidden rounded-2xl border border-up/30 bg-card/60 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-up/40 bg-up/10">
            <CheckCircle2 className="h-7 w-7 text-up" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Swap confirmed
            </p>
            <p className="mt-2 font-mono text-sm text-foreground">
              {fmtAmount(phase.inUi)} {phase.inSymbol} → {fmtAmount(phase.outUi)} {phase.outSymbol}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              in {(phase.durationMs / 1000).toFixed(1)}s
            </p>
          </div>
          <a
            href={`https://solscan.io/tx/${phase.signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ease-vision inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-secondary"
          >
            View tx {truncSig(phase.signature)}
            <ExternalLink className="h-3 w-3" />
          </a>
          <Button
            onClick={resetSwap}
            className="ease-vision mt-2 w-full font-mono text-[11px] uppercase tracking-wider"
          >
            New swap
          </Button>
        </div>
      </div>
    );
  }

  // ---------- Cancelled view ----------
  if (phase.name === "cancelled") {
    return (
      <div className="ease-vision animate-fade-up w-full max-w-[440px] overflow-hidden rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-muted-foreground/30 bg-muted/30">
            <XCircle className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Swap cancelled
            </p>
            <p className="mt-2 font-mono text-sm text-foreground">
              {fmtAmount(phase.inUi)} {phase.inSymbol} → {fmtAmount(phase.outUi)} {phase.outSymbol}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              No funds were moved.
            </p>
          </div>
          <Button
            onClick={resetSwap}
            className="ease-vision mt-2 w-full font-mono text-[11px] uppercase tracking-wider"
          >
            New swap
          </Button>
        </div>
      </div>
    );
  }

  // ---------- CTA computation ----------
  const isBusy =
    phase.name === "building" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting" ||
    phase.name === "confirming";

  const busyLabel =
    phase.name === "building"
      ? "Building transaction…"
      : phase.name === "awaiting_signature"
        ? "Approve in wallet…"
        : phase.name === "submitting"
          ? "Submitting…"
          : phase.name === "confirming"
            ? "Confirming on-chain…"
            : "";

  let ctaLabel = "Swap";
  let ctaDisabled = false;
  let ctaAction: (() => void) | null = handleSwap;

  if (!connected) {
    ctaLabel = "Connect wallet";
    ctaAction = () => setVisible(true);
  } else if (!outputToken) {
    ctaLabel = "Select a token";
    ctaDisabled = true;
    ctaAction = null;
  } else if (numericAmount <= 0) {
    ctaLabel = "Enter an amount";
    ctaDisabled = true;
    ctaAction = null;
  } else if (insufficient) {
    ctaLabel = `Insufficient ${inputToken.symbol}`;
    ctaDisabled = true;
    ctaAction = null;
  } else if (quoteLoading) {
    ctaLabel = "Fetching best price…";
    ctaDisabled = true;
    ctaAction = null;
  } else if (quoteError) {
    ctaLabel = "Retry";
    ctaAction = () => setAmount((a) => a); // re-trigger by touching state
  } else if (isBusy) {
    ctaLabel = busyLabel;
    ctaDisabled = true;
    ctaAction = null;
  }

  const impact = impactBucket(quote?.priceImpactPct ?? null);
  const routeLabels = quote?.route?.length
    ? Array.from(new Set(quote.route.map((r) => r.label))).join(" → ")
    : "Direct";
  const routeHops = quote?.route?.length ?? 0;

  const inUsd =
    quote?.input.valueUsd ??
    (inputToken.priceUsd != null && numericAmount > 0 ? inputToken.priceUsd * numericAmount : null);
  const outUsd = quote?.output.valueUsd ?? null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="w-full max-w-[440px] space-y-4">
        {/* Tabs row — tabs centered over card, gear floats to the right */}
        <div className="relative flex items-center justify-center">
          <TradeTabs active={tab} onChange={onTabChange} />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="ease-vision absolute right-0 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground sm:-right-12"
                aria-label="Settings"
              >
                <SettingsIcon className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Slippage tolerance
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                {SLIPPAGE_PRESETS.map((p) => (
                  <button
                    key={p.bps}
                    type="button"
                    onClick={() => {
                      setSlippageBps(p.bps);
                      setCustomSlippage("");
                    }}
                    className={cn(
                      "ease-vision flex-1 rounded-md border px-2 py-1.5 font-mono text-[11px]",
                      slippageBps === p.bps && !customSlippage
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={customSlippage}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*\.?\d*$/.test(v)) {
                      setCustomSlippage(v);
                      const n = parseFloat(v);
                      if (Number.isFinite(n) && n > 0) {
                        setSlippageBps(Math.min(5000, Math.max(1, Math.round(n * 100))));
                      }
                    }
                  }}
                  placeholder="Custom"
                  className="h-8 text-xs"
                />
                <span className="font-mono text-[11px] text-muted-foreground">%</span>
              </div>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                Higher slippage routes more reliably but may give a worse price.
              </p>
            </PopoverContent>
          </Popover>
        </div>

        {/* Card */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm shadow-soft">
          {/* Sell side */}
          <SwapSide
            label="Sell"
            token={inputToken}
            amount={amount}
            onAmountChange={handleAmountChange}
            usd={inUsd}
            balance={inputBalance}
            onMax={inputBalance != null && inputBalance > 0 ? handleMax : undefined}
            onPickToken={() => setPickerSide("in")}
            readOnly={false}
          />

          {/* Flip */}
          <div className="relative">
            <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center">
              <button
                type="button"
                onClick={flip}
                disabled={!outputToken}
                className={cn(
                  "ease-vision flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors",
                  outputToken
                    ? "hover:border-primary/40 hover:text-foreground"
                    : "cursor-not-allowed opacity-50",
                )}
                aria-label="Flip tokens"
              >
                <ArrowDownUp className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="border-t border-border/60" />
          </div>

          {/* Buy side */}
          <SwapSide
            label="Buy"
            token={outputToken}
            amount={
              quoteLoading
                ? ""
                : quote
                  ? fmtAmount(quote.output.amountUi)
                  : ""
            }
            onAmountChange={() => { /* output is read-only */ }}
            usd={outUsd}
            balance={null}
            onPickToken={() => setPickerSide("out")}
            readOnly
            loading={quoteLoading}
          />

          {/* Stats */}
          {quote && (
            <div className="space-y-1.5 border-t border-border/40 px-5 py-3">
              <StatsRow
                label="Rate"
                value={
                  <span className="font-mono text-[12px] text-foreground">
                    1 {quote.input.symbol} = {fmtAmount(quote.rate)} {quote.output.symbol}
                  </span>
                }
                right={
                  refreshing ? (
                    <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                  ) : null
                }
              />
              <StatsRow
                label="Price impact"
                value={
                  <span className={cn("font-mono text-[12px]", impact.color)}>
                    {quote.priceImpactPct != null ? `${quote.priceImpactPct.toFixed(2)}%` : "—"}
                  </span>
                }
              />
              <StatsRow
                label="Slippage"
                value={
                  <span className="font-mono text-[12px] text-foreground">
                    {(quote.slippageBps / 100).toFixed(2)}%
                  </span>
                }
              />
              <StatsRow
                label="Route"
                value={
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {routeHops > 0 ? `${routeHops} hop${routeHops > 1 ? "s" : ""} · ${routeLabels}` : "Direct"}
                  </span>
                }
              />
              <StatsRow
                label="Network fee"
                value={
                  <span className="font-mono text-[12px] text-muted-foreground">
                    ~{quote.estNetworkFeeSol.toFixed(6)} SOL
                  </span>
                }
              />
              {quote.platformFee && quote.platformFee.bps > 0 && (
                <StatsRow
                  label={
                    <span className="flex items-center gap-1">
                      Platform fee
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-muted-foreground/60 hover:text-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[240px]">
                          <p className="font-mono text-[11px] leading-relaxed">
                            Vision charges a {(quote.platformFee.bps / 100).toFixed(0)}% fee in the output token. Transfers and bridges are free.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  }
                  value={
                    <span className="font-mono text-[12px] text-muted-foreground">
                      {(quote.platformFee.bps / 100).toFixed(2)}% (~{fmtAmount(quote.platformFee.amountUi)} {quote.platformFee.symbol})
                    </span>
                  }
                />
              )}
            </div>
          )}

          {/* Inline error */}
          {quoteError && !quoteLoading && (
            <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
              <p className="font-mono text-[11px] leading-relaxed text-destructive">{quoteError}</p>
            </div>
          )}

          {phase.name === "error" && (
            <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
              <p className="font-mono text-[11px] leading-relaxed text-destructive">
                {(phase as Extract<Phase, { name: "error" }>).message}
              </p>
            </div>
          )}

          {/* CTA */}
          <div className="border-t border-border/40 bg-secondary/30 p-3">
            <Button
              onClick={() => {
                if (phase.name === "error") {
                  setPhase({ name: "idle" });
                  return;
                }
                ctaAction?.();
              }}
              disabled={ctaDisabled || isBusy}
              className={cn(
                "ease-vision h-12 w-full rounded-xl font-mono text-[12px] uppercase tracking-wider",
                connected && !ctaDisabled && "bg-primary text-primary-foreground shadow-glow hover:bg-primary/90",
              )}
            >
              {(isBusy || quoteLoading) && (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              )}
              {phase.name === "error" ? "Try again" : ctaLabel}
            </Button>
          </div>
        </div>

        {/* Token picker */}
        <TokenPickerDialog
          open={pickerSide !== null}
          onOpenChange={(o) => !o && setPickerSide(null)}
          onSelect={handlePickToken}
          excludeAddress={
            pickerSide === "in" ? outputToken?.address : pickerSide === "out" ? inputToken.address : undefined
          }
        />
      </div>
    </TooltipProvider>
  );
};

// ---------- subcomponents ----------

const SwapSide = ({
  label,
  token,
  amount,
  onAmountChange,
  usd,
  balance,
  onMax,
  onPickToken,
  readOnly = false,
  loading = false,
}: {
  label: string;
  token: TokenMeta | null;
  amount: string;
  onAmountChange: (v: string) => void;
  usd: number | null;
  balance: number | null;
  onMax?: () => void;
  onPickToken: () => void;
  readOnly?: boolean;
  loading?: boolean;
}) => {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {balance != null && (
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span>Balance: {fmtAmount(balance)}</span>
            {onMax && (
              <button
                type="button"
                onClick={onMax}
                className="ease-vision rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary hover:bg-primary/20"
              >
                Max
              </button>
            )}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {loading ? (
            <div className="h-9 w-32 animate-pulse rounded-md bg-secondary/60" />
          ) : (
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              readOnly={readOnly}
              placeholder="0.00"
              className={cn(
                "w-full bg-transparent font-mono text-3xl font-light text-foreground outline-none placeholder:text-muted-foreground/40",
                readOnly && "cursor-default",
              )}
            />
          )}
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {usd != null ? fmtUsd(usd) : "$0.00"}
          </p>
        </div>
        <button
          type="button"
          onClick={onPickToken}
          className={cn(
            "ease-vision flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-secondary px-2.5 py-1.5 transition-colors hover:bg-muted",
            !token && "bg-primary/10 border-primary/40 hover:bg-primary/20",
          )}
        >
          {token ? (
            <>
              <TokenLogo logo={token.logo} symbol={token.symbol} size={24} />
              <span className="font-mono text-sm font-medium text-foreground">{token.symbol}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </>
          ) : (
            <>
              <span className="font-mono text-xs uppercase tracking-wider text-primary">Select token</span>
              <ChevronDown className="h-3.5 w-3.5 text-primary" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

const StatsRow = ({
  label,
  value,
  right,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  right?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-2">
    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">
      {value}
      {right}
    </div>
  </div>
);
