import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Loader2,
  Settings as SettingsIcon,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Info,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
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
import { useJupiterV2Auth } from "@/hooks/useJupiterV2Auth";
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

const EXPIRY_PRESETS = [
  { label: "1d", ms: 86_400_000 },
  { label: "7d", ms: 7 * 86_400_000 },
  { label: "30d", ms: 30 * 86_400_000 },
] as const;

const MARKET_REFRESH_MS = 20_000;

type EntryMode = "market" | "limit";

type Phase =
  | { name: "idle" }
  | { name: "authing" }
  | { name: "preparing" }
  | { name: "awaiting_signature" }
  | { name: "submitting" }
  | { name: "success"; orderId: string; signature: string | null; orderType: string }
  | { name: "error"; message: string };

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "—";
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
  tab: TradeTab;
  onTabChange: (t: TradeTab) => void;
}

export const TradePro = ({ tab, onTabChange }: Props) => {
  // Inputs
  const [inputToken, setInputToken] = useState<TokenMeta>(USDC_TOKEN);
  const [outputToken, setOutputToken] = useState<TokenMeta>(SOL_TOKEN);
  const [sellAmount, setSellAmount] = useState("");
  const [entryMode, setEntryMode] = useState<EntryMode>("market");

  // TP/SL prices in USD (against the OUTPUT token's USD price)
  const [tpPrice, setTpPrice] = useState("");
  const [slPrice, setSlPrice] = useState("");
  // Limit-entry trigger price
  const [entryPrice, setEntryPrice] = useState("");
  const [entrySide, setEntrySide] = useState<"above" | "below">("below");

  const [expiryMs, setExpiryMs] = useState<number>(7 * 86_400_000);

  // Market price of the token we're tracking (output token's USD price)
  const [outputUsdPrice, setOutputUsdPrice] = useState<number | null>(null);
  const [inputUsdPrice, setInputUsdPrice] = useState<number | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketTick, setMarketTick] = useState(0);

  const [pickerSide, setPickerSide] = useState<"in" | "out" | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  const { publicKey, connected, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const { ensureJwt, signing: jwtSigning } = useJupiterV2Auth();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Fetch USD prices for both tokens via swap-quote probe (returns priceUsd
  // for both input and output). Refreshes every 20s.
  useEffect(() => {
    let cancelled = false;
    setMarketLoading(true);
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
        /* keep stale price */
      } finally {
        if (!cancelled && mounted.current) setMarketLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [inputToken.address, outputToken.address, marketTick]);

  useEffect(() => {
    if (phase.name !== "idle") return;
    const i = window.setInterval(() => setMarketTick((x) => x + 1), MARKET_REFRESH_MS);
    return () => window.clearInterval(i);
  }, [phase.name]);

  const numericSell = useMemo(() => {
    const n = parseFloat(sellAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [sellAmount]);
  const numericTp = useMemo(() => {
    const n = parseFloat(tpPrice);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [tpPrice]);
  const numericSl = useMemo(() => {
    const n = parseFloat(slPrice);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [slPrice]);
  const numericEntry = useMemo(() => {
    const n = parseFloat(entryPrice);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [entryPrice]);

  const sellUsd = useMemo(() => {
    if (inputUsdPrice == null || numericSell <= 0) return null;
    return numericSell * inputUsdPrice;
  }, [inputUsdPrice, numericSell]);

  const handleAmountChange = (v: string, setter: (s: string) => void) => {
    if (v === "" || /^\d*\.?\d*$/.test(v)) setter(v);
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
    setTpPrice("");
    setSlPrice("");
    setEntryPrice("");
    pushRecentToken(t);
  };

  // ---- Validation ----
  const validation = useMemo<string | null>(() => {
    if (numericSell <= 0) return "Enter an amount";
    if (sellUsd != null && sellUsd < 10) return "Min order $10";

    if (entryMode === "limit") {
      if (numericEntry <= 0) return "Set an entry price";
    }

    if (numericTp <= 0) return "Set a take-profit price";
    if (numericSl <= 0) return "Set a stop-loss price";
    if (numericTp <= numericSl) return "Take-profit must be > stop-loss";
    return null;
  }, [numericSell, sellUsd, entryMode, numericEntry, numericTp, numericSl]);

  // For market entry + TP/SL, the trigger token is the output token (we hold
  // it post-entry and want to sell it at TP or SL). The orderType is OCO.
  // For limit entry, we use OTOCO: parent triggers buy at entryPrice, then
  // TP/SL on the output.
  const orderType = useMemo<"oco" | "otoco">(() => {
    return entryMode === "limit" ? "otoco" : "oco";
  }, [entryMode]);

  // ---- Submit ----
  const placeOrder = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction) return;
    if (validation) return;

    try {
      setPhase({ name: "authing" });
      const jwt = await ensureJwt();

      setPhase({ name: "preparing" });

      // Step 1: ensure vault exists
      await supaPost("trigger-v2-vault", { jwt });

      // Step 2: craft deposit
      const inputAmountAtomic = Math.floor(numericSell * Math.pow(10, inputToken.decimals));
      if (inputAmountAtomic <= 0) throw new Error("Amount too small");

      const deposit = await supaPost("trigger-v2-deposit-craft", {
        jwt,
        inputMint: inputToken.address,
        outputMint: outputToken.address,
        userAddress: publicKey.toBase58(),
        amount: String(inputAmountAtomic),
      });
      const depositTxB64: string = deposit.transaction;
      const depositRequestId: string = deposit.requestId;
      if (!depositTxB64 || !depositRequestId) throw new Error("Deposit failed");

      // Step 3: sign deposit
      setPhase({ name: "awaiting_signature" });
      const txBytes = Uint8Array.from(atob(depositTxB64), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);
      let signed: VersionedTransaction;
      try {
        signed = await signTransaction(tx);
      } catch {
        if (mounted.current) setPhase({ name: "error", message: "Cancelled — try again." });
        return;
      }
      const depositSignedTx = btoa(String.fromCharCode(...signed.serialize()));

      // Step 4: create order
      setPhase({ name: "submitting" });
      const expiresAt = Date.now() + expiryMs;
      const basePayload: Record<string, unknown> = {
        jwt,
        orderType,
        depositRequestId,
        depositSignedTx,
        userPubkey: publicKey.toBase58(),
        inputMint: inputToken.address,
        inputAmount: String(inputAmountAtomic),
        outputMint: outputToken.address,
        // Trigger price tracks the OUTPUT token (what we'll be selling at TP/SL)
        triggerMint: outputToken.address,
        expiresAt,
      };

      if (orderType === "otoco") {
        basePayload.triggerCondition = entrySide;
        basePayload.triggerPriceUsd = numericEntry;
        basePayload.tpPriceUsd = numericTp;
        basePayload.slPriceUsd = numericSl;
      } else {
        // oco
        basePayload.tpPriceUsd = numericTp;
        basePayload.slPriceUsd = numericSl;
      }

      const created = await supaPost("trigger-v2-create-order", basePayload);
      const orderId: string = created.id ?? "";
      const txSignature: string | null = created.txSignature ?? null;
      if (!orderId) throw new Error(created.error ?? "No order id returned");

      if (!mounted.current) return;
      setPhase({ name: "success", orderId, signature: txSignature, orderType });
    } catch (e) {
      if (!mounted.current) return;
      setPhase({ name: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }, [
    connected, publicKey, signTransaction, validation, ensureJwt,
    numericSell, inputToken, outputToken, orderType, entrySide,
    numericEntry, numericTp, numericSl, expiryMs,
  ]);

  const reset = () => {
    setSellAmount("");
    setTpPrice("");
    setSlPrice("");
    setEntryPrice("");
    setPhase({ name: "idle" });
  };

  // ---- Success view ----
  if (phase.name === "success") {
    const typeLabel =
      phase.orderType === "otoco" ? "Bracket order armed" : "TP/SL bracket placed";
    return (
      <div className="w-full max-w-[440px] space-y-4">
        <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-up/30 bg-card/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-up/40 bg-up/10">
              <CheckCircle2 className="h-7 w-7 text-up" />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {typeLabel}
              </p>
              <p className="mt-2 font-mono text-sm text-foreground">
                Take-profit at {fmtUsd(numericTp)} · Stop-loss at {fmtUsd(numericSl)}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Order #{phase.orderId.slice(0, 8)}
              </p>
            </div>
            {phase.signature && (
              <a
                href={`https://solscan.io/tx/${phase.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ease-vision inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-secondary"
              >
                View deposit {truncSig(phase.signature)}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Button
              onClick={reset}
              className="ease-vision mt-2 w-full font-mono text-[11px] uppercase tracking-wider"
            >
              New bracket
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---- CTA ----
  const isBusy =
    phase.name === "authing" ||
    phase.name === "preparing" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting" ||
    jwtSigning;

  const busyLabel =
    phase.name === "authing" || jwtSigning ? "Sign in to continue…"
    : phase.name === "preparing" ? "Building order…"
    : phase.name === "awaiting_signature" ? "Approve deposit in wallet…"
    : phase.name === "submitting" ? "Submitting…"
    : "";

  let ctaLabel = "Place bracket order";
  let ctaDisabled = false;
  let ctaAction: (() => void) | null = placeOrder;
  if (!connected) {
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

  // Distance from market chips
  const tpDelta = outputUsdPrice && numericTp > 0
    ? ((numericTp - outputUsdPrice) / outputUsdPrice) * 100 : null;
  const slDelta = outputUsdPrice && numericSl > 0
    ? ((numericSl - outputUsdPrice) / outputUsdPrice) * 100 : null;
  const entryDelta = outputUsdPrice && numericEntry > 0
    ? ((numericEntry - outputUsdPrice) / outputUsdPrice) * 100 : null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="w-full max-w-[440px] space-y-4">
        {/* Tabs row + settings gear */}
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
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {EXPIRY_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setExpiryMs(p.ms)}
                    className={cn(
                      "ease-vision rounded-md border px-2 py-1.5 font-mono text-[11px]",
                      expiryMs === p.ms
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                Brackets auto-cancel after this period. Funds stay in your vault until withdrawn.
              </p>
            </PopoverContent>
          </Popover>
        </div>


        {/* Card */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm shadow-soft">
          {/* Pay (sell) side */}
          <PaySide
            label={entryMode === "limit" ? "Spend (when entry hits)" : "Spend now"}
            token={inputToken}
            amount={sellAmount}
            onAmountChange={(v) => handleAmountChange(v, setSellAmount)}
            usd={sellUsd}
            onPickToken={() => setPickerSide("in")}
          />

          <div className="border-t border-border/60" />

          {/* Buy / target token */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Track price of
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {marketLoading ? "…" : outputUsdPrice != null ? `Market: ${fmtUsd(outputUsdPrice)}` : ""}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setPickerSide("out")}
                className="ease-vision flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-secondary px-2.5 py-1.5 transition-colors hover:bg-muted"
              >
                <TokenLogo logo={outputToken.logo} symbol={outputToken.symbol} size={24} />
                <span className="font-mono text-sm font-medium text-foreground">{outputToken.symbol}</span>
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

          {/* Entry mode toggle */}
          <div className="px-5 py-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Entry
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <EntryChip
                active={entryMode === "market"}
                onClick={() => setEntryMode("market")}
                label="Market now"
                hint="Buy immediately, then arm bracket"
              />
              <EntryChip
                active={entryMode === "limit"}
                onClick={() => setEntryMode("limit")}
                label="Limit entry"
                hint="Wait for price, then arm bracket"
              />
            </div>
            {entryMode === "limit" && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-1 rounded-full border border-border/60 bg-secondary/30 p-0.5">
                  <SmallChip
                    active={entrySide === "below"}
                    onClick={() => setEntrySide("below")}
                    icon={<TrendingDown className="h-3 w-3" />}
                    label="Buy below"
                  />
                  <SmallChip
                    active={entrySide === "above"}
                    onClick={() => setEntrySide("above")}
                    icon={<TrendingUp className="h-3 w-3" />}
                    label="Buy above"
                  />
                </div>
                <PriceInput
                  label="Entry price (USD)"
                  value={entryPrice}
                  onChange={(v) => handleAmountChange(v, setEntryPrice)}
                  delta={entryDelta}
                  marketPrice={outputUsdPrice}
                />
              </div>
            )}
          </div>

          <div className="border-t border-border/60" />

          {/* TP / SL inputs */}
          <div className="space-y-3 px-5 py-4">
            <PriceInput
              label="Take-profit (USD)"
              value={tpPrice}
              onChange={(v) => handleAmountChange(v, setTpPrice)}
              delta={tpDelta}
              marketPrice={outputUsdPrice}
              accent="up"
            />
            <PriceInput
              label="Stop-loss (USD)"
              value={slPrice}
              onChange={(v) => handleAmountChange(v, setSlPrice)}
              delta={slDelta}
              marketPrice={outputUsdPrice}
              accent="down"
            />
          </div>

          {/* Stats */}
          <div className="space-y-1.5 border-t border-border/40 px-5 py-3">
            <StatsRow
              label="Order type"
              value={
                <span className="font-mono text-[12px] text-foreground">
                  {orderType.toUpperCase()}
                </span>
              }
            />
            <StatsRow
              label="Vault custody"
              value={
                <span className="flex items-center gap-1 font-mono text-[12px] text-muted-foreground">
                  <ShieldCheck className="h-3 w-3 text-up" />
                  Privy-managed
                </span>
              }
            />
            <StatsRow
              label={
                <span className="flex items-center gap-1">
                  Min order
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground focus:outline-none"
                        aria-label="Min order info"
                      >
                        <Info className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="start"
                      sideOffset={6}
                      collisionPadding={12}
                      className="max-w-[220px]"
                    >
                      <p className="font-mono text-[11px] leading-relaxed">
                        Pro brackets enforce a $10 minimum per order.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </span>
              }
              value={<span className="font-mono text-[12px] text-muted-foreground">$10 USD</span>}
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
                connected && !ctaDisabled && "bg-primary text-primary-foreground shadow-glow hover:bg-primary/90",
              )}
            >
              {isBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {phase.name === "error" ? "Try again" : ctaLabel}
            </Button>
          </div>
        </div>

        <p className="px-1 text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
          Pro brackets use Jupiter v2 vaults. You'll sign once to authenticate, then once per
          deposit. Funds stay custodied by Privy until your bracket fills or you withdraw.
        </p>

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

const ModeChip = ({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "ease-vision flex-1 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
      active
        ? "bg-secondary text-foreground shadow-soft"
        : "text-muted-foreground hover:text-foreground",
    )}
  >
    {label}
  </button>
);

const EntryChip = ({
  active, onClick, label, hint,
}: { active: boolean; onClick: () => void; label: string; hint: string }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "ease-vision rounded-lg border px-3 py-2 text-left transition-colors",
      active
        ? "border-primary/60 bg-primary/10 text-foreground"
        : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground",
    )}
  >
    <p className="font-mono text-[11px] font-medium uppercase tracking-wider">{label}</p>
    <p className="mt-0.5 font-mono text-[9px] leading-tight opacity-80">{hint}</p>
  </button>
);

const SmallChip = ({
  active, onClick, label, icon,
}: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "ease-vision flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
      active
        ? "bg-secondary text-foreground shadow-soft"
        : "text-muted-foreground hover:text-foreground",
    )}
  >
    {icon}
    {label}
  </button>
);

const PaySide = ({
  label, token, amount, onAmountChange, usd, onPickToken,
}: {
  label: string;
  token: TokenMeta;
  amount: string;
  onAmountChange: (v: string) => void;
  usd: number | null;
  onPickToken: () => void;
}) => (
  <div className="px-5 py-4">
    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {label}
    </span>
    <div className="mt-2 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0.00"
          className="w-full bg-transparent font-mono text-3xl font-light text-foreground outline-none placeholder:text-muted-foreground/40"
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
        <TokenLogo logo={token.logo} symbol={token.symbol} size={24} />
        <span className="font-mono text-sm font-medium text-foreground">{token.symbol}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  </div>
);

const PriceInput = ({
  label, value, onChange, delta, marketPrice, accent,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  delta: number | null;
  marketPrice: number | null;
  accent?: "up" | "down";
}) => {
  const accentClass =
    accent === "up" ? "border-up/40 focus-within:border-up/70"
    : accent === "down" ? "border-down/40 focus-within:border-down/70"
    : "border-border/60 focus-within:border-primary/60";
  return (
    <div className={cn("rounded-xl border bg-secondary/20 px-3 py-2 transition-colors", accentClass)}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {delta != null && (
          <span
            className={cn(
              "font-mono text-[10px]",
              delta >= 0 ? "text-up" : "text-down",
            )}
          >
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(1)}% vs market
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
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
};

const StatsRow = ({ label, value }: { label: React.ReactNode; value: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">{value}</div>
  </div>
);
