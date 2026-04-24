import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ChevronDown,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Info,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TradeTabs, type TradeTab } from "@/components/trade/TradeTabs";
import { TokenLogo } from "@/components/TokenLogo";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

// LI.FI uses "SOL" for Solana and numeric ids for EVM chains.
const SOLANA_CHAIN_ID = "SOL" as const;
// LI.FI's canonical native-SOL token address (their tokens endpoint uses
// the wrapped-SOL mint as the SVM "native" representative).
const SOL_NATIVE_ADDRESS = "11111111111111111111111111111111";
// Fallback to wrapped SOL mint when LI.FI's list returns it instead.
const WSOL_MINT = "So11111111111111111111111111111111111111112";

interface Chain {
  id: number | string;
  key: string;
  name: string;
  logo: string | null;
  nativeSymbol: string;
  chainType: "EVM" | "SVM" | string;
}

interface BridgeToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
  chainId: number | string;
}

interface QuoteData {
  raw: any;
  tool: string;
  toolName: string;
  fromAmountAtomic: string;
  toAmountAtomic: string;
  toAmountMinAtomic: string;
  fromAmountUsd: number | null;
  toAmountUsd: number | null;
  executionDurationSec: number | null;
  platformFeeUsd: number | null;
  gasFeeUsd: number | null;
  slippageBps: number;
}

type Phase =
  | { name: "idle" }
  | { name: "building" }
  | { name: "awaiting_signature" }
  | { name: "submitting" }
  | { name: "bridging"; signature: string; startedAt: number }
  | { name: "success"; signature: string; durationMs: number; toAmountUi: number; toSymbol: string; destExplorer: string | null }
  | { name: "error"; message: string };

const QUOTE_DEBOUNCE_MS = 400;
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min — some bridges take this long

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
  if (data && typeof data === "object" && "error" in (data as any) && (data as any).error) {
    throw new Error((data as any).error);
  }
  return data;
};

const supaGet = async (fn: string, params: Record<string, string>, attempt = 0): Promise<any> => {
  const url = new URL(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`,
  );
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const resp = await fetch(url.toString(), {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
    });
    if (!resp.ok && (resp.status === 503 || resp.status === 504) && attempt < 2) {
      await sleep(400 * (attempt + 1));
      return supaGet(fn, params, attempt + 1);
    }
    const data = await resp.json();
    if (data?.error && resp.status >= 400) throw new Error(data.error);
    return data;
  } catch (e) {
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return supaGet(fn, params, attempt + 1);
    }
    throw e;
  }
};

interface TradeBridgeProps {
  tab: TradeTab;
  onTabChange: (t: TradeTab) => void;
}

export const TradeBridge = ({ tab, onTabChange }: TradeBridgeProps) => {
  const { publicKey, connected, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const [chains, setChains] = useState<Chain[]>([]);
  const [chainsLoading, setChainsLoading] = useState(true);

  // Phase 1: source is locked to Solana (we already have the wallet adapter
  // for it). Phase 2 will add EVM via wagmi.
  const fromChain: Chain | undefined = useMemo(
    () => chains.find((c) => c.id === SOLANA_CHAIN_ID),
    [chains],
  );
  const [toChain, setToChain] = useState<Chain | null>(null);

  const [fromToken, setFromToken] = useState<BridgeToken | null>(null);
  const [toToken, setToToken] = useState<BridgeToken | null>(null);
  const [amount, setAmount] = useState("");
  const [slippageBps] = useState(50);

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [picker, setPicker] = useState<null | { side: "from" | "to" }>(null);
  const [chainPicker, setChainPicker] = useState<null | "to">(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  // ---------- Load chains once ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setChainsLoading(true);
        const data = await supaGet("bridge-chains", {});
        if (cancelled) return;
        const list: Chain[] = data.chains ?? [];
        setChains(list);
        // Default destination → Ethereum mainnet (id 1) if available, else first EVM.
        const eth = list.find((c) => c.id === 1) ?? list.find((c) => c.chainType === "EVM");
        if (eth) setToChain(eth);
      } catch {
        if (!cancelled) setChains([]);
      } finally {
        if (!cancelled) setChainsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- Default source token (SOL) once chains arrive ----------
  useEffect(() => {
    if (!fromChain || fromToken) return;
    setFromToken({
      address: SOL_NATIVE_ADDRESS,
      symbol: "SOL",
      name: "Solana",
      decimals: 9,
      logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
      priceUsd: null,
      chainId: SOLANA_CHAIN_ID,
    });
  }, [fromChain, fromToken]);

  const numericAmount = useMemo(() => {
    const n = parseFloat(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  // ---------- Quote (debounced) ----------
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!fromChain || !toChain || !fromToken || !toToken || numericAmount <= 0 || !publicKey) {
      setQuoteLoading(false);
      return;
    }
    setQuoteLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const atomic = BigInt(Math.floor(numericAmount * Math.pow(10, fromToken.decimals)));
        if (atomic <= 0n) throw new Error("Amount too small");
        const fresh = await supaPost("bridge-quote", {
          fromChain: String(fromChain.id),
          toChain: String(toChain.id),
          fromToken: fromToken.address,
          toToken: toToken.address,
          fromAmount: atomic.toString(),
          fromAddress: publicKey.toBase58(),
          slippageBps,
        });
        if (!mounted.current) return;
        setQuote(fresh);
        setQuoteError(null);
      } catch (e) {
        if (!mounted.current) return;
        setQuote(null);
        setQuoteError(e instanceof Error ? e.message : "Couldn't fetch route");
      } finally {
        if (mounted.current) setQuoteLoading(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    fromChain?.id,
    toChain?.id,
    fromToken?.address,
    toToken?.address,
    numericAmount,
    slippageBps,
    publicKey,
  ]);

  const handleAmountChange = (v: string) => {
    if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
  };

  const handleBridge = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction || !quote || !fromToken || !toToken) return;
    const startedAt = Date.now();
    try {
      setPhase({ name: "building" });
      const built = await supaPost("bridge-build", { quote: quote.raw });
      const txB64 = built.solanaTransaction ?? built.transactionRequest?.data;
      if (!txB64) throw new Error("Bridge route returned no Solana transaction");

      setPhase({ name: "awaiting_signature" });
      const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);

      let signed: VersionedTransaction;
      try {
        signed = await signTransaction(tx);
      } catch {
        if (mounted.current) setPhase({ name: "error", message: "Cancelled — try again." });
        return;
      }

      setPhase({ name: "submitting" });
      const signedB64 = btoa(String.fromCharCode(...signed.serialize()));
      const submitted = await supaPost("tx-submit", {
        signedTransaction: signedB64,
        kind: "bridge",
        valueUsd: quote.fromAmountUsd ?? quote.toAmountUsd ?? null,
        inputMint: fromToken.address,
        outputMint: toToken.address,
        inputAmount: numericAmount,
        outputAmount: Number(quote.toAmountAtomic) / Math.pow(10, toToken.decimals),
        walletAddress: publicKey.toBase58(),
      });
      const signature = submitted.signature as string;
      if (!signature) throw new Error("No signature returned from submit");

      setPhase({ name: "bridging", signature, startedAt });

      // Poll LI.FI status until DONE / FAILED / timeout. The Solana sig is the
      // source-chain hash; LI.FI maps it to the destination-chain receive tx.
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (!mounted.current) return;
        await sleep(POLL_INTERVAL_MS);
        try {
          const status = await supaGet("bridge-status", {
            txHash: signature,
            fromChain: String(quote.raw?.action?.fromChainId ?? ""),
            toChain: String(quote.raw?.action?.toChainId ?? ""),
            bridge: quote.tool ?? "",
          });
          if (status.status === "DONE") {
            const recv = status.receiving;
            const destAmountUi = recv?.amount && toToken.decimals != null
              ? Number(recv.amount) / Math.pow(10, toToken.decimals)
              : Number(quote.toAmountAtomic) / Math.pow(10, toToken.decimals);
            const destExplorer = recv?.txLink ?? null;
            if (!mounted.current) return;
            setPhase({
              name: "success",
              signature,
              durationMs: Date.now() - startedAt,
              toAmountUi: destAmountUi,
              toSymbol: toToken.symbol,
              destExplorer,
            });
            return;
          }
          if (status.status === "FAILED" || status.status === "INVALID") {
            throw new Error(status.substatus ?? "Bridge failed on-chain");
          }
        } catch {
          continue;
        }
      }
      throw new Error("Bridge is taking longer than expected. Track it on LI.FI Explorer.");
    } catch (e) {
      if (!mounted.current) return;
      setPhase({ name: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }, [connected, publicKey, signTransaction, quote, fromToken, toToken, numericAmount]);

  const reset = () => {
    setAmount("");
    setQuote(null);
    setPhase({ name: "idle" });
  };

  // ---------- Success ----------
  if (phase.name === "success") {
    return (
      <div className="ease-vision animate-fade-up w-full max-w-[440px] overflow-hidden rounded-2xl border border-up/30 bg-card/60 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-up/40 bg-up/10">
            <CheckCircle2 className="h-7 w-7 text-up" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Bridge complete
            </p>
            <p className="mt-2 font-mono text-sm text-foreground">
              {fmtAmount(phase.toAmountUi)} {phase.toSymbol} received
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              in {(phase.durationMs / 1000).toFixed(1)}s
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <a
              href={`https://solscan.io/tx/${phase.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ease-vision inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-secondary"
            >
              Source tx {truncSig(phase.signature)}
              <ExternalLink className="h-3 w-3" />
            </a>
            {phase.destExplorer && (
              <a
                href={phase.destExplorer}
                target="_blank"
                rel="noopener noreferrer"
                className="ease-vision inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-secondary"
              >
                Destination tx
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <Button
            onClick={reset}
            className="ease-vision mt-2 w-full font-mono text-[11px] uppercase tracking-wider"
          >
            New bridge
          </Button>
        </div>
      </div>
    );
  }

  // ---------- CTA ----------
  const isBusy =
    phase.name === "building" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting" ||
    phase.name === "bridging";

  const busyLabel =
    phase.name === "building" ? "Building transaction…"
    : phase.name === "awaiting_signature" ? "Approve in wallet…"
    : phase.name === "submitting" ? "Submitting…"
    : phase.name === "bridging" ? "Bridging across chains…"
    : "";

  let ctaLabel = "Bridge";
  let ctaDisabled = false;
  let ctaAction: (() => void) | null = handleBridge;
  if (!connected) {
    ctaLabel = "Connect wallet";
    ctaAction = () => setVisible(true);
  } else if (!toChain || !toToken) {
    ctaLabel = "Select destination";
    ctaDisabled = true; ctaAction = null;
  } else if (numericAmount <= 0) {
    ctaLabel = "Enter an amount";
    ctaDisabled = true; ctaAction = null;
  } else if (quoteLoading) {
    ctaLabel = "Finding best route…";
    ctaDisabled = true; ctaAction = null;
  } else if (quoteError) {
    ctaLabel = "No route — try a different pair";
    ctaDisabled = true; ctaAction = null;
  } else if (isBusy) {
    ctaLabel = busyLabel;
    ctaDisabled = true; ctaAction = null;
  }

  const toAmountUi = quote && toToken
    ? Number(quote.toAmountAtomic) / Math.pow(10, toToken.decimals)
    : 0;
  const minReceivedUi = quote && toToken
    ? Number(quote.toAmountMinAtomic) / Math.pow(10, toToken.decimals)
    : 0;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="ease-vision animate-fade-up w-full max-w-[440px] overflow-hidden rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <TradeTabs active={tab} onChange={onTabChange} />
        </div>

        <div className="space-y-3 p-4">
          {/* From row (Solana, locked for v1) */}
          <PanelRow
            label="From"
            chainName={fromChain?.name ?? "Solana"}
            chainLogo={fromChain?.logo ?? null}
            chainLocked
            token={fromToken}
            onPickToken={() => fromChain && setPicker({ side: "from" })}
            amount={amount}
            onAmountChange={handleAmountChange}
            amountReadonly={false}
            usd={quote?.fromAmountUsd ?? (fromToken?.priceUsd != null ? fromToken.priceUsd * numericAmount : null)}
          />

          <div className="flex justify-center">
            <div className="rounded-full border border-border/60 bg-secondary/60 p-1.5">
              <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>

          {/* To row */}
          <PanelRow
            label="To"
            chainName={toChain?.name ?? "Select chain"}
            chainLogo={toChain?.logo ?? null}
            onPickChain={() => setChainPicker("to")}
            token={toToken}
            onPickToken={() => toChain && setPicker({ side: "to" })}
            amount={toAmountUi > 0 ? fmtAmount(toAmountUi) : ""}
            onAmountChange={() => {}}
            amountReadonly
            usd={quote?.toAmountUsd ?? null}
            placeholder={quoteLoading ? "…" : "0.00"}
          />

          {/* Quote details */}
          {quote && (
            <div className="space-y-1.5 rounded-xl border border-border/40 bg-secondary/20 px-3 py-2.5 font-mono text-[10px] text-muted-foreground">
              <Detail label="Route" value={quote.toolName} />
              {quote.executionDurationSec != null && (
                <Detail
                  label="Est. time"
                  value={
                    quote.executionDurationSec < 60
                      ? `${quote.executionDurationSec}s`
                      : `~${Math.round(quote.executionDurationSec / 60)}m`
                  }
                />
              )}
              <Detail
                label="Min received"
                value={`${fmtAmount(minReceivedUi)} ${toToken?.symbol ?? ""}`}
              />
              {quote.gasFeeUsd != null && (
                <Detail label="Gas (est.)" value={fmtUsd(quote.gasFeeUsd)} />
              )}
              <Detail
                label={
                  <span className="inline-flex items-center gap-1">
                    Vision fee (1%)
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-2.5 w-2.5 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Deducted from the input amount and routed via LI.FI's integrator program.
                      </TooltipContent>
                    </Tooltip>
                  </span>
                }
                value={fmtUsd(quote.platformFeeUsd ?? (quote.fromAmountUsd ? quote.fromAmountUsd * 0.01 : null))}
              />
            </div>
          )}

          {quoteError && (
            <div className="flex items-start gap-2 rounded-xl border border-down/30 bg-down/5 px-3 py-2 font-mono text-[10px] text-down">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{quoteError}</span>
            </div>
          )}
          {phase.name === "error" && (
            <div className="flex items-start gap-2 rounded-xl border border-down/30 bg-down/5 px-3 py-2 font-mono text-[10px] text-down">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{phase.message}</span>
            </div>
          )}

          <Button
            onClick={() => ctaAction?.()}
            disabled={ctaDisabled || isBusy || ctaAction == null}
            className="ease-vision h-11 w-full rounded-full font-mono text-[11px] uppercase tracking-wider"
          >
            {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {ctaLabel}
          </Button>

          <p className="text-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">
            Powered by LI.FI · {chains.length} chains supported
          </p>
        </div>
      </div>

      {/* Chain picker (destination only for v1) */}
      <ChainPickerDialog
        open={chainPicker !== null}
        onClose={() => setChainPicker(null)}
        chains={chains.filter((c) => c.id !== SOLANA_CHAIN_ID)}
        loading={chainsLoading}
        onPick={(c) => {
          setToChain(c);
          setToToken(null);
          setChainPicker(null);
        }}
      />

      {/* Token picker */}
      <BridgeTokenPickerDialog
        open={picker !== null}
        onClose={() => setPicker(null)}
        chain={picker?.side === "from" ? fromChain ?? null : toChain}
        onPick={(t) => {
          if (picker?.side === "from") setFromToken(t);
          else setToToken(t);
          setPicker(null);
        }}
      />
    </TooltipProvider>
  );
};

// ---------- Sub-components ----------

const Detail = ({ label, value }: { label: React.ReactNode; value: React.ReactNode }) => (
  <div className="flex items-center justify-between">
    <span>{label}</span>
    <span className="text-foreground/90">{value}</span>
  </div>
);

interface PanelRowProps {
  label: string;
  chainName: string;
  chainLogo: string | null;
  chainLocked?: boolean;
  onPickChain?: () => void;
  token: BridgeToken | null;
  onPickToken: () => void;
  amount: string;
  onAmountChange: (v: string) => void;
  amountReadonly: boolean;
  usd: number | null;
  placeholder?: string;
}

const PanelRow = ({
  label, chainName, chainLogo, chainLocked, onPickChain,
  token, onPickToken, amount, onAmountChange, amountReadonly, usd, placeholder,
}: PanelRowProps) => (
  <div className="rounded-xl border border-border/60 bg-secondary/30 p-3">
    <div className="flex items-center justify-between">
      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        onClick={chainLocked ? undefined : onPickChain}
        disabled={chainLocked}
        className={cn(
          "ease-vision inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors",
          !chainLocked && "hover:bg-secondary hover:text-foreground",
          chainLocked && "cursor-default opacity-80",
        )}
      >
        {chainLogo && <img src={chainLogo} alt="" className="h-3 w-3 rounded-full" />}
        <span>{chainName}</span>
        {!chainLocked && <ChevronDown className="h-2.5 w-2.5" />}
      </button>
    </div>
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={onPickToken}
        className="ease-vision flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2 py-1.5 hover:bg-secondary"
      >
        {token ? (
          <>
            <TokenLogo symbol={token.symbol} src={token.logo} size={20} />
            <span className="font-mono text-xs font-semibold text-foreground">{token.symbol}</span>
          </>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Select token
          </span>
        )}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      <Input
        value={amount}
        onChange={(e) => onAmountChange(e.target.value)}
        readOnly={amountReadonly}
        placeholder={placeholder ?? "0.00"}
        inputMode="decimal"
        className="h-9 border-0 bg-transparent text-right font-mono text-base focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    </div>
    <div className="mt-1 flex justify-end font-mono text-[10px] text-muted-foreground">
      {usd != null ? fmtUsd(usd) : "—"}
    </div>
  </div>
);

// ---------- Chain picker dialog ----------

const ChainPickerDialog = ({
  open, onClose, chains, loading, onPick,
}: {
  open: boolean;
  onClose: () => void;
  chains: Chain[];
  loading: boolean;
  onPick: (c: Chain) => void;
}) => {
  const [q, setQ] = useState("");
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return chains;
    return chains.filter(
      (c) => c.name.toLowerCase().includes(term) || c.key.toLowerCase().includes(term),
    );
  }, [q, chains]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="font-mono text-xs uppercase tracking-wider">
            Select destination chain
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 py-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chains…"
            className="h-9 font-mono text-xs"
            autoFocus
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-2 pb-3">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              No chains found
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c)}
                className="ease-vision flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary"
              >
                {c.logo
                  ? <img src={c.logo} alt="" className="h-6 w-6 rounded-full" />
                  : <div className="h-6 w-6 rounded-full bg-secondary" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground">{c.name}</div>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    {c.chainType} · native {c.nativeSymbol}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ---------- Token picker (per-chain, fetched on open) ----------

const tokenCache = new Map<string, BridgeToken[]>();

const BridgeTokenPickerDialog = ({
  open, onClose, chain, onPick,
}: {
  open: boolean;
  onClose: () => void;
  chain: Chain | null;
  onPick: (t: BridgeToken) => void;
}) => {
  const [tokens, setTokens] = useState<BridgeToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open || !chain) return;
    setQ("");
    const key = String(chain.id);
    const cached = tokenCache.get(key);
    if (cached) {
      setTokens(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await supaGet("bridge-tokens", { chain: key });
        if (cancelled) return;
        const list: BridgeToken[] = data.tokens ?? [];
        tokenCache.set(key, list);
        setTokens(list);
      } catch {
        if (!cancelled) setTokens([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, chain?.id]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return tokens;
    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(term) ||
        t.name.toLowerCase().includes(term) ||
        t.address.toLowerCase() === term,
    );
  }, [q, tokens]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="font-mono text-xs uppercase tracking-wider">
            Select token on {chain?.name ?? ""}
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 py-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by symbol, name, or address…"
            className="h-9 font-mono text-xs"
            autoFocus
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-2 pb-3">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              No tokens found
            </div>
          ) : (
            filtered.map((t) => (
              <button
                key={`${t.chainId}-${t.address}`}
                type="button"
                onClick={() => onPick(t)}
                className="ease-vision flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary"
              >
                <TokenLogo symbol={t.symbol} src={t.logo} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">{t.symbol}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">{t.name}</span>
                  </div>
                  <div className="font-mono text-[9px] text-muted-foreground/70">
                    {t.address.slice(0, 6)}…{t.address.slice(-4)}
                  </div>
                </div>
                {t.priceUsd != null && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {fmtUsd(t.priceUsd)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
