import { useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { TradeTabs, type TradeTab } from "@/components/trade/TradeTabs";
import { TradeProBracket } from "@/components/trade/TradeProBracket";
import { TradeDca } from "@/components/trade/TradeDca";
import { TradeLadder } from "@/components/trade/TradeLadder";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Pro is a container that hosts three flows:
//   * TP/SL  — bracket orders via Jupiter Trigger v2 (managed vault)
//   * DCA    — recurring time-based buys via Jupiter Recurring v1
//   * Ladder — N parallel limit orders across a price range (Trigger v1)

type ProMode = "tpsl" | "dca" | "ladder";

const SUB_TABS: { id: ProMode; label: string }[] = [
  { id: "tpsl", label: "TP / SL" },
  { id: "dca", label: "DCA" },
  { id: "ladder", label: "Ladder" },
];

const BRACKET_EXPIRY_PRESETS = [
  { label: "1d", ms: 86_400_000 },
  { label: "7d", ms: 7 * 86_400_000 },
  { label: "30d", ms: 30 * 86_400_000 },
] as const;

const LADDER_EXPIRY_PRESETS: { label: string; seconds: number | null }[] = [
  { label: "1d", seconds: 86_400 },
  { label: "7d", seconds: 7 * 86_400 },
  { label: "30d", seconds: 30 * 86_400 },
  { label: "Never", seconds: null },
];

interface Props {
  tab: TradeTab;
  onTabChange: (t: TradeTab) => void;
}

export const TradePro = ({ tab, onTabChange }: Props) => {
  const [mode, setMode] = useState<ProMode>("tpsl");
  const [expiryMs, setExpiryMs] = useState<number>(7 * 86_400_000);
  const [ladderExpirySec, setLadderExpirySec] = useState<number | null>(7 * 86_400);

  const showSettings = mode === "tpsl" || mode === "ladder";

  return (
    <div className="w-full max-w-[440px] space-y-4">
      {/* Top-level Trade tabs */}
      <div className="flex items-center justify-center">
        <TradeTabs active={tab} onChange={onTabChange} />
      </div>

      {/* Pro sub-tabs + settings cog on a single aligned row */}
      <div className="relative flex items-center justify-center">
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

        {showSettings && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="ease-vision flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Order settings"
                >
                  <SettingsIcon className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Order expiry
                </p>
                {mode === "tpsl" ? (
                  <>
                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                      {BRACKET_EXPIRY_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setExpiryMs(p.ms)}
                          className={cn(
                            "ease-vision rounded-md border px-2 py-1.5 font-mono text-[11px]",
                            expiryMs === p.ms
                              ? "border-primary/60 bg-primary/10 text-foreground"
                              : "border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                      Brackets auto-cancel after this period. Funds stay in your vault until withdrawn.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-3 grid grid-cols-4 gap-1.5">
                      {LADDER_EXPIRY_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setLadderExpirySec(p.seconds)}
                          className={cn(
                            "ease-vision rounded-md border px-2 py-1.5 font-mono text-[11px]",
                            ladderExpirySec === p.seconds
                              ? "border-primary/60 bg-primary/10 text-foreground"
                              : "border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                      Each unfilled rung auto-cancels after this period.
                    </p>
                  </>
                )}
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {mode === "tpsl" ? (
        <TradeProBracket expiryMs={expiryMs} />
      ) : mode === "dca" ? (
        <TradeDca />
      ) : (
        <TradeLadder expirySeconds={ladderExpirySec} />
      )}
    </div>
  );
};
