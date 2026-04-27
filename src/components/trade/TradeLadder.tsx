import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Info,
  Loader2,
  Minus,
  Plus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TokenLogo } from "@/components/TokenLogo";
import {
  TokenPickerDialog,
  pushRecentToken,
  type TokenMeta,
} from "@/components/trade/TokenPickerDialog";
import { OpenOrdersList } from "@/components/trade/OpenOrdersList";
import {
  WalletSourcePicker,
  type WalletSource,
} from "@/components/trade/WalletSourcePicker";
import { FundVisionWalletDialog } from "@/components/wallet/FundVisionWalletDialog";
import { ArrowDownToLine } from "lucide-react";
import { useTradeSigner } from "@/hooks/useTradeSigner";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

// Ladder = N parallel limit orders across a price range. Each rung is a real
// Jupiter Trigger v1 limit order, so the 1% platform fee is collected on
// fill via the same feeAccount path as TradeLimit (no upfront sig).

const SOL_TOKEN: TokenMeta = {
  symbol: "SOL",
  name: "Solana",
  address: "So11111111111111111111111111111111111111112",
  decimals: 9,
  logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  priceUsd: null,
};
const USDC_TOKEN: TokenMeta = {
  symbol: "USDC",
  name: "USD Coin",
  address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  decimals: 6,
  logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  priceUsd: 1,
};

type LadderSide = "buy" | "sell";
type Distribution = "equal" | "linear";

const MIN_RUNGS = 2;
const MAX_RUNGS = 10;
const MIN_USD_PER_RUNG = 1;
const MARKET_DEBOUNCE_MS = 350;
const MARKET_REFRESH_MS = 20_000;

const EXPIRY_PRESETS: { label: string; seconds: number | null }[] = [
  { label: "1d", seconds: 86_400 },
  { label: "7d", seconds: 7 * 86_400 },
  { label: "30d", seconds: 30 * 86_400 },
  { label: "Never", seconds: null },
];

type Phase =
  | { name: "idle" }
  | { name: "preparing" }
  | { name: "signing"; current: number; total: number }
  | { name: "submitting"; current: number; total: number }
  | { name: "success"; placed: number; total: number; firstSig: string | null }
  | { name: "error"; message: string; placedSoFar: number };

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "$0.00";
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toExponential(2)}`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
};
const fmtAmount = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (Math.abs(n) < 0.000001) return n.toExponential(3);
  if (Math.abs(n) < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (Math.abs(n) < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
const truncSig = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
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
  if (data && typeof data === "object" && (data as any).error) {
    throw new Error((data as any).error);
  }
  return data;
};

interface Props {
  expirySeconds: number | null;
}

export const TradeLadder = ({ expirySeconds }: Props) => {
  // For BUY: input = quote token (USDC/SOL), output = target asset.
  // For SELL: input = target asset, output = quote token.
  // We let the user pick freely; "Asset" + "Quote" labels handle the framing.
  const [side, setSide] = useState<LadderSide>("buy");
  const [assetToken, setAssetToken] = useState<TokenMeta>(SOL_TOKEN);
  const [quoteToken, setQuoteToken] = useState<TokenMeta>(USDC_TOKEN);
  const [totalAmount, setTotalAmount] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [rungCount, setRungCount] = useState(5);
  const [distribution, setDistribution] = useState<Distribution>("equal");

  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketTick, setMarketTick] = useState(0);

  const [pickerSide, setPickerSide] = useState<"asset" | "quote" | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [balance, setBalance] = useState<number | null>(null);
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);

  const [walletSource, setWalletSource] = useState<WalletSource>("vision");
  const [fundOpen, setFundOpen] = useState(false);

  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const visionWallet = useVisionWallet();
  const signer = useTradeSigner(walletSource);
  const mounted = useRef(true);

  const activePayerAddress =
    walletSource === "vision"
      ? visionWallet.solanaAddress
      : publicKey?.toBase58() ?? null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // The token the user is *spending* from their wallet:
  //   buy  → quote (USDC), sell → asset (target)
  const spendToken = side === "buy" ? quoteToken : assetToken;
  const recvToken = side === "buy" ? assetToken : quoteToken;

  // Balance for the spend-side token (scoped to active wallet source)
  useEffect(() => {
    if (!activePayerAddress) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    let owner: PublicKey;
    try {
      owner = new PublicKey(activePayerAddress);
    } catch {
      setBalance(null);
      return;
    }
    setBalance(null);
    (async () => {
      try {
        if (spendToken.address === SOL_TOKEN.address) {
          const lamports = await connection.getBalance(owner);
          if (!cancelled) setBalance(lamports / LAMPORTS_PER_SOL);
        } else {
          const mint = new PublicKey(spendToken.address);
          const resp = await connection.getParsedTokenAccountsByOwner(owner, { mint });
          let total = 0;
          for (const acc of resp.value) {
            const ui = acc.account.data.parsed?.info?.tokenAmount?.uiAmount;
            if (typeof ui === "number") total += ui;
          }
          if (!cancelled) setBalance(total);
        }
      } catch {
        if (!cancelled) setBalance(null);
      }
    })();
    return () => { cancelled = true; };
  }, [activePayerAddress, connection, spendToken.address, phase.name]);

  // Live USD price of the asset token
  useEffect(() => {
    let cancelled = false;
    setMarketLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const fresh = await supaPost("swap-quote", {
          inputToken: assetToken.address,
          outputToken: USDC_TOKEN.address,
          amount: 1,
          slippageBps: 50,
        });
        if (cancelled || !mounted.current) return;
        const px = (fresh as any)?.input?.priceUsd as number | undefined;
        if (typeof px === "number" && px > 0) setMarketPrice(px);
      } catch {
        /* keep stale */
      } finally {
        if (!cancelled && mounted.current) setMarketLoading(false);
      }
    }, MARKET_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [assetToken.address, marketTick]);

  useEffect(() => {
    if (phase.name !== "idle") return;
    const i = window.setInterval(() => setMarketTick((x) => x + 1), MARKET_REFRESH_MS);
    return () => window.clearInterval(i);
  }, [phase.name]);

  const numericTotal = useMemo(() => {
    const n = parseFloat(totalAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [totalAmount]);
  const numericMin = useMemo(() => {
    const n = parseFloat(minPrice);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [minPrice]);
  const numericMax = useMemo(() => {
    const n = parseFloat(maxPrice);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [maxPrice]);

  const handleAmountChange = (v: string, setter: (s: string) => void) => {
    if (v === "" || /^\d*\.?\d*$/.test(v)) setter(v);
  };

  const handlePickToken = (t: TokenMeta) => {
    if (pickerSide === "asset") {
      if (quoteToken.address === t.address) setQuoteToken(assetToken);
      setAssetToken(t);
    } else if (pickerSide === "quote") {
      if (assetToken.address === t.address) setAssetToken(quoteToken);
      setQuoteToken(t);
    }
    setTotalAmount("");
    setMinPrice("");
    setMaxPrice("");
    pushRecentToken(t);
  };

  // ---- Compute the rung schedule ----
  // Prices are evenly spaced from min..max. Weights determine how the total
  // spend is split across rungs. For "linear":
  //   buy  → weight more capital toward LOWER prices (better entry)
  //   sell → weight more capital toward HIGHER prices (better exit)
  const rungs = useMemo(() => {
    if (rungCount < MIN_RUNGS || numericMin <= 0 || numericMax <= 0 || numericTotal <= 0) {
      return [];
    }
    if (numericMin >= numericMax) return [];

    const prices: number[] = [];
    if (rungCount === 1) {
      prices.push((numericMin + numericMax) / 2);
    } else {
      const step = (numericMax - numericMin) / (rungCount - 1);
      for (let i = 0; i < rungCount; i++) prices.push(numericMin + step * i);
    }

    // Weights — both arrays are length rungCount, indexed low→high price.
    let weights: number[];
    if (distribution === "equal") {
      weights = new Array(rungCount).fill(1);
    } else {
      // Linear: 1 at the "good" end, 2 at the other. So buy puts MORE weight
      // on low prices (index 0 = 2, index N-1 = 1), sell flips it.
      weights = prices.map((_, i) => {
        const t = rungCount === 1 ? 0.5 : i / (rungCount - 1);
        // buy: 2 → 1 (decreasing). sell: 1 → 2 (increasing).
        return side === "buy" ? 2 - t : 1 + t;
      });
    }
    const sum = weights.reduce((a, b) => a + b, 0);

    return prices.map((price, i) => {
      const share = weights[i] / sum;
      // For BUY: spend = quote tokens; receive = asset = spend / price
      // For SELL: spend = asset tokens; receive = quote = spend * price
      const spendUi = numericTotal * share;
      const recvUi = side === "buy" ? spendUi / price : spendUi * price;
      return { price, spendUi, recvUi };
    });
  }, [rungCount, numericMin, numericMax, numericTotal, distribution, side]);

  // Average price (weighted by spend) for the summary line
  const avgPrice = useMemo(() => {
    if (rungs.length === 0) return null;
    const totalSpend = rungs.reduce((a, r) => a + r.spendUi, 0);
    if (totalSpend === 0) return null;
    if (side === "buy") {
      const totalRecv = rungs.reduce((a, r) => a + r.recvUi, 0);
      return totalRecv > 0 ? totalSpend / totalRecv : null;
    }
    // sell
    const totalRecv = rungs.reduce((a, r) => a + r.recvUi, 0);
    return totalRecv > 0 && totalSpend > 0 ? totalRecv / totalSpend : null;
  }, [rungs, side]);

  const totalSpendUsd = useMemo(() => {
    if (numericTotal <= 0) return null;
    if (side === "sell" && marketPrice != null) return numericTotal * marketPrice;
    if (side === "buy" && quoteToken.address === USDC_TOKEN.address) return numericTotal;
    return null;
  }, [numericTotal, side, marketPrice, quoteToken.address]);

  // ---- Validation ----
  const validation = useMemo<string | null>(() => {
    if (numericTotal <= 0) return side === "buy" ? "Enter amount to spend" : "Enter amount to sell";
    if (numericMin <= 0 || numericMax <= 0) return "Set price range";
    if (numericMin >= numericMax) return "Min must be < max";
    if (rungCount < MIN_RUNGS) return `At least ${MIN_RUNGS} rungs`;
    if (rungCount > MAX_RUNGS) return `At most ${MAX_RUNGS} rungs`;
    if (balance != null) {
      const reserve = spendToken.address === SOL_TOKEN.address ? 0.01 : 0;
      if (numericTotal > Math.max(0, balance - reserve)) {
        return `Insufficient ${spendToken.symbol}`;
      }
    }
    // Min $1 per rung when we can estimate
    if (totalSpendUsd != null && rungs.length > 0) {
      const perRungUsd = totalSpendUsd / rungCount;
      if (perRungUsd < MIN_USD_PER_RUNG) {
        return `Min $${MIN_USD_PER_RUNG} per rung`;
      }
    }
    return null;
  }, [
    numericTotal, numericMin, numericMax, rungCount, balance, spendToken,
    totalSpendUsd, rungs.length, side,
  ]);

  // ---- Submit: sign each rung sequentially ----
  const placeLadder = useCallback(async () => {
    if (!signer.ready || !activePayerAddress) return;
    if (validation || rungs.length === 0) return;

    try {
      setPhase({ name: "preparing" });
      const total = rungs.length;
      const expiredAt = expirySeconds
        ? Math.floor(Date.now() / 1000) + expirySeconds
        : null;

      let firstSig: string | null = null;
      let placed = 0;

      for (let i = 0; i < rungs.length; i++) {
        const rung = rungs[i];
        const inputMint = spendToken.address;
        const outputMint = recvToken.address;
        const makingAmount = Math.floor(rung.spendUi * Math.pow(10, spendToken.decimals));
        const takingAmount = Math.floor(rung.recvUi * Math.pow(10, recvToken.decimals));
        if (makingAmount <= 0 || takingAmount <= 0) {
          throw new Error(`Rung ${i + 1} amount too small`);
        }

        const built = await supaPost("limit-order-build", {
          maker: activePayerAddress,
          inputMint,
          outputMint,
          makingAmount: String(makingAmount),
          takingAmount: String(takingAmount),
          expiredAt,
        });
        const requestId = built?.requestId as string | undefined;
        const txB64 = built?.transaction as string | undefined;
        if (!requestId || !txB64) throw new Error(`Rung ${i + 1}: build failed`);

        if (!mounted.current) return;
        setPhase({ name: "signing", current: i + 1, total });
        const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(txBytes);

        // Sign-only — Jupiter Trigger requires execute via their endpoint.
        let signedB64: string;
        try {
          signedB64 = await signer.signOnly(tx);
        } catch {
          if (mounted.current) {
            setPhase({
              name: "error",
              message:
                placed > 0
                  ? `Cancelled at rung ${i + 1}. ${placed} rung${placed === 1 ? "" : "s"} placed successfully.`
                  : "Cancelled — try again.",
              placedSoFar: placed,
            });
          }
          return;
        }

        if (!mounted.current) return;
        setPhase({ name: "submitting", current: i + 1, total });
        const exec = await supaPost("limit-order-execute", {
          requestId,
          signedTransaction: signedB64,
        });
        const sig = exec?.signature as string | undefined;
        const status = exec?.status as string | undefined;
        if (!sig) throw new Error(`Rung ${i + 1}: ${exec?.error ?? "no signature"}`);
        if (status && status.toLowerCase() === "failed") {
          throw new Error(`Rung ${i + 1}: ${exec?.error ?? "submission failed"}`);
        }
        if (firstSig === null) firstSig = sig;
        placed++;
      }

      if (!mounted.current) return;
      setPhase({ name: "success", placed, total, firstSig });
      setOrdersRefreshKey((x) => x + 1);
    } catch (e) {
      if (!mounted.current) return;
      const placedNow = phase.name === "submitting" || phase.name === "signing"
        ? Math.max(0, phase.current - 1) : 0;
      setPhase({
        name: "error",
        message: e instanceof Error ? e.message : "Something went wrong.",
        placedSoFar: placedNow,
      });
    }
  }, [
    signer, activePayerAddress, validation, rungs, expirySeconds,
    spendToken, recvToken, phase,
  ]);


  const reset = () => {
    setTotalAmount("");
    setMinPrice("");
    setMaxPrice("");
    setPhase({ name: "idle" });
    setOrdersRefreshKey((x) => x + 1);
  };

  // ---- Success view ----
  if (phase.name === "success") {
    return (
      <div className="w-full max-w-[440px] space-y-4">
        <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-up/30 bg-card/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-up/40 bg-up/10">
              <CheckCircle2 className="h-7 w-7 text-up" />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Ladder placed
              </p>
              <p className="mt-2 font-mono text-sm text-foreground">
                {phase.placed} {side === "buy" ? "buy" : "sell"} rung{phase.placed === 1 ? "" : "s"} on {assetToken.symbol}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {fmtUsd(numericMin)} → {fmtUsd(numericMax)}
              </p>
            </div>
            {phase.firstSig && (
              <a
                href={`https://solscan.io/tx/${phase.firstSig}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ease-vision inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-secondary"
              >
                First rung {truncSig(phase.firstSig)}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Button
              onClick={reset}
              className="ease-vision mt-2 w-full font-mono text-[11px] uppercase tracking-wider"
            >
              New ladder
            </Button>
          </div>
        </div>
        <OpenOrdersList refreshKey={ordersRefreshKey} />
      </div>
    );
  }

  // ---- CTA ----
  const isBusy =
    phase.name === "preparing" ||
    phase.name === "signing" ||
    phase.name === "submitting";

  const busyLabel =
    phase.name === "preparing" ? "Preparing rungs…"
    : phase.name === "signing" ? `Sign rung ${phase.current} of ${phase.total}…`
    : phase.name === "submitting" ? `Submitting rung ${phase.current} of ${phase.total}…`
    : "";

  let ctaLabel = `Place ${rungCount}-rung ${side === "buy" ? "buy" : "sell"} ladder`;
  let ctaDisabled = false;
  let ctaAction: (() => void) | null = placeLadder;
  if (walletSource === "vision" && !visionWallet.solanaAddress) {
    ctaLabel = visionWallet.working ? "Creating wallet…" : "Create Vision Wallet";
    ctaDisabled = visionWallet.working;
    ctaAction = () => {
      visionWallet.createWallet().catch(() => { /* hook toasts */ });
    };
  } else if (walletSource === "external" && !connected) {
    ctaLabel = "Connect wallet";
    ctaAction = () => setVisible(true);
  } else if (validation) {
    ctaLabel = validation;
    ctaDisabled = true;
    ctaAction = null;
  } else if (isBusy) {
    ctaLabel = busyLabel;
    ctaDisabled = true;
    ctaAction = null;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="w-full max-w-[440px] space-y-4">
        <WalletSourcePicker
          value={walletSource}
          onChange={setWalletSource}
          visionAvailable
          externalAvailable={connected}
          onCreateVision={() => {
            visionWallet.createWallet().catch(() => { /* hook toasts */ });
          }}
          onConnectExternal={() => setVisible(true)}
        />
        <div className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm shadow-soft">
          {/* Side toggle */}
          <div className="flex items-center gap-1 border-b border-border/60 bg-secondary/20 p-1">
            <SideButton
              active={side === "buy"}
              onClick={() => { setSide("buy"); setTotalAmount(""); }}
              icon={<TrendingDown className="h-3 w-3" />}
              label="Buy ladder"
              hint="Accumulate on dips"
            />
            <SideButton
              active={side === "sell"}
              onClick={() => { setSide("sell"); setTotalAmount(""); }}
              icon={<TrendingUp className="h-3 w-3" />}
              label="Sell ladder"
              hint="Scale out into pumps"
            />
          </div>

          {/* Asset selector */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Asset
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {marketLoading ? "…" : marketPrice != null ? `Market: ${fmtUsd(marketPrice)}` : ""}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setPickerSide("asset")}
                className="ease-vision flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-secondary px-2.5 py-1.5 transition-colors hover:bg-muted"
              >
                <TokenLogo logo={assetToken.logo} symbol={assetToken.symbol} size={24} />
                <span className="font-mono text-sm font-medium text-foreground">{assetToken.symbol}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={() => setMarketTick((x) => x + 1)}
                className="ease-vision rounded-full border border-border/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="border-t border-border/60" />

          {/* Total spend */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {side === "buy" ? "Total to spend" : "Total to sell"}
              </span>
              {balance != null && (
                <button
                  type="button"
                  onClick={() => {
                    const reserve = spendToken.address === SOL_TOKEN.address ? 0.01 : 0;
                    const max = Math.max(0, balance - reserve);
                    setTotalAmount(max > 0 ? max.toFixed(spendToken.address === SOL_TOKEN.address ? 6 : 4) : "");
                  }}
                  className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Max: {fmtAmount(balance)} {spendToken.symbol}
                </button>
              )}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <input
                  inputMode="decimal"
                  value={totalAmount}
                  onChange={(e) => handleAmountChange(e.target.value, setTotalAmount)}
                  placeholder="0.00"
                  className="w-full bg-transparent font-mono text-3xl font-light text-foreground outline-none placeholder:text-muted-foreground/40"
                />
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {totalSpendUsd != null ? fmtUsd(totalSpendUsd) : "$0.00"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerSide("quote")}
                disabled={side === "sell"}
                className={cn(
                  "ease-vision flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-secondary px-2.5 py-1.5 transition-colors",
                  side === "buy" ? "hover:bg-muted" : "opacity-60",
                )}
              >
                <TokenLogo logo={spendToken.logo} symbol={spendToken.symbol} size={24} />
                <span className="font-mono text-sm font-medium text-foreground">{spendToken.symbol}</span>
                {side === "buy" && <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            </div>
          </div>

          {/* Zero-balance fund prompt — only when paying with Vision Wallet */}
          {walletSource === "vision" &&
            visionWallet.solanaAddress &&
            balance != null &&
            balance <= 0 && (
              <button
                type="button"
                onClick={() => setFundOpen(true)}
                className="ease-vision flex w-full items-center justify-between gap-2 border-t border-primary/20 bg-primary/5 px-5 py-2.5 text-left hover:bg-primary/10"
              >
                <span className="flex items-center gap-2 font-mono text-[11px] text-primary">
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                  No {spendToken.symbol} in your Vision Wallet
                </span>
                <span className="font-mono text-[11px] text-primary">Deposit →</span>
              </button>
            )}

          <div className="border-t border-border/60" />

          {/* Price range */}
          <div className="space-y-3 px-5 py-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Price range (USD)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <PriceField
                label="Min"
                value={minPrice}
                onChange={(v) => handleAmountChange(v, setMinPrice)}
                marketPrice={marketPrice}
              />
              <PriceField
                label="Max"
                value={maxPrice}
                onChange={(v) => handleAmountChange(v, setMaxPrice)}
                marketPrice={marketPrice}
              />
            </div>
            {marketPrice != null && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setMinPrice((marketPrice * 0.9).toFixed(2));
                    setMaxPrice((marketPrice * 1.1).toFixed(2));
                  }}
                  className="ease-vision rounded-full border border-border/60 bg-secondary/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  ±10%
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMinPrice((marketPrice * 0.8).toFixed(2));
                    setMaxPrice((marketPrice * 1.2).toFixed(2));
                  }}
                  className="ease-vision rounded-full border border-border/60 bg-secondary/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  ±20%
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMinPrice((marketPrice * 0.5).toFixed(2));
                    setMaxPrice((marketPrice * 1.5).toFixed(2));
                  }}
                  className="ease-vision rounded-full border border-border/60 bg-secondary/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  ±50%
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-border/60" />

          {/* Rung count + distribution */}
          <div className="space-y-3 px-5 py-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Rungs
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRungCount((c) => Math.max(MIN_RUNGS, c - 1))}
                  className="ease-vision flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Fewer rungs"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-6 text-center font-mono text-sm font-medium text-foreground">
                  {rungCount}
                </span>
                <button
                  type="button"
                  onClick={() => setRungCount((c) => Math.min(MAX_RUNGS, c + 1))}
                  className="ease-vision flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="More rungs"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Distribution
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground focus:outline-none"
                      aria-label="Distribution info"
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="start"
                    sideOffset={6}
                    collisionPadding={12}
                    className="max-w-[260px]"
                  >
                    <p className="font-mono text-[11px] leading-relaxed">
                      <span className="font-medium">Equal:</span> same size on every rung.<br />
                      <span className="font-medium">Linear:</span> {side === "buy"
                        ? "more capital toward LOWER prices (better entries)."
                        : "more capital toward HIGHER prices (better exits)."}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </span>
              <div className="flex items-center gap-0.5 rounded-full border border-border/60 bg-secondary/30 p-0.5">
                <DistChip
                  active={distribution === "equal"}
                  onClick={() => setDistribution("equal")}
                  label="Equal"
                />
                <DistChip
                  active={distribution === "linear"}
                  onClick={() => setDistribution("linear")}
                  label="Linear"
                />
              </div>
            </div>
          </div>

          {/* Rung preview */}
          {rungs.length > 0 && (
            <div className="border-t border-border/40 bg-secondary/10 px-5 py-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Preview
              </p>
              <div className="mt-2 max-h-[140px] space-y-1 overflow-y-auto pr-1">
                {rungs.map((r, i) => (
                  <div key={i} className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-muted-foreground">
                      #{i + 1} @ {fmtUsd(r.price)}
                    </span>
                    <span className="text-foreground">
                      {side === "buy"
                        ? `${fmtAmount(r.spendUi)} ${spendToken.symbol} → ${fmtAmount(r.recvUi)} ${recvToken.symbol}`
                        : `${fmtAmount(r.spendUi)} ${spendToken.symbol} → ${fmtAmount(r.recvUi)} ${recvToken.symbol}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="space-y-1.5 border-t border-border/40 px-5 py-3">
            <StatsRow
              label="Avg fill price"
              value={
                <span className="font-mono text-[12px] text-foreground">
                  {avgPrice != null ? fmtUsd(avgPrice) : "—"}
                </span>
              }
            />
            <StatsRow
              label="Order expiry"
              value={
                <span className="font-mono text-[12px] text-muted-foreground">
                  {expirySeconds == null
                    ? "Never"
                    : expirySeconds >= 86_400
                      ? `${Math.round(expirySeconds / 86_400)}d`
                      : `${Math.round(expirySeconds / 3600)}h`}
                </span>
              }
            />
            <StatsRow
              label={
                <span className="flex items-center gap-1">
                  Platform fee
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground focus:outline-none"
                        aria-label="Platform fee info"
                      >
                        <Info className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="start"
                      sideOffset={6}
                      collisionPadding={12}
                      className="max-w-[240px]"
                    >
                      <p className="font-mono text-[11px] leading-relaxed">
                        1% taken from the output token only when each rung fills.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </span>
              }
              value={
                <span className="font-mono text-[12px] text-muted-foreground">
                  1% on fill
                </span>
              }
            />
          </div>

          {/* Inline error */}
          {phase.name === "error" && (
            <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
              <p className="font-mono text-[11px] leading-relaxed text-destructive">
                {phase.message}
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
              {isBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {phase.name === "error" ? "Try again" : ctaLabel}
            </Button>
          </div>
        </div>

        <p className="px-1 text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
          Each rung is an independent limit order. You'll sign once per rung — cancel any rung
          individually from your open orders.
        </p>

        <OpenOrdersList refreshKey={ordersRefreshKey} />

        <TokenPickerDialog
          open={pickerSide !== null}
          onOpenChange={(o) => !o && setPickerSide(null)}
          onSelect={handlePickToken}
          excludeAddress={
            pickerSide === "asset"
              ? quoteToken.address
              : pickerSide === "quote"
                ? assetToken.address
                : undefined
          }
        />

        <FundVisionWalletDialog
          open={fundOpen}
          onOpenChange={setFundOpen}
          defaultChain="solana"
        />
      </div>
    </TooltipProvider>
  );
};

// ---------- subcomponents ----------

const SideButton = ({
  active, onClick, icon, label, hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "ease-vision flex flex-1 flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
      active
        ? "bg-secondary text-foreground shadow-soft"
        : "text-muted-foreground hover:text-foreground",
    )}
    aria-pressed={active}
  >
    <span className="flex items-center gap-1 font-mono text-[11px] font-medium uppercase tracking-wider">
      {icon}
      {label}
    </span>
    <span className="font-mono text-[9px] opacity-80">{hint}</span>
  </button>
);

const PriceField = ({
  label, value, onChange, marketPrice,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  marketPrice: number | null;
}) => (
  <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2 transition-colors focus-within:border-primary/60">
    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {label}
    </span>
    <div className="mt-1 flex items-baseline gap-1.5">
      <span className="font-mono text-base text-muted-foreground">$</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={marketPrice != null ? marketPrice.toFixed(2) : "0.00"}
        className="w-full bg-transparent font-mono text-xl font-light text-foreground outline-none placeholder:text-muted-foreground/40"
      />
    </div>
  </div>
);

const DistChip = ({
  active, onClick, label,
}: { active: boolean; onClick: () => void; label: string }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "ease-vision rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
      active
        ? "bg-secondary text-foreground shadow-soft"
        : "text-muted-foreground hover:text-foreground",
    )}
    aria-pressed={active}
  >
    {label}
  </button>
);

const StatsRow = ({ label, value }: { label: React.ReactNode; value: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">{value}</div>
  </div>
);
