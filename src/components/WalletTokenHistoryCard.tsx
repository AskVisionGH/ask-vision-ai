import { ArrowDownLeft, ExternalLink, History } from "lucide-react";

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

interface AcquisitionEvent {
  signature: string;
  timestamp: number;
  tokenAmount: number;
  valueUsd: number | null;
  pairSymbol: string | null;
  /** Present on transfers — the wallet that sent us the tokens. */
  counterparty?: string | null;
  /** "swap" (real DEX buy) vs "transfer" (plain SPL transfer in). */
  kind?: "swap" | "transfer";
}

const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export const WalletTokenHistoryCard = ({ data }: Props) => {
  if (!data || data.error) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-xs text-muted-foreground">
        {data?.error ?? "No history available."}
      </div>
    );
  }

  const symbol: string = (data.tokenSymbol && String(data.tokenSymbol)) || "tokens";

  // Prefer the explicit firstAcquisition (handles transfer-in tokens).
  // Fall back to firstBuy for backwards compatibility with cached responses.
  const firstAcquisition = (data.firstAcquisition ?? data.firstBuy) as
    | AcquisitionEvent
    | null;
  const isTransfer = firstAcquisition?.kind === "transfer";
  const firstDate = firstAcquisition
    ? new Date(firstAcquisition.timestamp * 1000).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  const netAmount = Number(data.netAmount ?? 0);
  const netFormatted = netAmount.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const transfersIn = Number(data.transfersIn ?? 0);
  const transfersOut = Number(data.transfersOut ?? 0);
  const showTransferStats = transfersIn > 0 || transfersOut > 0;

  // Realized USD = (proceeds from sells) − (cost of buys), summed across
  // events that had a stable / SOL pair we could price. Negative means the
  // wallet is still net long in dollar terms; positive means they've taken
  // money off the table.
  const realizedUsd = Number(data.realizedUsd ?? 0);
  const showRealized = Math.abs(realizedUsd) > 0.01;
  const realizedFormatted = formatUsd(realizedUsd);
  const realizedTone =
    realizedUsd > 0 ? "text-emerald-400" : realizedUsd < 0 ? "text-rose-400" : "text-foreground";

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
        {firstAcquisition ? (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {isTransfer ? (
                <>
                  <ArrowDownLeft className="h-3 w-3" />
                  First acquisition (transfer in)
                </>
              ) : (
                "First buy"
              )}
            </p>
            <p className="text-sm text-foreground">
              {firstDate}
              {isTransfer && firstAcquisition.counterparty ? (
                <span className="text-muted-foreground">
                  {" "}• received from{" "}
                  <code className="rounded bg-secondary/60 px-1 py-0.5 font-mono text-[11px]">
                    {shortAddr(firstAcquisition.counterparty)}
                  </code>
                </span>
              ) : firstAcquisition.pairSymbol ? (
                <span className="text-muted-foreground"> • paid in {firstAcquisition.pairSymbol}</span>
              ) : null}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              +{firstAcquisition.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
              {firstAcquisition.valueUsd
                ? ` • ~$${firstAcquisition.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : ""}
            </p>
            <a
              href={`https://solscan.io/tx/${firstAcquisition.signature}`}
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
            No acquisition of {symbol === "tokens" ? "this token" : `$${symbol}`} found in the last{" "}
            {data.signaturesScannedTotal?.toLocaleString() ?? 0} signatures.
            {!data.fullyScanned && " The wallet may have acquired it earlier — ask to dig deeper."}
          </p>
        )}
      </div>

      <div
        className={`grid gap-px border-t border-border/60 bg-border/40 text-center ${
          [showTransferStats, showRealized].filter(Boolean).length === 2
            ? "grid-cols-5"
            : showTransferStats || showRealized
              ? "grid-cols-4"
              : "grid-cols-3"
        }`}
      >
        <Stat label="Buys" value={data.totalBuys ?? 0} />
        <Stat label="Sells" value={data.totalSells ?? 0} />
        {showTransferStats && (
          <Stat label="Transfers" value={`${transfersIn}↓ / ${transfersOut}↑`} />
        )}
        {showRealized && (
          <Stat
            label="Realized $"
            value={realizedFormatted}
            valueClassName={realizedTone}
          />
        )}
        <Stat label={`Net (${symbol})`} value={netFormatted} />
      </div>

      {data.stoppedReason === "cap" && !data.fullyScanned && (
        <div className="border-t border-border/60 bg-secondary/40 px-4 py-2 text-[10px] text-muted-foreground">
          Stopped at scan cap. Ask "keep digging" to scan further back.
        </div>
      )}
    </div>
  );
};

const Stat = ({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: number | string;
  valueClassName?: string;
}) => (
  <div className="bg-card/40 px-3 py-2">
    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={`font-mono text-xs ${valueClassName ?? "text-foreground"}`}>{value}</div>
  </div>
);

function formatUsd(n: number): string {
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
