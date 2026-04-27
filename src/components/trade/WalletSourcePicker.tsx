import { Sparkles, Wallet as WalletIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type WalletSource = "vision" | "external";

interface WalletSourcePickerProps {
  value: WalletSource;
  onChange: (next: WalletSource) => void;
  /** True if the user has provisioned a Vision Wallet on the relevant chain. */
  visionAvailable: boolean;
  /** True if the user has an external wallet connected on the relevant chain. */
  externalAvailable: boolean;
  /** Optional click handler to provision the Vision Wallet inline. */
  onCreateVision?: () => void;
  /** Optional click handler to open the external wallet modal. */
  onConnectExternal?: () => void;
  className?: string;
}

/**
 * WalletSourcePicker — slim, two-option toggle that lets the user pick which
 * wallet a trade should sign with. Vision Wallet is the recommended default;
 * external wallet is intentionally a quieter secondary option.
 */
export const WalletSourcePicker = ({
  value,
  onChange,
  visionAvailable,
  externalAvailable,
  onCreateVision,
  onConnectExternal,
  className,
}: WalletSourcePickerProps) => {
  const showVisionCta = !visionAvailable && value === "vision";
  const showExternalCta = !externalAvailable && value === "external";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Pay with
        </p>
        <span className="font-mono text-[9px] uppercase tracking-widest text-primary/80">
          Recommended: Vision
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        {/* Vision Wallet — primary */}
        <button
          type="button"
          onClick={() => onChange("vision")}
          className={cn(
            "ease-vision group relative flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all",
            value === "vision"
              ? "border-primary/60 bg-primary/10 shadow-soft"
              : "border-border/60 bg-secondary/30 hover:border-primary/30 hover:bg-secondary/60",
          )}
          aria-pressed={value === "vision"}
        >
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              value === "vision"
                ? "bg-primary/20 text-primary"
                : "bg-secondary/60 text-muted-foreground group-hover:text-foreground",
            )}
          >
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[12px] font-medium text-foreground">
                Vision Wallet
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[10px] leading-tight text-muted-foreground">
              Faster, no popups, one-click sign
            </p>
          </div>
        </button>

        {/* External wallet — secondary, intentionally smaller */}
        <button
          type="button"
          onClick={() => onChange("external")}
          className={cn(
            "ease-vision flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-muted-foreground transition-all",
            value === "external"
              ? "border-border bg-secondary text-foreground"
              : "border-border/40 bg-transparent hover:border-border hover:text-foreground",
          )}
          aria-pressed={value === "external"}
          title="Use a connected external wallet"
        >
          <WalletIcon className="h-3.5 w-3.5" />
          <span className="font-mono text-[10px] uppercase tracking-wider">
            External
          </span>
        </button>
      </div>

      {showVisionCta && onCreateVision && (
        <button
          type="button"
          onClick={onCreateVision}
          className="ease-vision w-full rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-[11px] text-primary hover:bg-primary/15"
        >
          Create your Vision Wallet
        </button>
      )}

      {showExternalCta && onConnectExternal && (
        <button
          type="button"
          onClick={onConnectExternal}
          className="ease-vision w-full rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          Connect external wallet
        </button>
      )}
    </div>
  );
};
