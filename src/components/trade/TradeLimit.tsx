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
  XCircle,
} from "lucide-react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
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
import { LimitPriceField } from "@/components/trade/LimitPriceField";
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

const EXPIRY_PRESETS: { label: string; seconds: number | null }[] = [
  { label: "1d", seconds: 86_400 },
  { label: "7d", seconds: 7 * 86_400 },
  { label: "30d", seconds: 30 * 86_400 },
  { label: "Never", seconds: null },
];

const MARKET_DEBOUNCE_MS = 350;
const MARKET_REFRESH_MS = 20_000;
const MIN_USD_VALUE = 1;

type Phase =
  | { name: "idle" }
  | { name: "building" }
  | { name: "awaiting_signature" }
  | { name: "submitting" }
  | { name: "success"; signature: string; durationMs: number; sellUi: number; sellSymbol: string; buyUi: number; buySymbol: string }
  | { name: "cancelled"; sellUi: number; sellSymbol: string; buyUi: number; buySymbol: string }
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

interface Props {
  tab: TradeTab;
  onTabChange: (t: TradeTab) => void;
}

export const TradeLimit = ({ tab, onTabChange }: Props) => {
  const [inputToken, setInputToken] = useState<TokenMeta>(SOL_TOKEN);
  const [outputToken, setOutputToken] = useState<TokenMeta>(USDC_TOKEN);
  const [sellAmount, setSellAmount] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [expirySeconds, setExpirySeconds] = useState<number | null>(7 * 86_400);

  // Live market rate (output per 1 input). Pulled from swap-quote with a
  // tiny probe amount so we always have a price even when the user hasn't
  // typed yet.
  const [marketRate, setMarketRate] = useState<number | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketRefreshTick, setMarketRefreshTick] = useState(0);
  const [inputUsdPrice, setInputUsdPrice] = useState<number | null>(null);

  const [pickerSide, setPickerSide] = useState<"in" | "out" | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [inputBalance, setInputBalance] = useState<number | null>(null);
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  const [confirmInstantFill, setConfirmInstantFill] = useState(false);

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
  const activePayerReady =
    walletSource === "vision" ? !!visionWallet.solanaAddress : connected;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Balance — scoped to whichever wallet source is active.
  useEffect(() => {
    if (!activePayerAddress) {
      setInputBalance(null);
      return;
    }
    let cancelled = false;
    let owner: PublicKey;
    try {
      owner = new PublicKey(activePayerAddress);
    } catch {
      setInputBalance(null);
      return;
    }
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
  }, [activePayerAddress, connection, inputToken.address, phase.name]);

  // Probe market rate using a representative amount of the input token.
  // Uses 1 unit; we re-quote whenever the pair changes or refresh tick fires.
  useEffect(() => {
    let cancelled = false;
    setMarketLoading(true);
    const probeAmount = 1; // 1 input token, UI units
    const t = window.setTimeout(async () => {
      try {
        const fresh = await supaPost("swap-quote", {
          inputToken: inputToken.address,
          outputToken: outputToken.address,
          amount: probeAmount,
          slippageBps: 50,
        });
        if (cancelled || !mounted.current) return;
        const rate = (fresh as any)?.rate as number | undefined;
        if (typeof rate === "number" && rate > 0) setMarketRate(rate);
        const inUsd = (fresh as any)?.input?.priceUsd as number | undefined;
        if (typeof inUsd === "number") setInputUsdPrice(inUsd);
      } catch {
        if (!cancelled) setMarketRate(null);
      } finally {
        if (!cancelled && mounted.current) setMarketLoading(false);
      }
    }, MARKET_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [inputToken.address, outputToken.address, marketRefreshTick]);

  // Auto-refresh market rate every 20s while idle.
  useEffect(() => {
    if (phase.name !== "idle") return;
    const i = window.setInterval(() => setMarketRefreshTick((x) => x + 1), MARKET_REFRESH_MS);
    return () => window.clearInterval(i);
  }, [phase.name]);

  const numericSell = useMemo(() => {
    const n = parseFloat(sellAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [sellAmount]);
  const numericPrice = useMemo(() => {
    const n = parseFloat(targetPrice);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [targetPrice]);

  const buyAmount = useMemo(() => {
    if (numericSell <= 0 || numericPrice <= 0) return 0;
    return numericSell * numericPrice;
  }, [numericSell, numericPrice]);

  const sellUsd = useMemo(() => {
    const px = inputUsdPrice ?? inputToken.priceUsd;
    return px != null && numericSell > 0 ? numericSell * px : null;
  }, [inputUsdPrice, inputToken.priceUsd, numericSell]);

  const handleAmountChange = (v: string) => {
    if (v === "" || /^\d*\.?\d*$/.test(v)) setSellAmount(v);
  };
  const handleMax = () => {
    if (inputBalance == null) return;
    if (inputToken.address === SOL_TOKEN.address) {
      const reserve = 0.01;
      const max = Math.max(0, inputBalance - reserve);
      setSellAmount(max > 0 ? max.toFixed(6) : "");
    } else {
      setSellAmount(inputBalance > 0 ? String(inputBalance) : "");
    }
  };
  const flip = () => {
    const newIn = outputToken;
    const newOut = inputToken;
    setInputToken(newIn);
    setOutputToken(newOut);
    setSellAmount("");
    setTargetPrice("");
  };
  const handlePickToken = (t: TokenMeta) => {
    if (pickerSide === "in") {
      if (outputToken.address === t.address) setOutputToken(inputToken);
      setInputToken(t);
    } else if (pickerSide === "out") {
      if (inputToken.address === t.address) setInputToken(outputToken);
      setOutputToken(t);
    }
    setSellAmount("");
    setTargetPrice("");
    pushRecentToken(t);
  };

  const insufficient =
    inputBalance != null &&
    numericSell > 0 &&
    numericSell >
      (inputToken.address === SOL_TOKEN.address
        ? Math.max(0, inputBalance - 0.005)
        : inputBalance);

  // Distance from market for safety check.
  const deltaPct = useMemo(() => {
    if (!marketRate || numericPrice <= 0) return null;
    return ((numericPrice - marketRate) / marketRate) * 100;
  }, [marketRate, numericPrice]);

  // For a sell-side limit (input → output), filling instantly = price <= market.
  // We warn when the target is more than 50% worse than market.
  const willFillInstantly = deltaPct != null && deltaPct < -50;

  const tooSmall = sellUsd != null && sellUsd > 0 && sellUsd < MIN_USD_VALUE;

  const placeOrder = useCallback(async () => {
    if (!signer.ready || !activePayerAddress) return;
    if (numericSell <= 0 || numericPrice <= 0) return;
    const startedAt = Date.now();
    try {
      setPhase({ name: "building" });

      const makingAmountAtomic = Math.floor(numericSell * Math.pow(10, inputToken.decimals));
      const takingAmountAtomic = Math.floor(buyAmount * Math.pow(10, outputToken.decimals));
      if (makingAmountAtomic <= 0 || takingAmountAtomic <= 0) {
        throw new Error("Amount too small");
      }

      const expiredAt = expirySeconds ? Math.floor(Date.now() / 1000) + expirySeconds : null;

      const built = await supaPost("limit-order-build", {
        maker: activePayerAddress,
        inputMint: inputToken.address,
        outputMint: outputToken.address,
        makingAmount: String(makingAmountAtomic),
        takingAmount: String(takingAmountAtomic),
        expiredAt,
      });
      const requestId = (built as any).requestId as string;
      const txB64 = (built as any).transaction as string;
      if (!requestId || !txB64) throw new Error("No transaction returned");

      setPhase({ name: "awaiting_signature" });
      const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);

      // Sign — Vision Wallet uses Privy server-side, external uses adapter.
      // Both return base64 signed tx that Jupiter Trigger /execute accepts.
      let signedB64: string;
      try {
        signedB64 = await signer.signOnly(tx);
      } catch {
        if (mounted.current) setPhase({
          name: "cancelled",
          sellUi: numericSell,
          sellSymbol: inputToken.symbol,
          buyUi: buyAmount,
          buySymbol: outputToken.symbol,
        });
        return;
      }

      setPhase({ name: "submitting" });
      const exec = await supaPost("limit-order-execute", {
        requestId,
        signedTransaction: signedB64,
      });
      const signature = (exec as any).signature as string;
      const status = (exec as any).status as string | null;
      if (!signature) {
        const err = (exec as any).error || "No signature returned";
        throw new Error(err);
      }
      if (status && status.toLowerCase() === "failed") {
        throw new Error((exec as any).error || "Order submission failed on-chain");
      }

      if (!mounted.current) return;
      setPhase({
        name: "success",
        signature,
        durationMs: Date.now() - startedAt,
        sellUi: numericSell,
        sellSymbol: inputToken.symbol,
        buyUi: buyAmount,
        buySymbol: outputToken.symbol,
      });
      setOrdersRefreshKey((x) => x + 1);
    } catch (e) {
      if (!mounted.current) return;
      setPhase({ name: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }, [
    signer,
    activePayerAddress,
    numericSell,
    numericPrice,
    buyAmount,
    inputToken,
    outputToken,
    expirySeconds,
  ]);

  const resetOrder = () => {
    setSellAmount("");
    setPhase({ name: "idle" });
    setConfirmInstantFill(false);
    setOrdersRefreshKey((x) => x + 1);
  };

  // ---------- Success view ----------
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
                Limit order placed
              </p>
              <p className="mt-2 font-mono text-sm text-foreground">
                Sell {fmtAmount(phase.sellUi)} {phase.sellSymbol} → {fmtAmount(phase.buyUi)} {phase.buySymbol}
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
              onClick={resetOrder}
              className="ease-vision mt-2 w-full font-mono text-[11px] uppercase tracking-wider"
            >
              New limit order
            </Button>
          </div>
        </div>
        <OpenOrdersList refreshKey={ordersRefreshKey} />
      </div>
    );
  }

  // ---------- Cancelled view ----------
  if (phase.name === "cancelled") {
    return (
      <div className="w-full max-w-[440px] space-y-4">
        <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-muted-foreground/30 bg-muted/30">
              <XCircle className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Limit order cancelled
              </p>
              <p className="mt-2 font-mono text-sm text-foreground">
                Sell {fmtAmount(phase.sellUi)} {phase.sellSymbol} → {fmtAmount(phase.buyUi)} {phase.buySymbol}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                No order was placed.
              </p>
            </div>
            <Button
              onClick={resetOrder}
              className="ease-vision mt-2 w-full font-mono text-[11px] uppercase tracking-wider"
            >
              New limit order
            </Button>
          </div>
        </div>
        <OpenOrdersList refreshKey={ordersRefreshKey} />
      </div>
    );
  }

  // ---------- CTA computation ----------
  const isBusy =
    phase.name === "building" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting";

  const busyLabel =
    phase.name === "building"
      ? "Building order…"
      : phase.name === "awaiting_signature"
        ? walletSource === "vision"
          ? "Signing with Vision Wallet…"
          : "Approve in wallet…"
        : phase.name === "submitting"
          ? "Submitting…"
          : "";

  let ctaLabel = "Place limit order";
  let ctaDisabled = false;
  let ctaAction: (() => void) | null = placeOrder;

  if (walletSource === "vision" && !visionWallet.solanaAddress) {
    ctaLabel = visionWallet.working ? "Creating wallet…" : "Create Vision Wallet";
    ctaDisabled = visionWallet.working;
    ctaAction = () => {
      visionWallet.createWallet().catch(() => { /* hook toasts */ });
    };
  } else if (walletSource === "external" && !connected) {
    ctaLabel = "Connect wallet";
    ctaAction = () => setVisible(true);
  } else if (numericSell <= 0) {
    ctaLabel = "Enter an amount";
    ctaDisabled = true;
    ctaAction = null;
  } else if (numericPrice <= 0) {
    ctaLabel = "Set a target price";
    ctaDisabled = true;
    ctaAction = null;
  } else if (insufficient) {
    ctaLabel = `Insufficient ${inputToken.symbol}`;
    ctaDisabled = true;
    ctaAction = null;
  } else if (tooSmall) {
    ctaLabel = `Min order $${MIN_USD_VALUE}`;
    ctaDisabled = true;
    ctaAction = null;
  } else if (willFillInstantly && !confirmInstantFill) {
    ctaLabel = "Confirm: fills instantly";
    ctaAction = () => setConfirmInstantFill(true);
  } else if (isBusy) {
    ctaLabel = busyLabel;
    ctaDisabled = true;
    ctaAction = null;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="w-full max-w-[440px] space-y-4">
        {/* Tabs row — tabs centered, gear floats right */}
        <div className="relative flex items-center justify-center">
          <TradeTabs active={tab} onChange={onTabChange} />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="ease-vision absolute right-0 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground sm:-right-12"
                aria-label="Order settings"
              >
                <SettingsIcon className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Order expiry
              </p>
              <div className="mt-3 grid grid-cols-4 gap-1.5">
                {EXPIRY_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setExpirySeconds(p.seconds)}
                    className={cn(
                      "ease-vision rounded-md border px-2 py-1.5 font-mono text-[11px]",
                      expirySeconds === p.seconds
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                Order auto-cancels after this period. Vision charges a 1% fee on fill.
              </p>
            </PopoverContent>
          </Popover>
        </div>

        {/* Wallet source picker — Vision recommended */}
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

        {/* Card */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm shadow-soft">
          {/* Sell side */}
          <LimitSide
            label="Sell"
            token={inputToken}
            amount={sellAmount}
            onAmountChange={handleAmountChange}
            usd={sellUsd}
            balance={inputBalance}
            onMax={inputBalance != null && inputBalance > 0 ? handleMax : undefined}
            onPickToken={() => setPickerSide("in")}
            readOnly={false}
          />

          {/* Fund prompt — Vision Wallet selected, exists, but balance is 0 */}
          {walletSource === "vision" &&
            visionWallet.solanaAddress &&
            inputBalance === 0 && (
              <button
                type="button"
                onClick={() => setFundOpen(true)}
                className="ease-vision flex w-full items-center justify-between border-t border-border/60 bg-primary/5 px-4 py-2.5 text-left text-xs text-primary transition-colors hover:bg-primary/10"
              >
                <span className="flex items-center gap-2">
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                  No {inputToken.symbol} in your Vision Wallet — fund it to place this order
                </span>
                <span className="font-medium">Deposit →</span>
              </button>
            )}

          {/* Flip */}
          <div className="relative">
            <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center">
              <button
                type="button"
                onClick={flip}
                className="ease-vision flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                aria-label="Flip tokens"
              >
                <ArrowDownUp className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="border-t border-border/60" />
          </div>

          {/* Target price */}
          <LimitPriceField
            value={targetPrice}
            onChange={(v) => {
              setTargetPrice(v);
              setConfirmInstantFill(false);
            }}
            marketRate={marketRate}
            marketLoading={marketLoading}
            onRefreshMarket={() => setMarketRefreshTick((x) => x + 1)}
            inputSymbol={inputToken.symbol}
            outputSymbol={outputToken.symbol}
            side="sell"
          />

          <div className="border-t border-border/60" />

          {/* Buy side (computed) */}
          <LimitSide
            label="Buy (when filled)"
            token={outputToken}
            amount={buyAmount > 0 ? fmtAmount(buyAmount) : ""}
            onAmountChange={() => { /* read-only */ }}
            usd={null}
            balance={null}
            onPickToken={() => setPickerSide("out")}
            readOnly
          />

          {/* Stats */}
          <div className="space-y-1.5 border-t border-border/40 px-5 py-3">
            <StatsRow
              label="Expires"
              value={
                <span className="font-mono text-[12px] text-foreground">
                  {expirySeconds == null
                    ? "Never"
                    : expirySeconds >= 86_400
                      ? `${Math.round(expirySeconds / 86_400)} day${expirySeconds === 86_400 ? "" : "s"}`
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
                      <Info className="h-3 w-3 text-muted-foreground/60 hover:text-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px]">
                      <p className="font-mono text-[11px] leading-relaxed">
                        1% taken from the output token only when the order fills.
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
            <StatsRow
              label="You receive (est. after fee)"
              value={
                <span className="font-mono text-[12px] text-foreground">
                  {buyAmount > 0 ? `~${fmtAmount(buyAmount * 0.99)} ${outputToken.symbol}` : "—"}
                </span>
              }
            />
          </div>

          {/* Inline warnings */}
          {willFillInstantly && (
            <div className="flex items-start gap-2 border-t border-warn/30 bg-warn/5 px-5 py-3">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warn" />
              <p className="font-mono text-[11px] leading-relaxed text-warn">
                Your target is far below market — this order will fill almost
                instantly at a worse price than a normal swap. Tap the button
                again to confirm.
              </p>
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
              {isBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {phase.name === "error" ? "Try again" : ctaLabel}
            </Button>
          </div>
        </div>

        {/* Open orders */}
        <OpenOrdersList refreshKey={ordersRefreshKey} />

        {/* Token picker */}
        <TokenPickerDialog
          open={pickerSide !== null}
          onOpenChange={(o) => !o && setPickerSide(null)}
          onSelect={handlePickToken}
          excludeAddress={
            pickerSide === "in" ? outputToken.address : pickerSide === "out" ? inputToken.address : undefined
          }
        />
      </div>
    </TooltipProvider>
  );
};

// ---------- subcomponents ----------

const LimitSide = ({
  label,
  token,
  amount,
  onAmountChange,
  usd,
  balance,
  onMax,
  onPickToken,
  readOnly = false,
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
}) => (
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
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {usd != null ? fmtUsd(usd) : "$0.00"}
        </p>
      </div>
      <button
        type="button"
        onClick={onPickToken}
        className="ease-vision flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-secondary px-2.5 py-1.5 transition-colors hover:bg-muted"
      >
        {token ? (
          <>
            <TokenLogo logo={token.logo} symbol={token.symbol} size={24} />
            <span className="font-mono text-sm font-medium text-foreground">{token.symbol}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </>
        ) : (
          <span className="font-mono text-xs uppercase tracking-wider text-primary">Select token</span>
        )}
      </button>
    </div>
  </div>
);

const StatsRow = ({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-2">
    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">{value}</div>
  </div>
);
