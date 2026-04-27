import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ExternalLink, Loader2, RefreshCw, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TokenLogo } from "@/components/TokenLogo";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { useVisionWalletSigner } from "@/hooks/useVisionWalletSigner";
import { SUPPORTED_EVM_CHAINS } from "@/lib/evm-chains";
import { txExplorerUrl, explorerLabel } from "@/lib/explorer";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * WalletWithdrawPanel — sends SOL/SPL or ETH/ERC-20 out of the user's
 * Vision Wallet.
 *
 * Flow:
 *   1. User picks a chain tab (Solana / EVM).
 *   2. We load their balances via the same edge functions the Balances
 *      panel uses, so the asset picker is the wallet's own holdings.
 *   3. User picks asset, enters recipient + amount.
 *   4. We call `wallet-withdraw-build` to build an unsigned tx server-side.
 *   5. We hand that tx to `useVisionWalletSigner` (Privy) to sign & broadcast.
 *   6. On success, we best-effort log a `tx_events` row via `tx-submit` so
 *      the Activity feed picks it up.
 */

const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const isSolMint = (m: string) => m === "SOL" || m === WSOL_MINT;

interface SolHolding {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  amount: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
}

interface EvmHolding {
  address: string; // "native" or 0x..
  symbol: string;
  name: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
  amount: number;
  valueUsd: number | null;
}

const isBase58 = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const isEvmAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

const fmtAmount = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  if (Math.abs(n) < 1) return n.toFixed(6);
  if (Math.abs(n) < 1000) return n.toFixed(4);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

export function WalletWithdrawPanel() {
  const { solanaAddress, evmAddress } = useVisionWallet();

  return (
    <Tabs defaultValue="solana" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="solana" disabled={!solanaAddress}>Solana</TabsTrigger>
        <TabsTrigger value="evm" disabled={!evmAddress}>Ethereum &amp; EVM</TabsTrigger>
      </TabsList>

      <TabsContent value="solana" className="pt-4">
        {solanaAddress && <SolanaWithdrawForm fromAddress={solanaAddress} />}
      </TabsContent>

      <TabsContent value="evm" className="pt-4">
        {evmAddress && <EvmWithdrawForm fromAddress={evmAddress} />}
      </TabsContent>
    </Tabs>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Solana
// ─────────────────────────────────────────────────────────────────────────────

function SolanaWithdrawForm({ fromAddress }: { fromAddress: string }) {
  const signer = useVisionWalletSigner();
  const [holdings, setHoldings] = useState<SolHolding[] | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [selectedMint, setSelectedMint] = useState<string>("SOL");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resultSig, setResultSig] = useState<string | null>(null);

  const loadBalances = async () => {
    setLoadingBalances(true);
    try {
      const { data, error } = await supabase.functions.invoke("wallet-balance", {
        body: { address: fromAddress },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setHoldings(data.holdings ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load balances");
    } finally {
      setLoadingBalances(false);
    }
  };

  useEffect(() => {
    void loadBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAddress]);

  const selected = useMemo(() => {
    if (!holdings) return null;
    if (selectedMint === "SOL") {
      return holdings.find((h) => isSolMint(h.mint) || h.symbol === "SOL") ?? null;
    }
    return holdings.find((h) => h.mint === selectedMint) ?? null;
  }, [holdings, selectedMint]);

  const recipientValid = recipient.length === 0 || isBase58(recipient);
  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const overBalance = selected != null && amountValid && amountNum > selected.amount;

  const canSubmit =
    !submitting &&
    !!selected &&
    isBase58(recipient) &&
    recipient !== fromAddress &&
    amountValid &&
    !overBalance;

  const handleMax = () => {
    if (!selected) return;
    // Reserve a tiny buffer for SOL gas + ATA creation.
    if (selectedMint === "SOL") {
      const buffer = 0.003;
      const max = Math.max(0, selected.amount - buffer);
      setAmount(max > 0 ? String(max) : "0");
    } else {
      setAmount(String(selected.amount));
    }
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setResultSig(null);
    try {
      const { data: build, error: buildErr } = await supabase.functions.invoke(
        "wallet-withdraw-build",
        {
          body: {
            chain: "solana",
            to: recipient,
            mint: selectedMint === "SOL" ? "SOL" : selected.mint,
            amountUi: amountNum,
            decimals: selectedMint === "SOL" ? 9 : selected.decimals,
          },
        },
      );
      if (buildErr) throw new Error(buildErr.message);
      if (build?.error) throw new Error(build.error);

      const res = await signer.signAndSend({
        chain: "solana",
        caip2: SOLANA_CAIP2,
        transaction: build.transaction,
        method: "signAndSendTransaction",
      });
      const sig = res.hash ?? res.signature ?? null;
      if (!sig) throw new Error("No signature returned");

      // Best-effort tx_events log — Activity feed reads from tx_events.
      supabase.functions
        .invoke("tx-submit", {
          body: {
            signature: sig,
            kind: "transfer",
            inputMint: selectedMint === "SOL" ? "SOL" : selected.mint,
            inputAmount: amountNum,
            recipient,
            walletAddress: fromAddress,
            valueUsd:
              selected.priceUsd != null ? selected.priceUsd * amountNum : null,
            metadata: {
              source: "vision_wallet_withdraw",
              chain: "solana",
              symbol: selected.symbol,
            },
          },
        })
        .catch(() => {});

      setResultSig(sig);
      toast.success("Withdrawal sent");
      setAmount("");
      void loadBalances();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Withdrawal failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (resultSig) {
    return <SuccessCard signature={resultSig} chainId={null} onReset={() => setResultSig(null)} />;
  }

  return (
    <div className="space-y-4">
      <FromHeader address={fromAddress} chainLabel="Solana" onRefresh={loadBalances} loading={loadingBalances} />

      <div className="space-y-2">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Asset</Label>
        <AssetPicker
          holdings={(holdings ?? []).map((h) => ({
            id: isSolMint(h.mint) ? "SOL" : h.mint,
            symbol: h.symbol,
            name: h.name,
            logo: h.logo,
            amount: h.amount,
          }))}
          loading={loadingBalances && !holdings}
          selectedId={selectedMint}
          onSelect={setSelectedMint}
        />
      </div>

      <RecipientField
        value={recipient}
        onChange={setRecipient}
        valid={recipientValid}
        placeholder="Solana address (Base58)"
        invalidMessage="Not a valid Solana address."
      />

      <AmountField
        value={amount}
        onChange={setAmount}
        symbol={selected?.symbol ?? ""}
        balance={selected?.amount ?? 0}
        onMax={handleMax}
        overBalance={overBalance}
      />

      <Button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {submitting ? "Sending…" : "Review & send"}
      </Button>
      <p className="text-center text-[10px] text-muted-foreground">
        Network fee ~0.000005 SOL. SPL transfers may add ~0.002 SOL if the recipient hasn't held this token before.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EVM
// ─────────────────────────────────────────────────────────────────────────────

function EvmWithdrawForm({ fromAddress }: { fromAddress: string }) {
  const signer = useVisionWalletSigner();
  const [chainId, setChainId] = useState<number>(SUPPORTED_EVM_CHAINS[0].id);
  const [holdings, setHoldings] = useState<EvmHolding[] | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [selectedToken, setSelectedToken] = useState<string>("native");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resultHash, setResultHash] = useState<string | null>(null);

  const chain = SUPPORTED_EVM_CHAINS.find((c) => c.id === chainId)!;

  const loadBalances = async () => {
    setLoadingBalances(true);
    try {
      const { data, error } = await supabase.functions.invoke("evm-wallet-balance", {
        body: { address: fromAddress, chainId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setHoldings(data.holdings ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load balances");
    } finally {
      setLoadingBalances(false);
    }
  };

  useEffect(() => {
    setSelectedToken("native");
    setAmount("");
    void loadBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAddress, chainId]);

  const selected = useMemo(() => {
    if (!holdings) return null;
    if (selectedToken === "native") {
      return (
        holdings.find(
          (h) => h.address === "native" || h.symbol === chain.nativeCurrency.symbol,
        ) ?? null
      );
    }
    return holdings.find((h) => h.address.toLowerCase() === selectedToken.toLowerCase()) ?? null;
  }, [holdings, selectedToken, chain]);

  const recipientValid = recipient.length === 0 || isEvmAddr(recipient);
  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const overBalance = selected != null && amountValid && amountNum > selected.amount;

  const canSubmit =
    !submitting &&
    !!selected &&
    isEvmAddr(recipient) &&
    recipient.toLowerCase() !== fromAddress.toLowerCase() &&
    amountValid &&
    !overBalance;

  const handleMax = () => {
    if (!selected) return;
    if (selectedToken === "native") {
      // Reserve gas — rough but safe for native sends on cheap chains;
      // mainnet users will eat into this with a buffer too.
      const buffer = chainId === 1 ? 0.005 : 0.001;
      const max = Math.max(0, selected.amount - buffer);
      setAmount(max > 0 ? String(max) : "0");
    } else {
      setAmount(String(selected.amount));
    }
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setResultHash(null);
    try {
      const tokenArg = selectedToken === "native" ? "native" : selected.address;
      const { data: build, error: buildErr } = await supabase.functions.invoke(
        "wallet-withdraw-build",
        {
          body: {
            chain: "evm",
            chainId,
            to: recipient,
            token: tokenArg,
            amountUi: amountNum,
            decimals: selected.decimals,
          },
        },
      );
      if (buildErr) throw new Error(buildErr.message);
      if (build?.error) throw new Error(build.error);

      const res = await signer.signAndSend({
        chain: "evm",
        caip2: `eip155:${chainId}`,
        tx: build.tx,
        method: "eth_sendTransaction",
      });
      const hash = res.hash ?? res.signature ?? null;
      if (!hash) throw new Error("No transaction hash returned");

      supabase.functions
        .invoke("tx-submit", {
          body: {
            signature: hash,
            kind: "transfer",
            inputMint: tokenArg === "native" ? chain.nativeCurrency.symbol : selected.address,
            inputAmount: amountNum,
            recipient,
            walletAddress: fromAddress,
            valueUsd:
              selected.priceUsd != null ? selected.priceUsd * amountNum : null,
            metadata: {
              source: "vision_wallet_withdraw",
              chain: "evm",
              chainId,
              symbol: selected.symbol,
            },
          },
        })
        .catch(() => {});

      setResultHash(hash);
      toast.success("Withdrawal sent");
      setAmount("");
      void loadBalances();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Withdrawal failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (resultHash) {
    return <SuccessCard signature={resultHash} chainId={chainId} onReset={() => setResultHash(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="-mx-1 flex flex-wrap gap-1.5">
        {SUPPORTED_EVM_CHAINS.map((c) => (
          <button
            key={c.id}
            onClick={() => setChainId(c.id)}
            className={cn(
              "ease-vision rounded-full border px-3 py-1 text-[11px]",
              c.id === chainId
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      <FromHeader address={fromAddress} chainLabel={chain.name} onRefresh={loadBalances} loading={loadingBalances} />

      <div className="space-y-2">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Asset</Label>
        <AssetPicker
          holdings={(holdings ?? []).map((h) => ({
            id: h.address === "native" || h.symbol === chain.nativeCurrency.symbol ? "native" : h.address,
            symbol: h.symbol,
            name: h.name,
            logo: h.logo,
            amount: h.amount,
          }))}
          loading={loadingBalances && !holdings}
          selectedId={selectedToken}
          onSelect={setSelectedToken}
        />
      </div>

      <RecipientField
        value={recipient}
        onChange={setRecipient}
        valid={recipientValid}
        placeholder="0x… recipient address"
        invalidMessage="Not a valid EVM address."
      />

      <AmountField
        value={amount}
        onChange={setAmount}
        symbol={selected?.symbol ?? ""}
        balance={selected?.amount ?? 0}
        onMax={handleMax}
        overBalance={overBalance}
      />

      <Button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {submitting ? "Sending…" : "Review & send"}
      </Button>
      <p className="text-center text-[10px] text-muted-foreground">
        Gas paid in {chain.nativeCurrency.symbol}. Make sure you have enough to cover network fees.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

function FromHeader({
  address,
  chainLabel,
  onRefresh,
  loading,
}: {
  address: string;
  chainLabel: string;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">From · {chainLabel}</p>
          <p className="truncate font-mono text-xs text-foreground">{address}</p>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} className="text-muted-foreground">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

interface PickerHolding {
  id: string;
  symbol: string;
  name: string;
  logo: string | null;
  amount: number;
}

function AssetPicker({
  holdings,
  loading,
  selectedId,
  onSelect,
}: {
  holdings: PickerHolding[];
  loading: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card/40 px-3 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading balances…
      </div>
    );
  }
  if (holdings.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-card/30 px-3 py-4 text-center text-xs text-muted-foreground">
        Nothing to send on this chain.
      </p>
    );
  }
  return (
    <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border bg-card/40 p-1">
      {holdings.map((h) => {
        const active = h.id === selectedId;
        return (
          <button
            key={h.id}
            onClick={() => onSelect(h.id)}
            className={cn(
              "ease-vision flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left",
              active ? "bg-primary/10" : "hover:bg-secondary/50",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <TokenLogo logo={h.logo} symbol={h.symbol} size={24} />
              <div className="min-w-0">
                <p className="truncate text-xs text-foreground">{h.symbol}</p>
                <p className="truncate text-[10px] text-muted-foreground">{h.name}</p>
              </div>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">{fmtAmount(h.amount)}</p>
          </button>
        );
      })}
    </div>
  );
}

function RecipientField({
  value,
  onChange,
  valid,
  placeholder,
  invalidMessage,
}: {
  value: string;
  onChange: (v: string) => void;
  valid: boolean;
  placeholder: string;
  invalidMessage: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Recipient</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder={placeholder}
        className="font-mono text-xs"
        spellCheck={false}
        autoComplete="off"
      />
      {!valid && value.length > 0 && (
        <p className="text-[10px] text-destructive">{invalidMessage}</p>
      )}
    </div>
  );
}

function AmountField({
  value,
  onChange,
  symbol,
  balance,
  onMax,
  overBalance,
}: {
  value: string;
  onChange: (v: string) => void;
  symbol: string;
  balance: number;
  onMax: () => void;
  overBalance: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount</Label>
        <button
          type="button"
          onClick={onMax}
          className="text-[10px] text-muted-foreground hover:text-foreground ease-vision"
        >
          Balance: {fmtAmount(balance)} {symbol} · <span className="text-primary">Max</span>
        </button>
      </div>
      <div className="relative">
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, "");
            onChange(v);
          }}
          placeholder="0.0"
          className="font-mono text-base pr-16"
        />
        {symbol && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {symbol}
          </span>
        )}
      </div>
      {overBalance && (
        <p className="text-[10px] text-destructive">Amount exceeds your balance.</p>
      )}
    </div>
  );
}

function SuccessCard({
  signature,
  chainId,
  onReset,
}: {
  signature: string;
  chainId: number | null;
  onReset: () => void;
}) {
  const url = txExplorerUrl(signature, chainId);
  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card/40 p-6 text-center backdrop-blur-md">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
        <ArrowRight className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-sm text-foreground">Withdrawal sent</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The transaction is broadcasting now. It'll show in Activity once confirmed.
        </p>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        View on {explorerLabel(chainId)} <ExternalLink className="h-3 w-3" />
      </a>
      <div>
        <Button variant="outline" size="sm" onClick={onReset} className="rounded-full">
          Send another
        </Button>
      </div>
    </div>
  );
}
