import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Info,
  XCircle,
} from "lucide-react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { erc20Abi, formatUnits, type Hex } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TradeTabs, type TradeTab } from "@/components/trade/TradeTabs";
import { TokenLogo } from "@/components/TokenLogo";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useEvmBridge } from "@/hooks/useEvmBridge";
import { findEvmChain } from "@/lib/evm-chains";
import { BridgeProgressModal } from "@/components/trade/BridgeProgressModal";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { useVisionWalletSigner } from "@/hooks/useVisionWalletSigner";
import {
  WalletSourcePicker,
  type WalletSource,
} from "@/components/trade/WalletSourcePicker";

// CAIP-2 chain ID for Solana mainnet-beta — required by Privy's RPC.
const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// LI.FI uses numeric ids for every chain. Solana's id is this constant.
const SOLANA_CHAIN_ID = 1151111081099710 as const;
// Native SOL address per LI.FI's token list (the all-zeroes Solana system program).
const SOL_NATIVE_ADDRESS = "11111111111111111111111111111111";
// Fallback to wrapped SOL mint when LI.FI's list returns it instead.
const WSOL_MINT = "So11111111111111111111111111111111111111112";
// Standard EVM "native" placeholder (zero address).
const EVM_NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

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
  | { name: "switching_chain" }
  | { name: "approving" }
  | { name: "awaiting_signature" }
  | { name: "submitting" }
  | { name: "bridging"; sourceTxHash: string; sourceExplorer: string; startedAt: number; estimatedSec: number | null }
  | { name: "success"; sourceTxHash: string; sourceExplorer: string; durationMs: number; toAmountUi: number; toSymbol: string; destExplorer: string | null }
  | { name: "cancelled"; fromAmountUi: number; fromSymbol: string; toAmountUi: number; toSymbol: string }
  | { name: "error"; message: string };

/**
 * Live progress for the EVM bridge modal. Each step has its own status
 * so the modal can render a checklist; `approveSkipped`/`switchSkipped`
 * is a hint for the modal to grey those rows out.
 */
type EvmStepStatus = "pending" | "active" | "done" | "error" | "skipped";
interface EvmProgressState {
  switchStatus: EvmStepStatus;
  approveStatus: EvmStepStatus;
  signStatus: EvmStepStatus;
  confirmStatus: EvmStepStatus;
  bridgeStatus: EvmStepStatus;
  approvalHash: string | null;
  approvalExplorer: string | null;
  sourceTxHash: string | null;
  sourceExplorer: string | null;
  destExplorer: string | null;
  errorMessage: string | null;
  succeeded: boolean;
}

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

// Per-chain block explorer for source tx links. Falls back to Etherscan.
const EVM_EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io/tx/",
  10: "https://optimistic.etherscan.io/tx/",
  56: "https://bscscan.com/tx/",
  137: "https://polygonscan.com/tx/",
  324: "https://explorer.zksync.io/tx/",
  8453: "https://basescan.org/tx/",
  42161: "https://arbiscan.io/tx/",
  43114: "https://snowtrace.io/tx/",
  59144: "https://lineascan.build/tx/",
  534352: "https://scrollscan.com/tx/",
};
const buildExplorerUrl = (chainId: number, hash: string) =>
  `${EVM_EXPLORERS[chainId] ?? "https://etherscan.io/tx/"}${hash}`;

// Poll LI.FI's bridge-status until the receiving leg lands or we time out.
// Shared between the EVM and Solana source paths.
async function pollBridgeStatus(args: {
  txHash: string;
  quote: QuoteData;
  toToken: BridgeToken;
  startedAt: number;
  sourceExplorer: string;
  setPhase: (p: Phase) => void;
  mounted: React.MutableRefObject<boolean>;
}) {
  const { txHash, quote, toToken, startedAt, sourceExplorer, setPhase, mounted } = args;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!mounted.current) return;
    await sleep(POLL_INTERVAL_MS);
    try {
      const status = await supaGet("bridge-status", {
        txHash,
        fromChain: String(quote.raw?.action?.fromChainId ?? ""),
        toChain: String(quote.raw?.action?.toChainId ?? ""),
        bridge: quote.tool ?? "",
      });
      if (status.status === "DONE") {
        const recv = status.receiving;
        const destAmountUi = recv?.amount && toToken.decimals != null
          ? Number(recv.amount) / Math.pow(10, toToken.decimals)
          : Number(quote.toAmountAtomic) / Math.pow(10, toToken.decimals);
        if (!mounted.current) return;
        setPhase({
          name: "success",
          sourceTxHash: txHash,
          sourceExplorer,
          durationMs: Date.now() - startedAt,
          toAmountUi: destAmountUi,
          toSymbol: toToken.symbol,
          destExplorer: recv?.txLink ?? null,
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
  throw new Error("Bridge is taking longer than expected. You can keep tracking it from the source transaction.");
}

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
  const { connection } = useConnection();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const [chains, setChains] = useState<Chain[]>([]);
  const [chainsLoading, setChainsLoading] = useState(true);

  // Source chain is now selectable across SVM (Solana) and EVM chains.
  // Default = Solana, since most existing users are SOL-first.
  const [fromChain, setFromChain] = useState<Chain | null>(null);
  const [toChain, setToChain] = useState<Chain | null>(null);

  const [fromToken, setFromToken] = useState<BridgeToken | null>(null);
  const [toToken, setToToken] = useState<BridgeToken | null>(null);
  const [amount, setAmount] = useState("");
  const [slippageBps] = useState(50);
  // Required when destination is on a different chain family. Same-family
  // bridges (EVM↔EVM, SVM↔SVM) reuse the source address.
  const [destAddress, setDestAddress] = useState("");

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [picker, setPicker] = useState<null | { side: "from" | "to" }>(null);
  const [chainPicker, setChainPicker] = useState<null | "from" | "to">(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  // Modal-driven progress for EVM bridges. The Solana flow already feels
  // tight (single signature) so it keeps the inline CTA label.
  const [evmProgress, setEvmProgress] = useState<EvmProgressState | null>(null);

  // Wallet source — Vision Wallet is the recommended default. External is
  // available for users who want full self-custody control, or who need EVM
  // source bridges (Vision Wallet doesn't yet support EVM source bridges due
  // to the per-chain switching + ERC-20 approval flow).
  const [walletSource, setWalletSource] = useState<WalletSource>("vision");

  // EVM hooks (active whenever source is an EVM chain AND user picked external).
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { sendBridgeTx } = useEvmBridge();
  const visionWallet = useVisionWallet();
  const visionSigner = useVisionWalletSigner();

  const fromIsEvm = fromChain?.chainType === "EVM";
  const fromIsSvm = fromChain?.chainType === "SVM" || fromChain?.id === SOLANA_CHAIN_ID;

  // External-wallet source address (the original behaviour).
  const externalFromAddress = useMemo(() => {
    if (fromIsEvm) return evmConnected && evmAddress ? evmAddress : null;
    if (fromIsSvm) return connected && publicKey ? publicKey.toBase58() : null;
    return null;
  }, [fromIsEvm, fromIsSvm, evmConnected, evmAddress, connected, publicKey]);

  // Vision Wallet source address on the right chain family.
  const visionFromAddress = useMemo(() => {
    if (fromIsEvm) return visionWallet.evmAddress ?? null;
    if (fromIsSvm) return visionWallet.solanaAddress ?? null;
    return null;
  }, [fromIsEvm, fromIsSvm, visionWallet.evmAddress, visionWallet.solanaAddress]);

  // Vision Wallet currently does NOT support EVM source bridges (ERC-20
  // approval + per-chain switch flow not yet wired through Privy RPC).
  const visionEvmUnsupported = walletSource === "vision" && fromIsEvm;

  // The address we'll actually quote/build/sign against.
  const fromAddress = walletSource === "vision" ? visionFromAddress : externalFromAddress;

  // 1s ticker while bridging so the countdown label re-renders every second.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (phase.name !== "bridging") return;
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [phase.name]);

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
        // Default source → Solana, default destination → Ethereum.
        const sol = list.find((c) => c.id === SOLANA_CHAIN_ID);
        if (sol) setFromChain(sol);
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

  // ---------- Default source token whenever source chain changes ----------
  useEffect(() => {
    if (!fromChain) return;
    // Reset token if it no longer matches the chain.
    if (fromToken && fromToken.chainId === fromChain.id) return;
    if (fromIsSvm) {
      setFromToken({
        address: SOL_NATIVE_ADDRESS,
        symbol: "SOL",
        name: "Solana",
        decimals: 9,
        logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
        priceUsd: null,
        chainId: SOLANA_CHAIN_ID,
      });
    } else if (fromIsEvm) {
      setFromToken({
        address: EVM_NATIVE_ADDRESS,
        symbol: fromChain.nativeSymbol || "ETH",
        name: fromChain.nativeSymbol || "Native",
        decimals: 18,
        logo: fromChain.logo,
        priceUsd: null,
        chainId: fromChain.id,
      });
    } else {
      setFromToken(null);
    }
    // Clear amount/quote so we don't carry stale state across chain swaps.
    setAmount("");
    setQuote(null);
  }, [fromChain?.id, fromIsSvm, fromIsEvm]);

  // Source-token balance — branches by chain family.
  const [fromBalance, setFromBalance] = useState<number | null>(null);
  // Native EVM balance via wagmi.
  const { data: evmNativeBalance } = useBalance({
    address: fromIsEvm && evmConnected ? (evmAddress as Hex) : undefined,
    chainId: fromIsEvm ? Number(fromChain?.id ?? 0) : undefined,
  });

  useEffect(() => {
    // Solana balance branch (RPC parsed token accounts) — scoped to whichever
    // wallet is selected (Vision Wallet OR external).
    if (fromIsSvm && fromAddress && fromToken && fromToken.chainId === SOLANA_CHAIN_ID) {
      let cancelled = false;
      setFromBalance(null);
      let owner: PublicKey;
      try {
        owner = new PublicKey(fromAddress);
      } catch {
        setFromBalance(null);
        return;
      }
      (async () => {
        try {
          const isNative =
            fromToken.address === SOL_NATIVE_ADDRESS || fromToken.address === WSOL_MINT;
          if (isNative) {
            const lamports = await connection.getBalance(owner);
            if (!cancelled) setFromBalance(lamports / LAMPORTS_PER_SOL);
          } else {
            const mint = new PublicKey(fromToken.address);
            const resp = await connection.getParsedTokenAccountsByOwner(owner, { mint });
            let total = 0;
            for (const acc of resp.value) {
              const ui = acc.account.data.parsed?.info?.tokenAmount?.uiAmount;
              if (typeof ui === "number") total += ui;
            }
            if (!cancelled) setFromBalance(total);
          }
        } catch {
          if (!cancelled) setFromBalance(null);
        }
      })();
      return () => { cancelled = true; };
    }

    // EVM balance branch.
    if (fromIsEvm && evmConnected && evmAddress && fromToken && fromToken.chainId === fromChain?.id) {
      const isNative = fromToken.address.toLowerCase() === EVM_NATIVE_ADDRESS;
      if (isNative) {
        setFromBalance(evmNativeBalance ? Number(formatUnits(evmNativeBalance.value, evmNativeBalance.decimals)) : null);
        return;
      }
      // ERC-20 balance fetched via direct readContract through wagmi's public client.
      let cancelled = false;
      setFromBalance(null);
      (async () => {
        try {
          const { getPublicClient } = await import("wagmi/actions");
          const { wagmiConfig } = await import("@/providers/EvmWalletProvider");
          const pc = getPublicClient(wagmiConfig as any, { chainId: Number(fromChain.id) });
          if (!pc) return;
          const raw = (await (pc as any).readContract({
            address: fromToken.address as Hex,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [evmAddress as Hex],
          })) as bigint;
          if (!cancelled) setFromBalance(Number(formatUnits(raw, fromToken.decimals)));
        } catch {
          if (!cancelled) setFromBalance(null);
        }
      })();
      return () => { cancelled = true; };
    }

    setFromBalance(null);
  }, [
    fromIsSvm, fromIsEvm, connected, publicKey, evmConnected, evmAddress,
    fromToken, fromChain?.id, connection, evmNativeBalance,
  ]);

  const handleMax = useCallback(() => {
    if (fromBalance == null || !fromToken) return;
    if (fromIsSvm) {
      const isNative =
        fromToken.address === SOL_NATIVE_ADDRESS || fromToken.address === WSOL_MINT;
      if (isNative) {
        const reserve = 0.01;
        const max = Math.max(0, fromBalance - reserve);
        setAmount(max > 0 ? max.toFixed(6) : "");
      } else {
        setAmount(fromBalance > 0 ? String(fromBalance) : "");
      }
    } else if (fromIsEvm) {
      const isNative = fromToken.address.toLowerCase() === EVM_NATIVE_ADDRESS;
      if (isNative) {
        // Reserve enough for the bridge tx + approval gas.
        const reserve = 0.005;
        const max = Math.max(0, fromBalance - reserve);
        setAmount(max > 0 ? max.toFixed(6) : "");
      } else {
        setAmount(fromBalance > 0 ? String(fromBalance) : "");
      }
    }
  }, [fromBalance, fromToken, fromIsSvm, fromIsEvm]);

  const numericAmount = useMemo(() => {
    const n = parseFloat(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  // Cross-family bridges (SOL→EVM, EVM→SOL) need a destination address on
  // the receiving chain — the source wallet won't work. Same-family bridges
  // (SOL→SOL, EVM→EVM) reuse the source address.
  const sameFamily = !!(fromChain && toChain && fromChain.chainType === toChain.chainType);
  const destAddressValid = useMemo(() => {
    if (sameFamily) return true;
    if (!toChain) return false;
    const addr = destAddress.trim();
    if (toChain.chainType === "EVM") return /^0x[a-fA-F0-9]{40}$/.test(addr);
    if (toChain.chainType === "SVM") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
    return addr.length > 0;
  }, [sameFamily, destAddress, toChain]);

  // Reset destination address whenever the destination chain changes.
  useEffect(() => { setDestAddress(""); }, [toChain?.id]);

  // ---------- Quote (debounced) ----------
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (
      !fromChain || !toChain || !fromToken || !toToken ||
      numericAmount <= 0 || !publicKey ||
      (!sameFamily && !destAddressValid)
    ) {
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
          toAddress: sameFamily ? publicKey.toBase58() : destAddress.trim(),
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
    sameFamily,
    destAddress,
    destAddressValid,
  ]);

  const handleAmountChange = (v: string) => {
    if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
  };

  // Flip source ↔ destination so users can quickly reverse a route
  // (e.g. SOL→ETH becomes ETH→SOL) without manually re-picking chains.
  // We swap chains and tokens together to keep them family-consistent,
  // and clear amount/quote since the new source balance/route are different.
  const handleFlipChains = useCallback(() => {
    if (!fromChain || !toChain) return;
    const prevFromChain = fromChain;
    const prevToChain = toChain;
    const prevFromToken = fromToken;
    const prevToToken = toToken;
    setFromChain(prevToChain);
    setToChain(prevFromChain);
    setFromToken(prevToToken);
    setToToken(prevFromToken);
    setAmount("");
    setQuote(null);
    setQuoteError(null);
  }, [fromChain, toChain, fromToken, toToken]);

  const handleBridge = useCallback(async () => {
    if (!quote || !fromToken || !toToken || !fromChain || !fromAddress) return;
    const startedAt = Date.now();
    const outAmountUi = Number(quote.toAmountAtomic) / Math.pow(10, toToken.decimals);

    try {
      setPhase({ name: "building" });
      const built = await supaPost("bridge-build", { quote: quote.raw });

      // ============ EVM source path ============
      if (fromIsEvm) {
        const txReq = built.transactionRequest;
        if (!txReq?.to || !txReq?.data) {
          throw new Error("Bridge route returned no EVM transaction.");
        }
        const approvalAddress: string | null =
          quote.raw?.estimate?.approvalAddress ?? built.step?.estimate?.approvalAddress ?? null;

        let sourceTxHash: Hex;
        try {
          sourceTxHash = await sendBridgeTx({
            fromChainId: Number(fromChain.id),
            fromTokenAddress: fromToken.address,
            fromAmount: quote.fromAmountAtomic,
            approvalAddress,
            txRequest: txReq,
            onStatus: (s) => {
              if (!mounted.current) return;
              if (s === "switching") setPhase({ name: "switching_chain" });
              else if (s === "approving") setPhase({ name: "approving" });
              else if (s === "signing") setPhase({ name: "awaiting_signature" });
              else if (s === "confirming") setPhase({ name: "submitting" });
            },
          });
        } catch (e: any) {
          // User rejected in wallet → friendly cancelled state.
          const msg = String(e?.message ?? "").toLowerCase();
          if (msg.includes("user rejected") || msg.includes("denied") || msg.includes("rejected")) {
            if (mounted.current) setPhase({
              name: "cancelled",
              fromAmountUi: numericAmount,
              fromSymbol: fromToken.symbol,
              toAmountUi: outAmountUi,
              toSymbol: toToken.symbol,
            });
            return;
          }
          throw e;
        }

        const explorer = `https://etherscan.io/tx/${sourceTxHash}`; // overridden per-chain below if available
        const sourceExplorer = buildExplorerUrl(Number(fromChain.id), sourceTxHash);

        setPhase({
          name: "bridging",
          sourceTxHash,
          sourceExplorer,
          startedAt,
          estimatedSec: quote.executionDurationSec ?? null,
        });

        await pollBridgeStatus({
          txHash: sourceTxHash,
          quote,
          toToken,
          startedAt,
          sourceExplorer,
          setPhase,
          mounted,
        });
        return;
      }

      // ============ Solana source path (existing) ============
      if (!signTransaction || !publicKey) throw new Error("Connect your Solana wallet first.");
      const txB64 = built.solanaTransaction ?? built.transactionRequest?.data;
      if (!txB64) throw new Error("Bridge route returned no Solana transaction");

      setPhase({ name: "awaiting_signature" });
      const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);

      let signed: VersionedTransaction;
      try {
        signed = await signTransaction(tx);
      } catch {
        if (mounted.current) setPhase({
          name: "cancelled",
          fromAmountUi: numericAmount,
          fromSymbol: fromToken.symbol,
          toAmountUi: outAmountUi,
          toSymbol: toToken.symbol,
        });
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
        outputAmount: outAmountUi,
        walletAddress: publicKey.toBase58(),
      });
      const signature = submitted.signature as string;
      if (!signature) throw new Error("No signature returned from submit");

      const sourceExplorer = `https://solscan.io/tx/${signature}`;
      setPhase({
        name: "bridging",
        sourceTxHash: signature,
        sourceExplorer,
        startedAt,
        estimatedSec: quote.executionDurationSec ?? null,
      });

      await pollBridgeStatus({
        txHash: signature,
        quote,
        toToken,
        startedAt,
        sourceExplorer,
        setPhase,
        mounted,
      });
    } catch (e) {
      if (!mounted.current) return;
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setPhase({ name: "error", message: msg });
      // Surface failure inside the EVM progress modal too so users see the
      // error in context rather than a small CTA label.
      setEvmProgress((p) =>
        p
          ? {
              ...p,
              errorMessage: msg,
              bridgeStatus: p.bridgeStatus === "active" ? "error" : p.bridgeStatus,
            }
          : p,
      );
    }
  }, [quote, fromToken, toToken, fromChain, fromAddress, fromIsEvm, sendBridgeTx, signTransaction, publicKey, numericAmount]);

  const reset = () => {
    setAmount("");
    setQuote(null);
    setPhase({ name: "idle" });
    setEvmProgress(null);
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
              href={phase.sourceExplorer}
              target="_blank"
              rel="noopener noreferrer"
              className="ease-vision inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-secondary"
            >
              Source tx {truncSig(phase.sourceTxHash)}
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

  // ---------- Cancelled ----------
  if (phase.name === "cancelled") {
    return (
      <div className="ease-vision animate-fade-up w-full max-w-[440px] overflow-hidden rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-muted-foreground/30 bg-muted/30">
            <XCircle className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Bridge cancelled
            </p>
            <p className="mt-2 font-mono text-sm text-foreground">
              {fmtAmount(phase.fromAmountUi)} {phase.fromSymbol} → {fmtAmount(phase.toAmountUi)} {phase.toSymbol}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              No funds were moved.
            </p>
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
    phase.name === "switching_chain" ||
    phase.name === "approving" ||
    phase.name === "awaiting_signature" ||
    phase.name === "submitting" ||
    phase.name === "bridging";

  const fmtMMSS = (totalSec: number) => {
    const s = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  let busyLabel = "";
  if (phase.name === "building") busyLabel = "Building transaction…";
  else if (phase.name === "switching_chain") busyLabel = "Switch network in wallet…";
  else if (phase.name === "approving") busyLabel = "Approving token…";
  else if (phase.name === "awaiting_signature") busyLabel = "Approve in wallet…";
  else if (phase.name === "submitting") busyLabel = "Submitting…";
  else if (phase.name === "bridging") {
    const elapsedSec = Math.max(0, (nowTick - phase.startedAt) / 1000);
    const est = phase.estimatedSec;
    if (est && est > 0) {
      const remaining = est - elapsedSec;
      if (remaining > 0) {
        busyLabel = `Bridging across chains · ~${fmtMMSS(remaining)} remaining`;
      } else {
        const over = elapsedSec - est;
        busyLabel = `Finalizing — taking a bit longer · +${fmtMMSS(over)}`;
      }
    } else {
      busyLabel = `Bridging across chains · ${fmtMMSS(elapsedSec)} elapsed`;
    }
  }

  // CTA needs to know whether the *source-chain* wallet is connected.
  const sourceConnected = !!fromAddress;

  let ctaLabel = "Bridge";
  let ctaDisabled = false;
  let ctaAction: (() => void) | null = handleBridge;
  if (!fromChain || !fromToken) {
    ctaLabel = "Select source chain";
    ctaDisabled = true; ctaAction = null;
  } else if (!sourceConnected) {
    ctaLabel = fromIsEvm ? "Connect EVM wallet" : "Connect Solana wallet";
    ctaAction = null; // The Connect button is rendered separately below.
  } else if (!toChain || !toToken) {
    ctaLabel = "Select destination";
    ctaDisabled = true; ctaAction = null;
  } else if (numericAmount <= 0) {
    ctaLabel = "Enter an amount";
    ctaDisabled = true; ctaAction = null;
  } else if (
    fromBalance != null &&
    numericAmount >
      (fromIsSvm
        ? ((fromToken.address === SOL_NATIVE_ADDRESS || fromToken.address === WSOL_MINT)
            ? Math.max(0, fromBalance - 0.005)
            : fromBalance)
        : (fromToken.address.toLowerCase() === EVM_NATIVE_ADDRESS
            ? Math.max(0, fromBalance - 0.005)
            : fromBalance))
  ) {
    ctaLabel = "Insufficient balance";
    ctaDisabled = true; ctaAction = null;
  } else if (!sameFamily && !destAddressValid) {
    ctaLabel = toChain.chainType === "EVM"
      ? "Enter destination EVM address"
      : "Enter destination address";
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
          {/* From row — chain + token picker both unlocked */}
          <PanelRow
            label="From"
            chainName={fromChain?.name ?? "Select chain"}
            chainLogo={fromChain?.logo ?? null}
            onPickChain={() => setChainPicker("from")}
            token={fromToken}
            onPickToken={() => fromChain && setPicker({ side: "from" })}
            amount={amount}
            onAmountChange={handleAmountChange}
            amountReadonly={false}
            usd={quote?.fromAmountUsd ?? (fromToken?.priceUsd != null ? fromToken.priceUsd * numericAmount : null)}
            balance={fromBalance}
            onMax={fromBalance != null && fromBalance > 0 ? handleMax : undefined}
          />

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleFlipChains}
              disabled={!fromChain || !toChain}
              aria-label="Flip source and destination chains"
              className="group rounded-full border border-border/60 bg-secondary/60 p-1.5 text-muted-foreground transition-all duration-200 ease-vision hover:border-primary/40 hover:bg-secondary hover:text-foreground hover:rotate-180 disabled:opacity-50 disabled:hover:rotate-0"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </button>
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

          {/* Destination wallet (only required for cross-family bridges) */}
          {toChain && !sameFamily && (
            <div className="rounded-xl border border-border/60 bg-secondary/30 px-3 py-2.5">
              <label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Destination wallet on {toChain.name}
              </label>
              <Input
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                placeholder={
                  toChain.chainType === "EVM" ? "0x…" : "Wallet address"
                }
                spellCheck={false}
                className={cn(
                  "mt-1.5 h-9 border-0 bg-transparent px-0 font-mono text-xs focus-visible:ring-0 focus-visible:ring-offset-0",
                  destAddress && !destAddressValid && "text-down",
                )}
              />
              {destAddress && !destAddressValid && (
                <p className="font-mono text-[9px] text-down">
                  Doesn't look like a valid {toChain.chainType === "EVM" ? "EVM" : toChain.chainType} address.
                </p>
              )}
            </div>
          )}

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
                        Deducted from the input amount to support Vision's cross-chain routing.
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

          {/* CTA — when source is EVM and not connected, render the RainbowKit
              connect button instead of our regular Bridge button. */}
          {fromIsEvm && !sourceConnected ? (
            <div className="[&_button]:!h-11 [&_button]:!w-full [&_button]:!rounded-full [&_button]:!font-mono [&_button]:!text-[11px] [&_button]:!uppercase [&_button]:!tracking-wider">
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <Button onClick={openConnectModal} className="ease-vision h-11 w-full rounded-full font-mono text-[11px] uppercase tracking-wider">
                    Connect EVM wallet
                  </Button>
                )}
              </ConnectButton.Custom>
            </div>
          ) : !sourceConnected && fromIsSvm ? (
            <Button
              onClick={() => setVisible(true)}
              className="ease-vision h-11 w-full rounded-full font-mono text-[11px] uppercase tracking-wider"
            >
              Connect Solana wallet
            </Button>
          ) : (
            <Button
              onClick={() => ctaAction?.()}
              disabled={ctaDisabled || isBusy || ctaAction == null}
              className="ease-vision h-11 w-full rounded-full font-mono text-[11px] uppercase tracking-wider"
            >
              {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {ctaLabel}
            </Button>
          )}

          <p className="text-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">
            Vision routing · {chains.length} chains supported
          </p>
        </div>
      </div>

      {/* Chain picker — both source and destination */}
      <ChainPickerDialog
        open={chainPicker !== null}
        onClose={() => setChainPicker(null)}
        // Don't let the user pick the same chain on both sides.
        chains={chains.filter((c) => {
          if (chainPicker === "from") return c.id !== toChain?.id;
          if (chainPicker === "to") return c.id !== fromChain?.id;
          return true;
        })}
        loading={chainsLoading}
        title={chainPicker === "from" ? "Select source chain" : "Select destination chain"}
        onPick={(c) => {
          if (chainPicker === "from") {
            setFromChain(c);
            setFromToken(null);
          } else {
            setToChain(c);
            setToToken(null);
          }
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

      {/* EVM bridge progress modal — only opens during the EVM source path. */}
      <BridgeProgressModal
        open={evmProgress !== null}
        onOpenChange={(o) => { if (!o) setEvmProgress(null); }}
        busy={!!evmProgress && !evmProgress.succeeded && !evmProgress.errorMessage}
        succeeded={evmProgress?.succeeded ?? false}
        errorMessage={evmProgress?.errorMessage ?? null}
        onPrimaryAction={() => {
          const wasSuccess = evmProgress?.succeeded;
          setEvmProgress(null);
          if (wasSuccess) reset();
        }}
        primaryLabel={evmProgress?.succeeded ? "New bridge" : "Close"}
        steps={evmProgress ? [
          {
            id: "switch",
            label: `Switch to ${fromChain?.name ?? "source chain"}`,
            status: evmProgress.switchStatus,
          },
          {
            id: "approve",
            label: `Approve ${fromToken?.symbol ?? "token"}`,
            status: evmProgress.approveStatus,
            hint:
              evmProgress.approveStatus === "skipped"
                ? "Native asset — no approval needed"
                : evmProgress.approveStatus === "active"
                  ? "Confirm in your wallet…"
                  : undefined,
            explorerUrl: evmProgress.approvalExplorer ?? undefined,
          },
          {
            id: "sign",
            label: "Sign bridge transaction",
            status: evmProgress.signStatus,
            hint: evmProgress.signStatus === "active" ? "Confirm in your wallet…" : undefined,
          },
          {
            id: "confirm",
            label: "Wait for source confirmation",
            status: evmProgress.confirmStatus,
            explorerUrl: evmProgress.sourceExplorer ?? undefined,
          },
          {
            id: "bridge",
            label: "Bridge across chains",
            status: evmProgress.bridgeStatus,
            explorerUrl: evmProgress.sourceExplorer ?? undefined,
          },
        ] : []}
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
  balance?: number | null;
  onMax?: () => void;
}

const PanelRow = ({
  label, chainName, chainLogo, chainLocked, onPickChain,
  token, onPickToken, amount, onAmountChange, amountReadonly, usd, placeholder,
  balance, onMax,
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
            <TokenLogo symbol={token.symbol} logo={token.logo} size={20} />
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
    <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
      {balance != null ? (
        <div className="flex items-center gap-2">
          <span>Balance: {fmtAmount(balance)}</span>
          {onMax && (
            <button
              type="button"
              onClick={onMax}
              className="ease-vision rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary hover:bg-secondary"
            >
              Max
            </button>
          )}
        </div>
      ) : <span />}
      <span>{usd != null ? fmtUsd(usd) : "—"}</span>
    </div>
  </div>
);

// ---------- Chain picker dialog ----------

const ChainPickerDialog = ({
  open, onClose, chains, loading, onPick, title,
}: {
  open: boolean;
  onClose: () => void;
  chains: Chain[];
  loading: boolean;
  onPick: (c: Chain) => void;
  title?: string;
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
            {title ?? "Select chain"}
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

/** Hide tokens worth less than this in the "Your wallet" section to suppress dust/airdrop spam. */
const BRIDGE_HOLDINGS_MIN_USD = 1;
/** Per-chain recent picks, keyed by chain id. */
const BRIDGE_RECENT_KEY = "vision:bridge-recent-tokens";
const BRIDGE_RECENT_MAX = 6;

const getBridgeRecents = (chainId: number | string): BridgeToken[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BRIDGE_RECENT_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as Record<string, BridgeToken[]>;
    return all[String(chainId)] ?? [];
  } catch {
    return [];
  }
};

const pushBridgeRecent = (t: BridgeToken) => {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(BRIDGE_RECENT_KEY);
    const all = (raw ? JSON.parse(raw) : {}) as Record<string, BridgeToken[]>;
    const key = String(t.chainId);
    const cur = all[key] ?? [];
    all[key] = [t, ...cur.filter((c) => c.address !== t.address)].slice(0, BRIDGE_RECENT_MAX);
    window.localStorage.setItem(BRIDGE_RECENT_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
};

/** Symbols to surface as "Popular" when no holdings/recents apply, matched against the chain token list. */
const POPULAR_SYMBOLS = ["USDC", "USDT", "ETH", "WETH", "SOL", "WSOL", "DAI", "WBTC"];

interface HoldingMeta {
  address: string;
  amount: number;
  valueUsd: number | null;
}

const BridgeTokenPickerDialog = ({
  open, onClose, chain, onPick,
}: {
  open: boolean;
  onClose: () => void;
  chain: Chain | null;
  onPick: (t: BridgeToken) => void;
}) => {
  const { publicKey, connected } = useWallet();
  const { address: evmWalletAddress, isConnected: evmIsConnected } = useAccount();
  const walletAddress = connected && publicKey ? publicKey.toBase58() : null;
  const isSolanaChain = chain?.chainType === "SVM" || chain?.id === SOLANA_CHAIN_ID;
  const isEvmChain = !isSolanaChain && chain != null;
  const evmAddressForChain =
    isEvmChain && evmIsConnected && evmWalletAddress ? evmWalletAddress : null;

  const [tokens, setTokens] = useState<BridgeToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [holdings, setHoldings] = useState<HoldingMeta[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

  // Fetch chain token list on open.
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

  // Fetch wallet holdings — Solana via wallet-balance, EVM via the new
  // evm-wallet-balance edge function (multicalls balanceOf for the chain's
  // top tokens).
  useEffect(() => {
    if (!open) return;
    if (isSolanaChain && walletAddress) {
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
            .filter((h: any) => (h.valueUsd ?? 0) >= BRIDGE_HOLDINGS_MIN_USD && h.mint)
            .map((h: any) => ({
              address: h.mint as string,
              amount: typeof h.amount === "number" ? h.amount : 0,
              valueUsd: typeof h.valueUsd === "number" ? h.valueUsd : null,
            }));
          setHoldings(mapped);
        } catch {
          if (!cancelled) setHoldings([]);
        } finally {
          if (!cancelled) setHoldingsLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }

    if (isEvmChain && evmAddressForChain && chain) {
      let cancelled = false;
      setHoldingsLoading(true);
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("evm-wallet-balance", {
            body: { address: evmAddressForChain, chainId: Number(chain.id) },
          });
          if (cancelled) return;
          if (error || !data || data.error) {
            setHoldings([]);
            return;
          }
          const list = Array.isArray(data.holdings) ? data.holdings : [];
          const mapped: HoldingMeta[] = list
            .filter((h: any) => h.address)
            .map((h: any) => ({
              address: String(h.address),
              amount: typeof h.amount === "number" ? h.amount : 0,
              valueUsd: typeof h.valueUsd === "number" ? h.valueUsd : null,
            }));
          setHoldings(mapped);
        } catch {
          if (!cancelled) setHoldings([]);
        } finally {
          if (!cancelled) setHoldingsLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }

    setHoldings([]);
    return undefined;
  }, [open, isSolanaChain, isEvmChain, walletAddress, evmAddressForChain, chain?.id]);

  const recents = useMemo(
    () => (open && chain ? getBridgeRecents(chain.id) : []),
    [open, chain?.id],
  );

  // Hydrate holdings/recents/popular with the chain's canonical token metadata
  // (logo, decimals, price). Holdings return WSOL mint; the bridge token list
  // exposes SOL as the all-zeroes address, so alias both ways.
  const tokensByAddress = useMemo(() => {
    const m = new Map<string, BridgeToken>();
    for (const t of tokens) m.set(t.address.toLowerCase(), t);
    if (isSolanaChain) {
      const sol = m.get(SOL_NATIVE_ADDRESS.toLowerCase());
      if (sol) m.set(WSOL_MINT.toLowerCase(), sol);
    }
    return m;
  }, [tokens, isSolanaChain]);

  const visibleHoldings = useMemo(() => {
    if (!isSolanaChain && !isEvmChain) {
      return [] as Array<BridgeToken & { amount: number; valueUsd: number | null }>;
    }
    return holdings
      .map((h) => {
        const t = tokensByAddress.get(h.address.toLowerCase());
        if (!t) return null;
        return { ...t, amount: h.amount, valueUsd: h.valueUsd };
      })
      .filter((x): x is BridgeToken & { amount: number; valueUsd: number | null } => !!x)
      .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  }, [holdings, tokensByAddress, isSolanaChain, isEvmChain]);

  const holdingMints = useMemo(
    () => new Set(visibleHoldings.map((t) => t.address.toLowerCase())),
    [visibleHoldings],
  );

  const visibleRecents = useMemo(
    () =>
      recents
        .map((r) => tokensByAddress.get(r.address.toLowerCase()) ?? r)
        .filter((t) => !holdingMints.has(t.address.toLowerCase())),
    [recents, tokensByAddress, holdingMints],
  );

  const recentMints = useMemo(
    () => new Set(visibleRecents.map((t) => t.address.toLowerCase())),
    [visibleRecents],
  );

  const visiblePopular = useMemo(() => {
    const seen = new Set<string>();
    const out: BridgeToken[] = [];
    for (const sym of POPULAR_SYMBOLS) {
      const match = tokens.find(
        (t) =>
          t.symbol.toUpperCase() === sym &&
          !holdingMints.has(t.address.toLowerCase()) &&
          !recentMints.has(t.address.toLowerCase()) &&
          !seen.has(t.address.toLowerCase()),
      );
      if (match) {
        seen.add(match.address.toLowerCase());
        out.push(match);
      }
    }
    return out;
  }, [tokens, holdingMints, recentMints]);

  // Search uses the same scoring as before but only kicks in when typing.
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const scored = tokens
      .map((t) => {
        const sym = t.symbol.toLowerCase();
        const name = t.name.toLowerCase();
        let score = 0;
        if (t.address.toLowerCase() === term) score = 100;
        else if (sym === term) score = 90;
        else if (sym.startsWith(term)) score = 70;
        else if (name === term) score = 60;
        else if (name.startsWith(term)) score = 50;
        else if (sym.includes(term)) score = 30;
        else if (name.includes(term)) score = 10;
        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.t);
  }, [q, tokens]);

  const handlePick = (t: BridgeToken) => {
    pushBridgeRecent(t);
    onPick(t);
  };

  const showSearch = q.trim().length > 0;
  const fmtAmount = (n: number) => {
    if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
    return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  };

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
          ) : showSearch ? (
            filtered.length === 0 ? (
              <div className="py-8 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                No tokens found
              </div>
            ) : (
              filtered.map((t) => (
                <BridgeTokenRow key={`s-${t.chainId}-${t.address}`} token={t} onPick={handlePick} />
              ))
            )
          ) : (
            <>
              {((isSolanaChain && walletAddress) || (isEvmChain && evmAddressForChain)) && (
                <div className="px-1 py-1">
                  <BridgeSectionLabel>Your wallet</BridgeSectionLabel>
                  {holdingsLoading && visibleHoldings.length === 0 ? (
                    <div className="flex items-center justify-center py-3 text-muted-foreground/60">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </div>
                  ) : visibleHoldings.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground/60">
                      No tokens worth $1+ in this wallet.
                    </p>
                  ) : (
                    visibleHoldings.map((t) => (
                      <BridgeTokenRow
                        key={`h-${t.chainId}-${t.address}`}
                        token={t}
                        onPick={handlePick}
                        amount={t.amount}
                        valueUsd={t.valueUsd}
                        fmtAmount={fmtAmount}
                      />
                    ))
                  )}
                </div>
              )}
              {visibleRecents.length > 0 && (
                <div className="px-1 py-1">
                  <BridgeSectionLabel>Recent</BridgeSectionLabel>
                  {visibleRecents.map((t) => (
                    <BridgeTokenRow key={`r-${t.chainId}-${t.address}`} token={t} onPick={handlePick} />
                  ))}
                </div>
              )}
              {visiblePopular.length > 0 && (
                <div className="px-1 py-1">
                  <BridgeSectionLabel>Popular</BridgeSectionLabel>
                  {visiblePopular.map((t) => (
                    <BridgeTokenRow key={`p-${t.chainId}-${t.address}`} token={t} onPick={handlePick} />
                  ))}
                </div>
              )}
              {/* Fallback for chains with no popular matches and no wallet/recents
                  yet — show a slice of the full list so the picker is never empty. */}
              {!isSolanaChain && visibleRecents.length === 0 && visiblePopular.length === 0 &&
                tokens.slice(0, 50).map((t) => (
                  <BridgeTokenRow key={`a-${t.chainId}-${t.address}`} token={t} onPick={handlePick} />
                ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const BridgeSectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="px-2 pb-1 pt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
    {children}
  </div>
);

const BridgeTokenRow = ({
  token,
  onPick,
  amount,
  valueUsd,
  fmtAmount,
}: {
  token: BridgeToken;
  onPick: (t: BridgeToken) => void;
  amount?: number;
  valueUsd?: number | null;
  fmtAmount?: (n: number) => string;
}) => {
  const showHolding = typeof amount === "number" && amount > 0 && !!fmtAmount;
  return (
    <button
      type="button"
      onClick={() => onPick(token)}
      className="ease-vision flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary"
    >
      <TokenLogo symbol={token.symbol} logo={token.logo} size={28} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">{token.symbol}</span>
          <span className="truncate font-mono text-[10px] text-muted-foreground">{token.name}</span>
        </div>
        <div className="font-mono text-[9px] text-muted-foreground/70">
          {token.address.slice(0, 6)}…{token.address.slice(-4)}
        </div>
      </div>
      <div className="flex flex-col items-end">
        {showHolding ? (
          <>
            <span className="font-mono text-[11px] text-foreground">{fmtAmount!(amount!)}</span>
            {valueUsd != null && (
              <span className="font-mono text-[10px] text-muted-foreground">{fmtUsd(valueUsd)}</span>
            )}
          </>
        ) : (
          token.priceUsd != null && (
            <span className="font-mono text-[10px] text-muted-foreground">{fmtUsd(token.priceUsd)}</span>
          )
        )}
      </div>
    </button>
  );
};
