import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type TradeTab = "trade" | "limit" | "bridge" | "buy" | "sell";

interface Props {
  active: TradeTab;
  onChange: (t: TradeTab) => void;
}

const TABS: { id: TradeTab; label: string; enabled: boolean }[] = [
  { id: "trade", label: "Trade", enabled: true },
  { id: "limit", label: "Limit", enabled: true },
  { id: "bridge", label: "Bridge", enabled: false },
  { id: "buy", label: "Buy", enabled: false },
  { id: "sell", label: "Sell", enabled: false },
];

export const TradeTabs = ({ active, onChange }: Props) => {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center gap-0.5 rounded-full border border-border/60 bg-secondary/40 p-1">
        {TABS.map((t) => {
          const isActive = active === t.id;
          if (!t.enabled) {
            return (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled
                    aria-label={`${t.label} (coming soon)`}
                    className="ease-vision flex cursor-not-allowed items-center gap-1 rounded-full px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/40"
                  >
                    <span>{t.label}</span>
                    <span className="hidden rounded-full border border-border/60 bg-secondary/40 px-1 py-px text-[8px] tracking-wider text-muted-foreground/70 sm:inline">
                      Soon
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Coming soon</TooltipContent>
              </Tooltip>
            );
          }
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={cn(
                "ease-vision rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                isActive
                  ? "bg-secondary text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </TooltipProvider>
  );
};
