import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Info,
  Loader2,
  XCircle,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
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
import { DcaOpenOrders } from "@/components/trade/DcaOpenOrders";
import {
  WalletSourcePicker,
  type WalletSource,
} from "@/components/trade/WalletSourcePicker";
import { FundVisionWalletDialog } from "@/components/wallet/FundVisionWalletDialog";
import { useTradeSigner } from "@/hooks/useTradeSigner";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { useVisionWalletSigner } from "@/hooks/useVisionWalletSigner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// Time-based DCA via Jupiter Recurring v1.
// User signs the create transaction with their own wallet (no vault).

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

const INTERVAL_PRESETS = [
  { label: "Hourly", seconds: 60 * 60 },
  { label: "Daily", seconds: 24 * 60 * 60 },
  { label: "Weekly", seconds: 7 * 24 * 60 * 60 },
] as const;

type Phase =
  | { name: "idle" }
  | { name: "preparing" }
  | { name: "awaiting_fee_signature" }
  | { name: "submitting_fee" }
  | { name: "awaiting_signature" }
  | { name: "submitting" }
  | { name: "success"; orderId: string | null; signature: string | null }
  | { name: "cancelled" }
  | { name: "error"; message: string };

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toExponential(2)}`;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
};
const fmtAmount = (n: number) => {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.000001) return n.toExponential(3);
  if (Math.abs(n) < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (Math.abs(n) < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
const fmtDuration = (sec: number) => {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h`;
  return `${Math.floor(sec / 60)}m`;
};
const truncSig = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

const supaPost = async (fn: string, body: unknown): Promise<any> => {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as any).context;
    let msg: string | null = null;
    if (ctx && typeof ctx.json === "function") {
      try {
        const p = await ctx.json();
        if (p?.error) msg = String(p.error);
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg ?? error.message ?? `${fn} failed`);
  }
  if (data && typeof data === "object" && (data as any).error) {
    throw new Error((data as any).error);
  }
  return data;
};

export const TradeDca = () => {
  const [inputToken, setInputToken] = useState<TokenMeta>(USDC_TOKEN);
  const [outputToken, setOutputToken] = useState<TokenMeta>(SOL_TOKEN);

  const [totalAmount, setTotalAmount] = useState("");
  const [numOrders, setNumOrders] = useState("10");
  const [intervalSec, setIntervalSec] = useState<number>(24 * 60 * 60);

  // Optional price guards
  const [useGuards, setUseGuards] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const [pickerSide, setPickerSide] = useState<"in" | "out" | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [refreshKey, setRefreshKey] = useState(0);

  const [inputUsdPrice, setInputUsdPrice] = useState<number | null>(
    inputToken.address === USDC_TOKEN.address ? 1 : null,
  );
  const [outputUsdPrice, setOutputUsdPrice] = useState<number | null>(null);

  const [walletSource, setWalletSource] = useState<WalletSource>("vision");
  const [fundOpen, setFundOpen] = useState(false);

  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const visionWallet = useVisionWallet();
  const visionSigner = useVisionWalletSigner();
  const signer = useTradeSigner(walletSource);
  const mounted = useRef(true);

  const activePayerAddress =
    walletSource === "vision"
      ? visionWallet.solanaAddress
      : publicKey?.toBase58() ?? null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Fetch USD prices for both tokens.
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const fresh = await supaPost("swap-quote", {
          inputToken: inputToken.address,
          outputToken: outputToken.address,
          amount: 1,
          slippageBps: 50,
        });
        if (cancelled || !mounted.current) return;
        const inUsd = (fresh as any)?.input?.priceUsd as number | undefined;
        const outUsd = (fresh as any)?.output?.priceUsd as number | undefined;
        if (typeof inUsd === "number") setInputUsdPrice(inUsd);
        if (typeof outUsd === "number") setOutputUsdPrice(outUsd);
      } catch {
        /* keep stale */
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [inputToken.address, outputToken.address]);

  const handleAmountChange = (v: string, setter: (s: string) => void) => {
    if (v === "" || /^\d*\.?\d*$/.test(v)) setter(v);
  };

  const handlePickToken = (t: TokenMeta) => {
    if (pickerSide === "in") {
      if (outputToken.address === t.address) setOutputToken(inputToken);
      setInputToken(t);
      setInputUsdPrice(t.address === USDC_TOKEN.address ? 1 : null);
    } else if (pickerSide === "out") {
      if (inputToken.address === t.address) setInputToken(outputToken);
      setOutputToken(t);
      setOutputUsdPrice(null);
    }
    setTotalAmount("");
    setMinPrice("");
    setMaxPrice("");
    pushRecentToken(t);
  };

  // ---- Derived values ----
  const numericTotal = useMemo(() => {
    const n = parseFloat(totalAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [totalAmount]);

  const numericOrders = useMemo(() => {
    const n = parseInt(numOrders, 10);
    return Number.isFinite(n) && n >= 2 ? n : 0;
  }, [numOrders]);

  const numericMin = useMemo(() => {
    const n = parseFloat(minPrice);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [minPrice]);
  const numericMax = useMemo(() => {
    const n = parseFloat(maxPrice);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [maxPrice]);

  const totalUsd = useMemo(() => {
    if (inputUsdPrice == null || numericTotal <= 0) return null;
    return numericTotal * inputUsdPrice;
  }, [inputUsdPrice, numericTotal]);

  const perOrderAmount = useMemo(() => {
    if (numericTotal <= 0 || numericOrders <= 0) return 0;
    return numericTotal / numericOrders;
  }, [numericTotal, numericOrders]);

  const perOrderUsd = useMemo(() => {
    if (inputUsdPrice == null || perOrderAmount <= 0) return null;
    return perOrderAmount * inputUsdPrice;
  }, [inputUsdPrice, perOrderAmount]);

  const totalDurationSec = useMemo(
    () => numericOrders * intervalSec,
    [numericOrders, intervalSec],
  );

  // ---- Validation ----
  const validation = useMemo<string | null>(() => {
    if (numericTotal <= 0) return "Enter a total amount";
    if (totalUsd != null && totalUsd < 5) return "Min total $5";
    if (numericOrders < 2) return "At least 2 orders";
    if (numericOrders > 100) return "Max 100 orders";
    if (intervalSec < 60) return "Interval too short";
    if (useGuards) {
      if (numericMin > 0 && numericMax > 0 && numericMin >= numericMax) {
        return "Min price must be < max price";
      }
    }
    return null;
  }, [numericTotal, totalUsd, numericOrders, intervalSec, useGuards, numericMin, numericMax]);

  // ---- Submit ----
  const placeDca = useCallback(async () => {
    if (!signer.ready || !activePayerAddress) return;
    if (validation) return;
    try {
      setPhase({ name: "preparing" });
      const inAmountAtomic = Math.floor(numericTotal * Math.pow(10, inputToken.decimals));
      if (inAmountAtomic <= 0) throw new Error("Amount too small");

      // ---- Step 1: Collect 1% upfront platform fee ----
      // For Vision Wallet: sign + broadcast in one shot via Privy.
      // For external wallets: sign locally, then submit via tx-submit so
      // we get the existing fee accounting / treasury hooks.
      const feeBuilt = await supaPost("dca-fee-build", {
        user: activePayerAddress,
        inputMint: inputToken.address,
        totalAmountAtomic: String(inAmountAtomic),
        decimals: inputToken.decimals,
      });
      const feeTxB64: string = feeBuilt?.transaction;
      if (!feeTxB64) throw new Error("Fee build failed");

      setPhase({ name: "awaiting_fee_signature" });
      const feeBytes = Uint8Array.from(atob(feeTxB64), (c) => c.charCodeAt(0));
      const feeTx = Transaction.from(feeBytes);

      try {
        if (walletSource === "vision") {
          // Privy signs + broadcasts. We still log the transfer via tx-submit
          // for treasury accounting parity.
          setPhase({ name: "submitting_fee" });
          const res = await visionSigner.signAndSend({
            chain: "solana",
            caip2: SOLANA_CAIP2,
            transaction: feeTxB64,
            method: "signAndSendTransaction",
          });
          const feeSig = res.hash ?? res.signature ?? null;
          if (feeSig) {
            // Best-effort treasury logging (don't fail the whole flow).
            await supaPost("tx-submit", {
              signature: feeSig,
              kind: "transfer",
              inputMint: inputToken.address,
              recipient: "treasury",
              walletAddress: activePayerAddress,
              metadata: { source: "dca_platform_fee", wallet_source: "vision" },
            }).catch(() => { /* logging is best-effort */ });
          }
        } else {
          const signedFee = await signer.signOnly(feeTx);
          setPhase({ name: "submitting_fee" });
          await supaPost("tx-submit", {
            signedTransaction: signedFee,
            kind: "transfer",
            inputMint: inputToken.address,
            recipient: "treasury",
            walletAddress: activePayerAddress,
            metadata: { source: "dca_platform_fee" },
          });
        }
      } catch {
        if (mounted.current) setPhase({ name: "cancelled" });
        return;
      }

      // ---- Step 2: Build the Jupiter recurring create transaction ----
      const created = await supaPost("recurring-create", {
        user: activePayerAddress,
        inputMint: inputToken.address,
        outputMint: outputToken.address,
        inAmount: String(inAmountAtomic),
        numberOfOrders: numericOrders,
        interval: intervalSec,
        minPriceUsd: useGuards && numericMin > 0 ? numericMin : null,
        maxPriceUsd: useGuards && numericMax > 0 ? numericMax : null,
      });
      const txB64: string = created.transaction;
      const requestId: string = created.requestId;
      if (!txB64 || !requestId) throw new Error("Create order failed");

      setPhase({ name: "awaiting_signature" });
      const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);

      // Jupiter Recurring requires execute-via-Jupiter, so we sign-only
      // for both wallet sources and POST to recurring-execute.
      let signedB64: string;
      try {
        signedB64 = await signer.signOnly(tx);
      } catch {
        if (mounted.current) setPhase({ name: "cancelled" });
        return;
      }

      setPhase({ name: "submitting" });
      const executed = await supaPost("recurring-execute", {
        signedTransaction: signedB64,
        requestId,
      });
      const sig = executed?.signature ?? executed?.txSignature ?? null;
      const orderId = executed?.order ?? executed?.orderId ?? null;
      if (!mounted.current) return;
      setPhase({ name: "success", orderId, signature: sig });
      setRefreshKey((x) => x + 1);
    } catch (e) {
      if (!mounted.current) return;
      setPhase({
        name: "error",
        message: e instanceof Error ? e.message : "Something went wrong.",
      });
    }
  }, [
    signer,
    visionSigner,
    walletSource,
    activePayerAddress,
    validation,
    numericTotal,
    inputToken,
    outputToken,
    numericOrders,
    intervalSec,
    useGuards,
    numericMin,
    numericMax,
  ]);

  const reset = () => {
    setTotalAmount("");
    setMinPrice("");
    setMaxPrice("");
    setPhase({ name: "idle" });
    setRefreshKey((x) => x + 1);
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
                DCA started
              </p>
              <p className="mt-2 font-mono text-sm text-foreground">
                {fmtAmount(perOrderAmount)} {inputToken.symbol} → {outputToken.symbol} every{" "}
                {fmtDuration(intervalSec)}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {numericOrders} orders · runs for {fmtDuration(totalDurationSec)}
              </p>
            </div>
            {phase.signature && (
              <a
                href={`https://solscan.io/tx/${phase.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ease-vision inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-secondary"
              >
                View transaction {truncSig(phase.signature)}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Button
              onClick={reset}
              className="ease-vision mt-2 w-full font-mono text-[11px] uppercase tracking-wider"
            >
              New DCA
            </Button>
          </div>
        </div>
        <DcaOpenOrders refreshKey={refreshKey} />
      </div>
    );
  }

  // ---- Cancelled view ----
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
                DCA cancelled
              </p>
              <p className="mt-2 font-mono text-sm text-foreground">
                {fmtAmount(perOrderAmount)} {inputToken.symbol} → {outputToken.symbol} every{" "}
                {fmtDuration(intervalSec)}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                No funds were moved.
              </p>
            </div>
            <Button
              onClick={reset}
              className="ease-vision mt-2 w-full font-mono text-[11px] uppercase tracking-wider"
            >
              New DCA
            </Button>
          </div>
        </div>
        <DcaOpenOrders refreshKey={refreshKey} />
      </div>
    );
  }

  // ---- CTA ----
  const isBusy =
    phase.name === "preparing" ||
    phase.name === "awaiting_fee_signature" ||
    phase.name === "submitting_fee" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting";
  const isVision = walletSource === "vision";
  const busyLabel =
    phase.name === "preparing"
      ? "Preparing fee…"
      : phase.name === "awaiting_fee_signature"
        ? isVision ? "Signing fee with Vision Wallet…" : "Approve fee in wallet…"
        : phase.name === "submitting_fee"
          ? "Sending fee…"
          : phase.name === "awaiting_signature"
            ? isVision ? "Signing DCA with Vision Wallet…" : "Approve DCA in wallet…"
            : phase.name === "submitting"
              ? "Submitting DCA…"
              : "";

  let ctaLabel = "Start DCA";
  let ctaDisabled = false;
  let ctaAction: (() => void) | null = placeDca;
  if (isVision && !visionWallet.solanaAddress) {
    ctaLabel = visionWallet.working ? "Creating wallet…" : "Create Vision Wallet";
    ctaDisabled = visionWallet.working;
    ctaAction = () => {
      visionWallet.createWallet().catch(() => { /* hook toasts */ });
    };
  } else if (!isVision && !connected) {
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

  const minDelta =
    outputUsdPrice && numericMin > 0
      ? ((numericMin - outputUsdPrice) / outputUsdPrice) * 100
      : null;
  const maxDelta =
    outputUsdPrice && numericMax > 0
      ? ((numericMax - outputUsdPrice) / outputUsdPrice) * 100
      : null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="w-full max-w-[440px] space-y-4">
        {/* Wallet source picker */}
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
        <div className="overflow-hidden rounded-2xl border border-border bg-card/60 shadow-soft backdrop-blur-sm">
          {/* Total to spend */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Total to spend
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {totalUsd != null ? `≈ ${fmtUsd(totalUsd)}` : ""}
              </span>
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
              </div>
              <button
                type="button"
                onClick={() => setPickerSide("in")}
                className="ease-vision flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-secondary px-2.5 py-1.5 transition-colors hover:bg-muted"
              >
                <TokenLogo logo={inputToken.logo} symbol={inputToken.symbol} size={24} />
                <span className="font-mono text-sm font-medium text-foreground">
                  {inputToken.symbol}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>

          <div className="border-t border-border/60" />

          {/* Buy token */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                To buy
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {outputUsdPrice != null ? `Market: ${fmtUsd(outputUsdPrice)}` : ""}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setPickerSide("out")}
                className="ease-vision flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-secondary px-2.5 py-1.5 transition-colors hover:bg-muted"
              >
                <TokenLogo logo={outputToken.logo} symbol={outputToken.symbol} size={24} />
                <span className="font-mono text-sm font-medium text-foreground">
                  {outputToken.symbol}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>

          <div className="border-t border-border/60" />

          {/* Schedule */}
          <div className="space-y-3 px-5 py-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Schedule
            </p>

            {/* Interval presets */}
            <div className="grid grid-cols-3 gap-1.5">
              {INTERVAL_PRESETS.map((p) => {
                const active = intervalSec === p.seconds;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setIntervalSec(p.seconds)}
                    className={cn(
                      "ease-vision rounded-md border px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider",
                      active
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Number of orders */}
            <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Number of orders
              </span>
              <input
                inputMode="numeric"
                value={numOrders}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d{1,3}$/.test(v)) setNumOrders(v);
                }}
                placeholder="10"
                className="w-full bg-transparent font-mono text-xl font-light text-foreground outline-none placeholder:text-muted-foreground/40"
              />
            </div>
          </div>

          <div className="border-t border-border/60" />

          {/* Price guards */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Price guards
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground"
                      aria-label="Price guards info"
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[240px]">
                    <p className="font-mono text-[11px] leading-relaxed">
                      Skip an execution if the {outputToken.symbol} price is outside this
                      range. Useful to avoid buying highs or selling lows.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <button
                type="button"
                onClick={() => setUseGuards((v) => !v)}
                className={cn(
                  "ease-vision rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  useGuards
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={useGuards}
              >
                {useGuards ? "On" : "Off"}
              </button>
            </div>

            {useGuards && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <PriceInput
                  label="Min (USD)"
                  value={minPrice}
                  onChange={(v) => handleAmountChange(v, setMinPrice)}
                  delta={minDelta}
                  marketPrice={outputUsdPrice}
                />
                <PriceInput
                  label="Max (USD)"
                  value={maxPrice}
                  onChange={(v) => handleAmountChange(v, setMaxPrice)}
                  delta={maxDelta}
                  marketPrice={outputUsdPrice}
                />
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="space-y-1.5 border-t border-border/40 px-5 py-3">
            <StatsRow
              label="Per order"
              value={
                <span className="font-mono text-[12px] text-foreground">
                  {perOrderAmount > 0 ? fmtAmount(perOrderAmount) : "—"} {inputToken.symbol}
                  {perOrderUsd != null && (
                    <span className="ml-1 text-muted-foreground">
                      (≈ {fmtUsd(perOrderUsd)})
                    </span>
                  )}
                </span>
              }
            />
            <StatsRow
              label="Frequency"
              value={
                <span className="font-mono text-[12px] text-muted-foreground">
                  Every {fmtDuration(intervalSec)}
                </span>
              }
            />
            <StatsRow
              label="Total runtime"
              value={
                <span className="font-mono text-[12px] text-muted-foreground">
                  {numericOrders > 0 ? fmtDuration(totalDurationSec) : "—"}
                </span>
              }
            />
            <StatsRow
              label="Platform fee"
              value={
                <span className="font-mono text-[12px] text-foreground">
                  1% upfront
                  {totalUsd != null && totalUsd > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      (≈ {fmtUsd(totalUsd * 0.01)})
                    </span>
                  )}
                </span>
              }
            />
            <StatsRow
              label="Jupiter fee"
              value={
                <span className="font-mono text-[12px] text-muted-foreground">
                  0.1% per fill
                </span>
              }
            />
          </div>

          {/* Inline error */}
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
                connected &&
                  !ctaDisabled &&
                  "bg-primary text-primary-foreground shadow-glow hover:bg-primary/90",
              )}
            >
              {isBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {phase.name === "error" ? "Try again" : ctaLabel}
            </Button>
          </div>
        </div>

        <p className="px-1 text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
          DCA splits your buy into equal recurring orders. You sign once to deposit funds,
          then orders execute automatically on schedule.
        </p>

        {/* Open DCA orders */}
        <DcaOpenOrders refreshKey={refreshKey} />

        {/* Token picker */}
        <TokenPickerDialog
          open={pickerSide !== null}
          onOpenChange={(o) => !o && setPickerSide(null)}
          onSelect={handlePickToken}
          excludeAddress={
            pickerSide === "in"
              ? outputToken.address
              : pickerSide === "out"
                ? inputToken.address
                : undefined
          }
        />

        {/* Fund Vision Wallet */}
        <FundVisionWalletDialog
          open={fundOpen}
          onOpenChange={setFundOpen}
          defaultChain="solana"
        />
      </div>
    </TooltipProvider>
  );
};

const PriceInput = ({
  label,
  value,
  onChange,
  delta,
  marketPrice,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  delta: number | null;
  marketPrice: number | null;
}) => (
  <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2 transition-colors focus-within:border-primary/60">
    <div className="flex items-center justify-between">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {delta != null && (
        <span
          className={cn(
            "font-mono text-[9px]",
            delta >= 0 ? "text-up" : "text-down",
          )}
        >
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}%
        </span>
      )}
    </div>
    <div className="mt-1 flex items-baseline gap-1">
      <span className="font-mono text-sm text-muted-foreground">$</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={marketPrice != null ? marketPrice.toFixed(2) : "0.00"}
        className="w-full bg-transparent font-mono text-base font-light text-foreground outline-none placeholder:text-muted-foreground/40"
      />
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
    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {label}
    </span>
    <div className="flex items-center gap-2">{value}</div>
  </div>
);