// TradeSwap — unified "any token, any chain" swap UI.
//
// Backed by the route-quote orchestrator + useRouteExecutor:
//   - Solana same-chain swap         → Jupiter (existing path)
//   - EVM same-chain swap            → 0x (Vision EVM driver or wagmi)
//   - Cross-chain bridge             → LI.FI direct
//   - Cross-chain bridge_then_swap   → LI.FI bridge to USDC + destination 0x/Jupiter swap
//
// The 1% Vision platform fee is applied per-leg by the underlying quote/build
// functions (see useRouteExecutor for the per-strategy breakdown). Bridge-only
// flows lean on LI.FI's integrator fee; bridge+swap flows charge only on the
// destination swap leg.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowDownToLine,
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
import { useAccount } from "wagmi";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
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
  MultichainTokenPickerDialog,
  pushRecentMultichainToken,
  type MultichainToken,
  type ChainKey,
} from "@/components/trade/MultichainTokenPickerDialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import {
  WalletSourcePicker,
  type WalletSource,
} from "@/components/trade/WalletSourcePicker";
import { FundVisionWalletDialog } from "@/components/wallet/FundVisionWalletDialog";
import { useRouteExecutor, type ExecutorStatus, type RoutePlan } from "@/components/trade/useRouteExecutor";
import { RouteProgressModal } from "@/components/trade/RouteProgressModal";

const SOL_TOKEN: MultichainToken = {
  symbol: "SOL",
  name: "Solana",
  address: "So11111111111111111111111111111111111111112",
  decimals: 9,
  logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  priceUsd: null,
  chainId: "SOL",
};

const SLIPPAGE_PRESETS = [
  { label: "0.1%", bps: 10 },
  { label: "0.5%", bps: 50 },
  { label: "1.0%", bps: 100 },
];

const QUOTE_DEBOUNCE_MS = 400;
const QUOTE_REFRESH_MS = 15_000;

const isSol = (c: ChainKey) => String(c).toUpperCase() === "SOL";
const tokenKey = (t: { address: string; chainId: ChainKey }) =>
  `${t.chainId}:${t.address.toLowerCase()}`;

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
    const transient =
      status === 503 || status === 504 ||
      (serverMsg ?? error.message ?? "").toLowerCase().includes("temporarily unavailable") ||
      (serverMsg ?? error.message ?? "").toLowerCase().includes("runtime_error");
    if (transient && attempt < 2) {
      await sleep(400 * (attempt + 1));
      return supaPost(fn, body, attempt + 1);
    }
    throw new Error(serverMsg ?? error.message ?? `${fn} failed`);
  }
  if (data && typeof data === "object" && "error" in (data as any) && (data as any).error && !(data as any).fallback) {
    throw new Error((data as any).error);
  }
  return data;
};

interface TradeSwapProps {
  tab: TradeTab;
  onTabChange: (t: TradeTab) => void;
}

export const TradeSwap = ({ tab, onTabChange }: TradeSwapProps) => {
  const [inputToken, setInputToken] = useState<MultichainToken>(SOL_TOKEN);
  const [outputToken, setOutputToken] = useState<MultichainToken | null>(null);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [customSlippage, setCustomSlippage] = useState("");
  const [dynamicSlippage, setDynamicSlippage] = useState(true);

  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [pickerSide, setPickerSide] = useState<"in" | "out" | null>(null);
  const [status, setStatus] = useState<ExecutorStatus>({ kind: "idle" });
  const [inputBalance, setInputBalance] = useState<number | null>(null);
  const [walletSource, setWalletSource] = useState<WalletSource>("vision");
  const [fundOpen, setFundOpen] = useState(false);

  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { address: externalEvmAddress } = useAccount();
  const visionWallet = useVisionWallet();
  const { execute } = useRouteExecutor();
  const mounted = useRef(true);

  // Resolve the active payer address for the SOURCE chain of the trade.
  // Solana trades use the Solana address; EVM trades use the EVM address.
  // For cross-chain we also need the DESTINATION address — see toAddress.
  const fromAddress: string | null = useMemo(() => {
    if (isSol(inputToken.chainId)) {
      return walletSource === "vision"
        ? visionWallet.solanaAddress
        : publicKey?.toBase58() ?? null;
    }
    return walletSource === "vision"
      ? visionWallet.evmAddress
      : externalEvmAddress ?? null;
  }, [inputToken.chainId, walletSource, visionWallet.solanaAddress, visionWallet.evmAddress, publicKey, externalEvmAddress]);

  // Destination address — same chain as outputToken.
  const toAddress: string | null = useMemo(() => {
    if (!outputToken) return null;
    if (isSol(outputToken.chainId)) {
      return walletSource === "vision"
        ? visionWallet.solanaAddress
        : publicKey?.toBase58() ?? null;
    }
    return walletSource === "vision"
      ? visionWallet.evmAddress
      : externalEvmAddress ?? null;
  }, [outputToken, walletSource, visionWallet.solanaAddress, visionWallet.evmAddress, publicKey, externalEvmAddress]);

  // Whether the active wallet source can sign for the source chain.
  const fromReady = !!fromAddress;
  // For cross-chain, we ALSO need the destination address provisioned.
  const toReady = !!toAddress;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Load balance for the input token, scoped to the current source-chain payer.
  // Solana uses on-chain RPC (cheap, no edge call); EVM uses evm-wallet-balance
  // which already understands chain-specific token lists + USD pricing.
  useEffect(() => {
    if (!fromAddress) { setInputBalance(null); return; }
    let cancelled = false;
    setInputBalance(null);

    (async () => {
      try {
        if (isSol(inputToken.chainId)) {
          const owner = new PublicKey(fromAddress);
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
        } else {
          // EVM — call evm-wallet-balance and find the matching holding.
          const { data, error } = await supabase.functions.invoke("evm-wallet-balance", {
            body: { address: fromAddress, chainId: Number(inputToken.chainId) },
          });
          if (cancelled) return;
          if (error || !data || data.error) { setInputBalance(null); return; }
          const holdings = Array.isArray(data.holdings) ? data.holdings : [];
          // evm-wallet-balance reports native as 0x000…0; user picks 0xEeeE… for native.
          const isNativeQuery = inputToken.address.toLowerCase().startsWith("0xeeee");
          const match = holdings.find((h: any) => {
            const a = String(h.address ?? h.mint ?? "").toLowerCase();
            if (isNativeQuery) return /^0x0{40}$/i.test(a);
            return a === inputToken.address.toLowerCase();
          });
          setInputBalance(typeof match?.amount === "number" ? match.amount : 0);
        }
      } catch {
        if (!cancelled) setInputBalance(null);
      }
    })();

    return () => { cancelled = true; };
  }, [fromAddress, connection, inputToken.address, inputToken.chainId, status.kind]);

  const numericAmount = useMemo(() => {
    const n = parseFloat(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  // ---- Quote via the orchestrator (debounced) ----
  useEffect(() => {
    setPlan(null);
    setPlanError(null);
    if (!outputToken || numericAmount <= 0 || !fromAddress) {
      setPlanLoading(false);
      return;
    }
    // Skip the cross-chain leg requirement upfront — orchestrator validates anyway.
    setPlanLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const fresh = await supaPost("route-quote", {
          fromChain: inputToken.chainId,
          toChain: outputToken.chainId,
          fromToken: inputToken.address,
          toToken: outputToken.address,
          fromAddress,
          toAddress: toAddress ?? fromAddress,
          amount: numericAmount,
          fromDecimals: inputToken.decimals,
          toDecimals: outputToken.decimals,
          fromSymbol: inputToken.symbol,
          toSymbol: outputToken.symbol,
          slippageBps,
        });
        if (!mounted.current) return;
        setPlan(fresh as RoutePlan);
        setPlanError(null);
      } catch (e) {
        if (!mounted.current) return;
        setPlan(null);
        setPlanError(e instanceof Error ? e.message : "Couldn't fetch route");
      } finally {
        if (mounted.current) setPlanLoading(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    inputToken.address, inputToken.chainId, inputToken.decimals,
    outputToken?.address, outputToken?.chainId, outputToken?.decimals,
    numericAmount, slippageBps, fromAddress, toAddress,
  ]);

  // Auto-refresh quote every 15s while idle and we have one.
  useEffect(() => {
    if (!plan || status.kind !== "idle" || !outputToken || !fromAddress) return;
    const timer = window.setInterval(async () => {
      if (!mounted.current) return;
      setRefreshing(true);
      try {
        const fresh = await supaPost("route-quote", {
          fromChain: inputToken.chainId,
          toChain: outputToken.chainId,
          fromToken: inputToken.address,
          toToken: outputToken.address,
          fromAddress,
          toAddress: toAddress ?? fromAddress,
          amount: numericAmount,
          fromDecimals: inputToken.decimals,
          toDecimals: outputToken.decimals,
          fromSymbol: inputToken.symbol,
          toSymbol: outputToken.symbol,
          slippageBps,
        });
        if (mounted.current) setPlan(fresh as RoutePlan);
      } catch { /* keep stale */ }
      finally { if (mounted.current) setRefreshing(false); }
    }, QUOTE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [plan, status.kind, inputToken, outputToken, numericAmount, slippageBps, fromAddress, toAddress]);

  const flip = () => {
    if (!outputToken) return;
    const newIn = outputToken;
    const newOut = inputToken;
    setInputToken(newIn);
    setOutputToken(newOut);
    setAmount(plan?.summary.toAmountUi ? String(plan.summary.toAmountUi) : "");
  };

  const handleAmountChange = (v: string) => {
    if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
  };

  const handleMax = () => {
    if (inputBalance == null) return;
    if (isSol(inputToken.chainId) && inputToken.address === SOL_TOKEN.address) {
      const reserve = 0.01;
      const max = Math.max(0, inputBalance - reserve);
      setAmount(max > 0 ? max.toFixed(6) : "");
    } else if (!isSol(inputToken.chainId) && inputToken.address.toLowerCase().startsWith("0xeeee")) {
      // EVM native — reserve a touch for gas.
      const reserve = 0.001;
      const max = Math.max(0, inputBalance - reserve);
      setAmount(max > 0 ? max.toFixed(6) : "");
    } else {
      setAmount(inputBalance > 0 ? String(inputBalance) : "");
    }
  };

  const handlePickToken = (t: MultichainToken) => {
    if (pickerSide === "in") {
      if (outputToken && tokenKey(outputToken) === tokenKey(t)) {
        setOutputToken(inputToken);
      }
      setInputToken(t);
    } else if (pickerSide === "out") {
      if (tokenKey(inputToken) === tokenKey(t)) {
        setInputToken(outputToken ?? SOL_TOKEN);
      }
      setOutputToken(t);
    }
    pushRecentMultichainToken(t);
    setAmount("");
    setPlan(null);
  };

  const insufficient =
    inputBalance != null && numericAmount > 0 &&
    numericAmount > (
      isSol(inputToken.chainId) && inputToken.address === SOL_TOKEN.address
        ? Math.max(0, inputBalance - 0.005)
        : inputBalance
    );

  const handleSwap = useCallback(async () => {
    if (!plan || !outputToken || !fromAddress || !toAddress) return;
    await execute({
      plan,
      fromToken: inputToken,
      toToken: outputToken,
      walletSource,
      fromAddress,
      toAddress,
      slippageBps,
      dynamicSlippage,
      onStatus: (s) => { if (mounted.current) setStatus(s); },
    });
  }, [plan, outputToken, fromAddress, toAddress, inputToken, walletSource, slippageBps, dynamicSlippage, execute]);

  const resetSwap = () => {
    setAmount("");
    setPlan(null);
    setStatus({ kind: "idle" });
  };

  // ---------- Success view ----------
  if (status.kind === "success") {
    const last = status.legHashes[status.legHashes.length - 1];
    return (
      <div className="ease-vision animate-fade-up w-full max-w-[440px] overflow-hidden rounded-2xl border border-up/30 bg-card/60 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-up/40 bg-up/10">
            <CheckCircle2 className="h-7 w-7 text-up" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {plan?.strategy === "swap" ? "Swap confirmed" : "Cross-chain swap confirmed"}
            </p>
            <p className="mt-2 font-mono text-sm text-foreground">
              {fmtAmount(numericAmount)} {inputToken.symbol} → {fmtAmount(status.finalAmountUi)} {status.finalSymbol}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              in {(status.durationMs / 1000).toFixed(1)}s · {status.legHashes.length} {status.legHashes.length === 1 ? "leg" : "legs"}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            {status.legHashes.map((leg, i) => (
              <a
                key={i}
                href={leg.explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="ease-vision inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-secondary"
              >
                Leg {i + 1} · {truncSig(leg.hash)}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
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

  // (cancelled / error / in-flight states are handled by RouteProgressModal)

  // ---------- CTA computation ----------
  const isBusy =
    status.kind === "building" || status.kind === "approving" ||
    status.kind === "switching_chain" || status.kind === "awaiting_signature" ||
    status.kind === "submitting" || status.kind === "confirming" ||
    status.kind === "bridging";

  const busyLabel = (() => {
    switch (status.kind) {
      case "building": return status.legKind === "bridge" ? "Building bridge…" : "Building swap…";
      case "switching_chain": return "Switching chain…";
      case "approving": return "Approving token…";
      case "awaiting_signature":
        return walletSource === "vision" ? "Signing with Vision Wallet…" : "Approve in wallet…";
      case "submitting": return "Submitting…";
      case "confirming": return "Confirming on-chain…";
      case "bridging": return "Bridging across chains…";
      default: return "";
    }
  })();

  const sameChain = outputToken ? tokenKey({ address: "x", chainId: inputToken.chainId }).startsWith(`${outputToken.chainId}:`) : true;
  // Friendlier check above is wrong — use direct comparison:
  const isCrossChain = !!outputToken && String(outputToken.chainId) !== String(inputToken.chainId);

  let ctaLabel = walletSource === "vision" ? "Swap with Vision Wallet" : "Swap";
  if (isCrossChain && plan?.strategy === "bridge") ctaLabel = walletSource === "vision" ? "Bridge with Vision Wallet" : "Bridge";
  if (isCrossChain && plan?.strategy === "bridge_then_swap") ctaLabel = walletSource === "vision" ? "Bridge & swap with Vision" : "Bridge & swap";
  let ctaDisabled = false;
  let ctaAction: (() => void) | null = handleSwap;

  // Wallet provisioning checks — vary per chain.
  const needsSolWallet = (isSol(inputToken.chainId) || (outputToken && isSol(outputToken.chainId)));
  const needsEvmWallet = (!isSol(inputToken.chainId) || (outputToken && !isSol(outputToken.chainId)));

  if (walletSource === "vision") {
    const missingSol = needsSolWallet && !visionWallet.solanaAddress;
    const missingEvm = needsEvmWallet && !visionWallet.evmAddress;
    if (missingSol || missingEvm) {
      ctaLabel = visionWallet.working ? "Creating Vision Wallet…" : "Create Vision Wallet";
      ctaDisabled = visionWallet.working;
      ctaAction = visionWallet.working
        ? null
        : () => { visionWallet.createWallet().catch(() => { /* hook toasts */ }); };
    }
  } else if (walletSource === "external") {
    if (needsSolWallet && !connected) {
      ctaLabel = "Connect Solana wallet";
      ctaAction = () => setVisible(true);
    } else if (needsEvmWallet && !externalEvmAddress) {
      ctaLabel = "Connect EVM wallet";
      // Wagmi connect modal lives in the global RainbowKit provider — same
      // affordance the bridge tab used. Trigger via a CustomEvent picked up
      // there; if not yet wired, the user can use the Connect button in header.
      ctaAction = null;
      ctaDisabled = true;
    }
  }

  if (ctaAction === handleSwap) {
    if (!outputToken) { ctaLabel = "Select a token"; ctaDisabled = true; ctaAction = null; }
    else if (numericAmount <= 0) { ctaLabel = "Enter an amount"; ctaDisabled = true; ctaAction = null; }
    else if (insufficient) { ctaLabel = `Insufficient ${inputToken.symbol}`; ctaDisabled = true; ctaAction = null; }
    else if (planLoading) { ctaLabel = "Fetching best route…"; ctaDisabled = true; ctaAction = null; }
    else if (planError) { ctaLabel = "Retry"; ctaAction = () => setAmount((a) => a); }
    else if (!plan) { ctaLabel = "No route available"; ctaDisabled = true; ctaAction = null; }
    else if (isBusy) { ctaLabel = busyLabel; ctaDisabled = true; ctaAction = null; }
  }

  // ---- Stats from the orchestrator plan ----
  const inUsd = plan?.summary.fromAmountUsd ??
    (inputToken.priceUsd != null && numericAmount > 0 ? inputToken.priceUsd * numericAmount : null);
  const outUsd = plan?.summary.toAmountUsd ?? null;
  const outAmountUi = plan?.summary.toAmountUi ?? null;
  const platformFeeUsd = plan?.summary.platformFeeUsd ?? null;
  const gasUsd = plan?.summary.gasUsd ?? null;

  // Strategy badge for transparency.
  const strategyLabel = plan?.strategy === "swap"
    ? (isSol(inputToken.chainId) ? "Jupiter" : "0x")
    : plan?.strategy === "bridge"
      ? "LI.FI bridge"
      : plan?.strategy === "bridge_then_swap"
        ? "Bridge → swap"
        : null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="w-full max-w-[440px] space-y-4">
        {/* Tabs row */}
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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Dynamic slippage
                  </p>
                  <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    Solana legs use Jupiter's per-route tolerance. EVM legs use the cap below.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={dynamicSlippage}
                  onClick={() => setDynamicSlippage((v) => !v)}
                  className={cn(
                    "ease-vision relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
                    dynamicSlippage ? "border-primary/60 bg-primary/40" : "border-border/60 bg-secondary/60",
                  )}
                >
                  <span
                    className={cn(
                      "ease-vision inline-block h-3.5 w-3.5 rounded-full bg-foreground transition-transform",
                      dynamicSlippage ? "translate-x-[18px]" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {dynamicSlippage ? "Max slippage cap" : "Slippage tolerance"}
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                {SLIPPAGE_PRESETS.map((p) => (
                  <button
                    key={p.bps}
                    type="button"
                    onClick={() => { setSlippageBps(p.bps); setCustomSlippage(""); }}
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
            </PopoverContent>
          </Popover>
        </div>

        {/* Wallet source picker */}
        <WalletSourcePicker
          value={walletSource}
          onChange={setWalletSource}
          visionAvailable={!!visionWallet.solanaAddress || !!visionWallet.evmAddress}
          externalAvailable={connected || !!externalEvmAddress}
          onCreateVision={() => { visionWallet.createWallet().catch(() => { /* hook toasts */ }); }}
          onConnectExternal={() => setVisible(true)}
        />

        {/* Card */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm shadow-soft">
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

          {walletSource === "vision" && fromReady && inputBalance === 0 && isSol(inputToken.chainId) && (
            <button
              type="button"
              onClick={() => setFundOpen(true)}
              className="ease-vision flex w-full items-center justify-between border-t border-border/60 bg-primary/5 px-4 py-2.5 text-left text-xs text-primary transition-colors hover:bg-primary/10"
            >
              <span className="flex items-center gap-2">
                <ArrowDownToLine className="h-3.5 w-3.5" />
                No {inputToken.symbol} in your Vision Wallet — fund it to start trading
              </span>
              <span className="font-medium">Deposit →</span>
            </button>
          )}

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

          <SwapSide
            label="Buy"
            token={outputToken}
            amount={planLoading ? "" : outAmountUi != null ? fmtAmount(outAmountUi) : ""}
            onAmountChange={() => { /* read-only */ }}
            usd={outUsd}
            balance={null}
            onPickToken={() => setPickerSide("out")}
            readOnly
            loading={planLoading}
          />

          {/* Stats */}
          {plan && outputToken && (
            <div className="space-y-1.5 border-t border-border/40 px-5 py-3">
              <StatsRow
                label="Route"
                value={
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {strategyLabel ?? "Direct"}
                    {isCrossChain && plan.intermediate ? ` · via ${plan.intermediate.symbol}` : ""}
                  </span>
                }
                right={refreshing ? <RefreshCw className="h-3 w-3 animate-spin text-primary" /> : null}
              />
              {outAmountUi != null && numericAmount > 0 && (
                <StatsRow
                  label="Rate"
                  value={
                    <span className="font-mono text-[12px] text-foreground">
                      1 {inputToken.symbol} = {fmtAmount(outAmountUi / numericAmount)} {outputToken.symbol}
                    </span>
                  }
                />
              )}
              <StatsRow
                label="Slippage"
                value={
                  <span className="font-mono text-[12px] text-foreground">
                    {dynamicSlippage ? <>Dynamic <span className="text-muted-foreground">(max {(slippageBps / 100).toFixed(2)}%)</span></> : `${(slippageBps / 100).toFixed(2)}%`}
                  </span>
                }
              />
              {gasUsd != null && (
                <StatsRow
                  label="Network fee"
                  value={<span className="font-mono text-[12px] text-muted-foreground">~{fmtUsd(gasUsd)}</span>}
                />
              )}
              {platformFeeUsd != null && (
                <StatsRow
                  label={
                    <span className="flex items-center gap-1">
                      Platform fee
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-muted-foreground/60 hover:text-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[260px]">
                          <p className="font-mono text-[11px] leading-relaxed">
                            Vision charges 1% on the swap leg{plan.strategy === "bridge_then_swap" ? " (destination chain only)" : ""}. Bridges are otherwise free of Vision fee.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  }
                  value={<span className="font-mono text-[12px] text-muted-foreground">~{fmtUsd(platformFeeUsd)}</span>}
                />
              )}
              {plan.summary.executionDurationSec != null && isCrossChain && (
                <StatsRow
                  label="Est. duration"
                  value={<span className="font-mono text-[12px] text-muted-foreground">~{Math.round(plan.summary.executionDurationSec)}s</span>}
                />
              )}
            </div>
          )}

          {/* Inline error */}
          {planError && !planLoading && (
            <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
              <p className="font-mono text-[11px] leading-relaxed text-destructive">{planError}</p>
            </div>
          )}

          {status.kind === "error" && (
            <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-5 py-3">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
              <p className="font-mono text-[11px] leading-relaxed text-destructive">{status.message}</p>
            </div>
          )}

          {/* In-progress hint for cross-chain (so users don't think it's stuck) */}
          {(status.kind === "bridging" || status.kind === "confirming") && (
            <div className="flex items-start gap-2 border-t border-primary/30 bg-primary/5 px-5 py-3">
              <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
              <p className="font-mono text-[11px] leading-relaxed text-primary">
                {status.kind === "bridging" ? "Bridge in flight — this can take a few minutes." : "Waiting for on-chain confirmation."}
                {"explorer" in status && (
                  <>
                    {" "}
                    <a href={status.explorer} target="_blank" rel="noopener noreferrer" className="underline">
                      View tx
                    </a>
                  </>
                )}
              </p>
            </div>
          )}

          {/* CTA */}
          <div className="border-t border-border/40 bg-secondary/30 p-3">
            <Button
              onClick={() => {
                if (status.kind === "error") { setStatus({ kind: "idle" }); return; }
                ctaAction?.();
              }}
              disabled={ctaDisabled || isBusy}
              className={cn(
                "ease-vision h-12 w-full rounded-xl font-mono text-[12px] uppercase tracking-wider",
                fromReady && toReady && !ctaDisabled && "bg-primary text-primary-foreground shadow-glow hover:bg-primary/90",
              )}
            >
              {(isBusy || planLoading) && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {status.kind === "error" ? "Try again" : ctaLabel}
            </Button>
          </div>
        </div>

        {/* Token picker */}
        <MultichainTokenPickerDialog
          open={pickerSide !== null}
          onOpenChange={(o) => !o && setPickerSide(null)}
          onSelect={handlePickToken}
          excludeKey={
            pickerSide === "in" && outputToken ? tokenKey(outputToken) :
            pickerSide === "out" ? tokenKey(inputToken) : undefined
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

const SwapSide = ({
  label, token, amount, onAmountChange, usd, balance, onMax, onPickToken,
  readOnly = false, loading = false,
}: {
  label: string;
  token: MultichainToken | null;
  amount: string;
  onAmountChange: (v: string) => void;
  usd: number | null;
  balance: number | null;
  onMax?: () => void;
  onPickToken: () => void;
  readOnly?: boolean;
  loading?: boolean;
}) => {
  const chainLabel = token
    ? (isSol(token.chainId) ? "Solana" : `Chain ${token.chainId}`)
    : null;
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
              <div className="flex flex-col items-start leading-tight">
                <span className="font-mono text-sm font-medium text-foreground">{token.symbol}</span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{chainLabel}</span>
              </div>
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

const StatsRow = ({ label, value, right }: {
  label: React.ReactNode; value: React.ReactNode; right?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-2">
    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">
      {value}
      {right}
    </div>
  </div>
);
