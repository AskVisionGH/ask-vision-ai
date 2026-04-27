import { cn } from "@/lib/utils";

interface Props {
  logo: string | null;
  symbol: string;
  size?: number;
  /**
   * When true, request the image with `crossOrigin="anonymous"` so the
   * resulting <img> can be safely serialized by html-to-image (used by the
   * shareable PnL poster). Off by default — most logos hosts don't send
   * permissive CORS headers, and we don't want to break the regular UI
   * which falls back to the `<img>` natural load path.
   */
  crossOrigin?: boolean;
}

export const TokenLogo = ({ logo, symbol, size = 32, crossOrigin }: Props) => {
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
          {...(crossOrigin ? { crossOrigin: "anonymous" as const } : {})}
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
