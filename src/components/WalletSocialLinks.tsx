import { ExternalLink, Twitter } from "lucide-react";
import { cn } from "@/lib/utils";

interface WalletSocialLinksProps {
  address: string;
  twitterHandle?: string | null;
  /** Hide the Solscan icon (use when address is already a separate clickable link). */
  hideSolscan?: boolean;
  className?: string;
}

/**
 * Compact row of icon links surfaced for a tracked wallet. We only render
 * identity links that actually exist (X) plus on-chain trader profiles
 * derived from the address (GMGN + Cielo). Solscan is rendered last as a
 * generic "open on explorer" fallback.
 */
export const WalletSocialLinks = ({
  address,
  twitterHandle,
  hideSolscan,
  className,
}: WalletSocialLinksProps) => {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {twitterHandle && (
        <a
          href={`https://x.com/${twitterHandle}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-primary ease-vision"
          aria-label={`@${twitterHandle} on X`}
          title={`@${twitterHandle} on X`}
        >
          <Twitter className="h-3 w-3" />
        </a>
      )}
      <a
        href={`https://gmgn.ai/sol/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-primary ease-vision"
        aria-label="Trader profile on GMGN"
        title="Trader profile on GMGN"
      >
        <GmgnIcon className="h-3 w-3" />
      </a>
      <a
        href={`https://app.cielo.finance/profile/${address}/pnl/tokens`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-primary ease-vision"
        aria-label="PnL profile on Cielo"
        title="PnL profile on Cielo"
      >
        <CieloIcon className="h-3 w-3" />
      </a>
      {!hideSolscan && (
        <a
          href={`https://solscan.io/account/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-primary ease-vision"
          aria-label="Open account on Solscan"
          title="Open account on Solscan"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
};

const GmgnIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {/* Stylized "G" */}
    <path d="M19 8.5a8 8 0 1 0 0 7" />
    <path d="M19 12h-5" />
  </svg>
);

const CieloIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {/* Candle / PnL bar mark */}
    <path d="M6 4v16" />
    <rect x="4" y="8" width="4" height="8" rx="1" />
    <path d="M16 4v16" />
    <rect x="14" y="6" width="4" height="6" rx="1" />
  </svg>
);
