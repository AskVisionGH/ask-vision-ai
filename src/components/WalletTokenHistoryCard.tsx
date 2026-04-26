import { ExternalLink, History } from "lucide-react";

/**
 * Renders the result of a deep historical wallet × token scan.
 *
 * The data shape mirrors the `wallet-token-history` edge function response.
 * We deliberately keep typing loose (`any`) here because this card is reached
 * via the generic `ToolEvent` fallback in `ChatBubble`.
 */
interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export const WalletTokenHistoryCard = ({ data }: Props) => {
  if (!data || data.error) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-xs text-muted-foreground">
        {data?.error ?? "No history available."}
      </div>
    );
  }

  const symbol: string = (data.tokenSymbol && String(data.tokenSymbol)) || "tokens";

  const firstBuy = data.firstBuy as
    | { signature: string; timestamp: number; tokenAmount: number; valueUsd: number | null; pairSymbol: string | null }
    | null;
  const firstBuyDate = firstBuy
    ? new Date(firstBuy.timestamp * 1000).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  const netAmount = Number(data.netAmount ?? 0);
  const netFormatted = netAmount.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Historical scan
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
          {data.signaturesScannedTotal?.toLocaleString() ?? 0} sigs scanned
          {data.fullyScanned ? " • complete" : " • partial"}
        </span>
      </div>

      <div className="px-4 py-3">
        {firstBuy ? (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">First buy</p>
            <p className="text-sm text-foreground">
              {firstBuyDate}
              {firstBuy.pairSymbol ? (
                <span className="text-muted-foreground"> • paid in {firstBuy.pairSymbol}</span>
              ) : null}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              +{firstBuy.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
              {firstBuy.valueUsd
                ? ` • ~$${firstBuy.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : ""}
            </p>
            <a
              href={`https://solscan.io/tx/${firstBuy.signature}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              View on Solscan
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No buy of {symbol === "tokens" ? "this token" : `$${symbol}`} found in the last{" "}
            {data.signaturesScannedTotal?.toLocaleString() ?? 0} signatures.
            {!data.fullyScanned && " The wallet may have acquired it earlier — ask to dig deeper."}
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-px border-t border-border/60 bg-border/40 text-center">
        <Stat label="Buys" value={data.totalBuys ?? 0} />
        <Stat label="Sells" value={data.totalSells ?? 0} />
        <Stat
          label={`Net (${symbol})`}
          value={netFormatted}
        />
      </div>

      {data.stoppedReason === "cap" && !data.fullyScanned && (
        <div className="border-t border-border/60 bg-secondary/40 px-4 py-2 text-[10px] text-muted-foreground">
          Stopped at scan cap. Ask "keep digging" to scan further back.
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: number | string }) => (
  <div className="bg-card/40 px-3 py-2">
    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="font-mono text-xs text-foreground">{value}</div>
  </div>
);
