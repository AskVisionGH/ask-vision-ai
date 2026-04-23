import { TokenLogo } from "@/components/TokenLogo";
import type { WalletBalanceData } from "@/lib/chat-stream";

interface Props {
  data: WalletBalanceData;
}

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n < 0.01) return "<$0.01";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
};

const fmtAmount = (n: number) => {
  if (n === 0) return "0";
  if (n < 0.001) return n.toExponential(2);
  if (n < 1) return n.toFixed(4);
  if (n < 1000) return n.toFixed(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const truncate = (addr: string) =>
  addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;

export const PortfolioCard = ({ data }: Props) => {
  if (data.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Couldn't load wallet: {data.error}
      </div>
    );
  }

  const { totalUsd, holdings, address, tokenCount } = data;

  return (
    <div className="ease-vision animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
              Portfolio
            </p>
            <p className="mt-1 text-2xl font-light tracking-tight text-foreground">
              {fmtUsd(totalUsd)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
              Wallet
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{truncate(address)}</p>
          </div>
        </div>
      </div>

      {/* Holdings */}
      {holdings.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-muted-foreground">
          This wallet is empty. Fund it to get started.
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {holdings.slice(0, 8).map((h) => (
            <li key={h.mint} className="flex items-center gap-3 px-5 py-3">
              <TokenLogo logo={h.logo} symbol={h.symbol} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[13px] font-medium text-foreground">
                    ${h.symbol}
                  </span>
                  <span className="truncate text-xs text-muted-foreground/80">{h.name}</span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {fmtAmount(h.amount)}
                  {h.priceUsd != null && (
                    <span className="ml-2 text-muted-foreground/60">
                      @ {fmtUsd(h.priceUsd)}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[13px] text-foreground">{fmtUsd(h.valueUsd)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {tokenCount > 8 && (
        <div className="border-t border-border/40 bg-secondary/30 px-5 py-2.5 text-center">
          <p className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
            + {tokenCount - 8} smaller positions
          </p>
        </div>
      )}
    </div>
  );
};

const TokenLogo = ({ logo, symbol }: { logo: string | null; symbol: string }) => {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full",
        "border border-border bg-secondary",
      )}
    >
      {logo ? (
        <img
          src={logo}
          alt={symbol}
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span className="font-mono text-[10px] text-muted-foreground">
          {symbol.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
};
