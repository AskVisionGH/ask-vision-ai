import { useState } from "react";
import { TradeTabs, type TradeTab } from "@/components/trade/TradeTabs";
import { TradeProBracket } from "@/components/trade/TradeProBracket";
import { TradeDca } from "@/components/trade/TradeDca";
import { cn } from "@/lib/utils";

// Pro is a container that hosts two flows:
//   * TP/SL — bracket orders via Jupiter Trigger v2 (managed vault)
//   * DCA   — recurring time-based buys via Jupiter Recurring v1

type ProMode = "tpsl" | "dca";

const SUB_TABS: { id: ProMode; label: string }[] = [
  { id: "tpsl", label: "TP / SL" },
  { id: "dca", label: "DCA" },
];

interface Props {
  tab: TradeTab;
  onTabChange: (t: TradeTab) => void;
}

export const TradePro = ({ tab, onTabChange }: Props) => {
  const [mode, setMode] = useState<ProMode>("tpsl");

  return (
    <div className="w-full max-w-[440px] space-y-4">
      {/* Top-level Trade tabs */}
      <div className="flex items-center justify-center">
        <TradeTabs active={tab} onChange={onTabChange} />
      </div>

      {/* Pro sub-tabs */}
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-0.5 rounded-full border border-border/60 bg-secondary/30 p-0.5">
          {SUB_TABS.map((t) => {
            const active = mode === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setMode(t.id)}
                className={cn(
                  "ease-vision rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  active
                    ? "bg-secondary text-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={active}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {mode === "tpsl" ? <TradeProBracket /> : <TradeDca />}
    </div>
  );
};