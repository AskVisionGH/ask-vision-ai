import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TokenLogo } from "@/components/TokenLogo";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { SUPPORTED_EVM_CHAINS } from "@/lib/evm-chains";
import { cn } from "@/lib/utils";

/**
 * WalletBalancesPanel — shows holdings for the user's Vision Wallet.
 *
 * Solana tab uses `wallet-balance` (Helius DAS, returns SOL + all SPL fungibles
 * with prices). EVM tab is per-chain via `evm-wallet-balance`; we default to
 * Ethereum and let users switch chain via a chip row.
 */

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
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
  amount: number;
  valueUsd: number | null;
}

const fmtAmount = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  if (Math.abs(n) < 1) return n.toFixed(6);
  if (Math.abs(n) < 1000) return n.toFixed(4);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n < 1 ? 4 : 2,
  });
};

export function WalletBalancesPanel() {
  const { solanaAddress, evmAddress, loading: walletLoading } = useVisionWallet();
  const [solHoldings, setSolHoldings] = useState<SolHolding[] | null>(null);
  const [solTotal, setSolTotal] = useState<number | null>(null);
  const [solLoading, setSolLoading] = useState(false);
  const [solError, setSolError] = useState<string | null>(null);

  const [evmChainId, setEvmChainId] = useState<number>(SUPPORTED_EVM_CHAINS[0].id);
  const [evmHoldings, setEvmHoldings] = useState<EvmHolding[] | null>(null);
  const [evmLoading, setEvmLoading] = useState(false);
  const [evmError, setEvmError] = useState<string | null>(null);

  const evmTotal = useMemo(
    () => (evmHoldings ?? []).reduce((s, h) => s + (h.valueUsd ?? 0), 0),
    [evmHoldings],
  );

  const loadSol = async () => {
    if (!solanaAddress) return;
    setSolLoading(true);
    setSolError(null);
    try {
      const { data, error } = await supabase.functions.invoke("wallet-balance", {
        body: { address: solanaAddress },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setSolHoldings(data.holdings ?? []);
      setSolTotal(data.totalUsd ?? 0);
    } catch (e) {
      setSolError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setSolLoading(false);
    }
  };

  const loadEvm = async () => {
    if (!evmAddress) return;
    setEvmLoading(true);
    setEvmError(null);
    try {
      const { data, error } = await supabase.functions.invoke("evm-wallet-balance", {
        body: { address: evmAddress, chainId: evmChainId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setEvmHoldings(data.holdings ?? []);
    } catch (e) {
      setEvmError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setEvmLoading(false);
    }
  };

  useEffect(() => {
    void loadSol();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solanaAddress]);

  useEffect(() => {
    void loadEvm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evmAddress, evmChainId]);

  if (walletLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading wallet…
      </div>
    );
  }

  return (
    <Tabs defaultValue="solana" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="solana" disabled={!solanaAddress}>Solana</TabsTrigger>
        <TabsTrigger value="evm" disabled={!evmAddress}>Ethereum &amp; EVM</TabsTrigger>
      </TabsList>

      <TabsContent value="solana" className="space-y-4 pt-4">
        <BalanceHeader
          label="Total"
          totalUsd={solTotal}
          loading={solLoading}
          onRefresh={loadSol}
        />
        {solError && (
          <p className="text-xs text-destructive">{solError}</p>
        )}
        <HoldingsList
          holdings={(solHoldings ?? []).map((h) => ({
            id: h.mint,
            symbol: h.symbol,
            name: h.name,
            logo: h.logo,
            amount: h.amount,
            valueUsd: h.valueUsd,
            priceUsd: h.priceUsd,
          }))}
          loading={solLoading && !solHoldings}
          empty="No tokens yet — fund your wallet from the Deposit tab."
        />
      </TabsContent>

      <TabsContent value="evm" className="space-y-4 pt-4">
        <div className="-mx-1 flex flex-wrap gap-1.5">
          {SUPPORTED_EVM_CHAINS.map((chain) => (
            <button
              key={chain.id}
              onClick={() => setEvmChainId(chain.id)}
              className={cn(
                "ease-vision rounded-full border px-3 py-1 text-[11px]",
                chain.id === evmChainId
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {chain.name}
            </button>
          ))}
        </div>

        <BalanceHeader
          label={`${SUPPORTED_EVM_CHAINS.find((c) => c.id === evmChainId)?.name ?? ""} total`}
          totalUsd={evmTotal}
          loading={evmLoading}
          onRefresh={loadEvm}
        />
        {evmError && (
          <p className="text-xs text-destructive">{evmError}</p>
        )}
        <HoldingsList
          holdings={(evmHoldings ?? []).map((h) => ({
            id: h.address,
            symbol: h.symbol,
            name: h.name,
            logo: h.logo,
            amount: h.amount,
            valueUsd: h.valueUsd,
            priceUsd: h.priceUsd,
          }))}
          loading={evmLoading && !evmHoldings}
          empty="No tokens on this chain. Try another chain or fund your wallet."
        />
      </TabsContent>
    </Tabs>
  );
}

function BalanceHeader({
  label,
  totalUsd,
  loading,
  onRefresh,
}: {
  label: string;
  totalUsd: number | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-end justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-2xl text-foreground">{fmtUsd(totalUsd)}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} className="text-muted-foreground">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

interface UnifiedHolding {
  id: string;
  symbol: string;
  name: string;
  logo: string | null;
  amount: number;
  valueUsd: number | null;
  priceUsd: number | null;
}

function HoldingsList({
  holdings,
  loading,
  empty,
}: {
  holdings: UnifiedHolding[];
  loading: boolean;
  empty: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading balances…
      </div>
    );
  }
  if (holdings.length === 0) {
    return <p className="px-4 py-8 text-center text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/40">
      {holdings.map((h) => (
        <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <TokenLogo logo={h.logo} symbol={h.symbol} size={28} />
            <div className="min-w-0">
              <p className="truncate text-xs text-foreground">{h.symbol}</p>
              <p className="truncate text-[10px] text-muted-foreground">{h.name}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-xs text-foreground">{fmtAmount(h.amount)}</p>
            <p className="font-mono text-[10px] text-muted-foreground">{fmtUsd(h.valueUsd)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
