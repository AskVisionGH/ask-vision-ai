import { cn } from "@/lib/utils";

interface Props {
  logo: string | null;
  symbol: string;
  size?: number;
}

export const TokenLogo = ({ logo, symbol, size = 32 }: Props) => {
  return (
    <div
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full",
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
