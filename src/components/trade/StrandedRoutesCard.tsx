// StrandedRoutesCard — surfaces in-flight bridge_then_swap routes whose
// destination swap leg never completed.
//
// Why this lives next to TradeSwap
// --------------------------------
// When a user bridges Solana → Base USDC → some target token and the second
// leg fails (slippage, gas, page reload, transient route 404…), they're left
// holding USDC on Base with no obvious way to finish the swap. The executor
// records a recovery breadcrumb in localStorage at exactly the moment the
// bridge funds land (`pollBridgeUntilDone` returned). On the next /trade
// mount we replay that breadcrumb here:
//
//   1) Confirm there's actually an intermediate-token balance on the
//      destination chain (the user might've already swapped manually, in
//      which case we silently dismiss the record).
//   2) Show a single card per stranded route with the rescued amount, why
//      we're showing it ("interrupted" vs explicit "post-bridge failure"),
//      a deep link to the original bridge tx, and a "Resume swap" CTA.
//   3) Resume hands off to `useRouteExecutor.resume()` which re-quotes the
//      destination-chain swap against the *real* on-chain amount and runs
//      a single swap leg — the existing RouteProgressModal handles all the
//      sign/confirm UX, so the user gets the same flow they're used to.
//
// We deliberately don't auto-trigger anything. Funds are safe; the user
// should opt in.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  clearStrandedRoute,
  listStrandedRoutes,
  type StrandedRoute,
} from "@/lib/stranded-routes";
import type { ChainKey } from "@/components/trade/MultichainTokenPickerDialog";

const isSol = (c: ChainKey) => String(c).toUpperCase() === "SOL";
const truncSig = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const fmtAmount = (n: number) => {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.000001) return n.toExponential(3);
  if (Math.abs(n) < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (Math.abs(n) < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

interface BalanceState {
  loading: boolean;
  ui: number | null;
  error: string | null;
}

export interface StrandedRoutesCardProps {
  userId: string | null | undefined;
  /** Bumped when caller wants us to re-read the registry (e.g. after a
   *  successful resume clears a record). */
  refreshKey?: number;
  /** Caller invokes the executor — we don't take a dependency on it directly
   *  to keep this component decoupled from React Query / wallet hooks. */
  onResume: (route: StrandedRoute, availableUi: number) => void;
  /** Whether the executor is currently mid-flight; we lock buttons to avoid
   *  letting the user fire two resumes back-to-back. */
  busy?: boolean;
}

export const StrandedRoutesCard = ({
  userId,
  refreshKey = 0,
  onResume,
  busy = false,
}: StrandedRoutesCardProps) => {
  const { connection } = useConnection();
  const [routes, setRoutes] = useState<StrandedRoute[]>([]);
  const [balances, setBalances] = useState<Record<string, BalanceState>>({});

  // Refresh registry on mount + when caller bumps refreshKey.
  useEffect(() => {
    setRoutes(listStrandedRoutes(userId));
  }, [userId, refreshKey]);

  // Fetch on-chain intermediate balance for each route. Source of truth — if
  // the user already moved the funds we'll see 0 and silently hide the row.
  const fetchBalance = useCallback(
    async (route: StrandedRoute) => {
      setBalances((prev) => ({
        ...prev,
        [route.id]: { loading: true, ui: prev[route.id]?.ui ?? null, error: null },
      }));
      try {
        let ui = 0;
        if (isSol(route.toChain)) {
          const owner = new PublicKey(route.recipientAddress);
          const mint = new PublicKey(route.intermediateAddress);
          const resp = await connection.getParsedTokenAccountsByOwner(owner, { mint });
          for (const acc of resp.value) {
            const v = acc.account.data.parsed?.info?.tokenAmount?.uiAmount;
            if (typeof v === "number") ui += v;
          }
        } else {
          const { data, error } = await supabase.functions.invoke("evm-wallet-balance", {
            body: { address: route.recipientAddress, chainId: Number(route.toChain) },
          });
          if (error || !data || data.error) throw new Error(error?.message ?? data?.error ?? "balance fetch failed");
          const holdings = Array.isArray(data.holdings) ? data.holdings : [];
          const target = route.intermediateAddress.toLowerCase();
          const match = holdings.find((h: any) => String(h.address ?? h.mint ?? "").toLowerCase() === target);
          ui = typeof match?.amount === "number" ? match.amount : 0;
        }
        setBalances((prev) => ({ ...prev, [route.id]: { loading: false, ui, error: null } }));
      } catch (e: any) {
        setBalances((prev) => ({
          ...prev,
          [route.id]: { loading: false, ui: null, error: e?.message ?? "Couldn't read balance" },
        }));
      }
    },
    [connection],
  );

  // Initial balance fetch per route + whenever the route set changes.
  useEffect(() => {
    routes.forEach((r) => {
      if (!balances[r.id]) void fetchBalance(r);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  // Hide rows whose balance came back as exactly 0 (already swapped manually
  // or funds moved). We auto-clear these so the registry stays clean.
  const visible = useMemo(
    () =>
      routes.filter((r) => {
        const b = balances[r.id];
        // Show while loading, while erroring (so the user can retry), or
        // when there's a positive balance.
        if (!b) return true;
        if (b.loading) return true;
        if (b.error) return true;
        return (b.ui ?? 0) > 0;
      }),
    [routes, balances],
  );

  // Auto-clear records that read back as exactly zero balance.
  useEffect(() => {
    routes.forEach((r) => {
      const b = balances[r.id];
      if (b && !b.loading && !b.error && (b.ui ?? 0) === 0) {
        clearStrandedRoute(r.id);
      }
    });
    // We deliberately don't update local `routes` state here — the next
    // refreshKey bump (after a resume completes, on remount, etc.) will
    // re-read; in the meantime they're already filtered out by `visible`.
  }, [routes, balances]);

  const handleDismiss = (route: StrandedRoute) => {
    clearStrandedRoute(route.id);
    setRoutes((prev) => prev.filter((r) => r.id !== route.id));
  };

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((route) => {
        const bal = balances[route.id];
        const available = bal?.ui ?? 0;
        const canResume = !busy && !bal?.loading && !bal?.error && available > 0;
        const headline =
          route.reason === "post_bridge_failure"
            ? "Bridge landed, but the swap didn't finish"
            : "Pending swap on destination chain";
        return (
          <div
            key={route.id}
            className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] backdrop-blur-sm"
          >
            <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-widest text-amber-500/90">
                  Recoverable funds
                </p>
                <p className="mt-1 text-[13px] leading-tight text-foreground">
                  {headline}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDismiss(route)}
                className="ease-vision -mr-1 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-3 space-y-1.5 px-4 pb-3 font-mono text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="text-foreground">
                  {bal?.loading ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Reading {route.intermediateSymbol} balance…
                    </span>
                  ) : bal?.error ? (
                    <span className="inline-flex items-center gap-1.5 text-destructive">
                      Couldn't read balance
                    </span>
                  ) : (
                    <>
                      {fmtAmount(available)} {route.intermediateSymbol}
                    </>
                  )}
                </span>
                <ArrowRight className="h-3 w-3" />
                <span className="text-foreground">{route.toSymbol}</span>
                <span className="text-muted-foreground/70">on chain {String(route.toChain)}</span>
              </div>
              {!bal?.loading && !bal?.error && available > 0 && available < route.expectedIntermediateUi * 0.95 && (
                <p className="text-amber-500/80">
                  Lower than expected (~{fmtAmount(route.expectedIntermediateUi)} {route.intermediateSymbol}). We'll re-quote against the actual amount.
                </p>
              )}
              {bal?.error && (
                <p className="text-destructive/80">{bal.error}</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-amber-500/20 bg-amber-500/[0.03] px-3 py-2">
              <a
                href={route.bridgeExplorer}
                target="_blank"
                rel="noopener noreferrer"
                className="ease-vision inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                Bridge tx · {truncSig(route.bridgeHash)}
                <ExternalLink className="h-3 w-3" />
              </a>
              <div className="flex items-center gap-1.5">
                {bal?.error && (
                  <button
                    type="button"
                    onClick={() => fetchBalance(route)}
                    className="ease-vision inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/40 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </button>
                )}
                <Button
                  size="sm"
                  onClick={() => onResume(route, available)}
                  disabled={!canResume}
                  className={cn(
                    "ease-vision h-8 rounded-md font-mono text-[11px] uppercase tracking-wider",
                    canResume && "bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                >
                  Resume swap
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
