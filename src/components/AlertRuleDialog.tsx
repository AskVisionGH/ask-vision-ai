import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TokenLogo } from "@/components/TokenLogo";
import {
  TokenPickerDialog,
  type TokenMeta,
} from "@/components/trade/TokenPickerDialog";
import {
  useAlertRules,
  type AlertRuleKind,
  type AlertRuleConfig,
} from "@/hooks/useAlertRules";
import { useSmartWallets } from "@/hooks/useSmartWallets";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create-new-rule dialog.
 * Form shape swaps based on the selected kind (price/wallet/pnl).
 */
export const AlertRuleDialog = ({ open, onOpenChange }: Props) => {
  const { create } = useAlertRules();
  const { tracked: wallets } = useSmartWallets();

  const [kind, setKind] = useState<AlertRuleKind>("price");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  // Price fields
  const [priceToken, setPriceToken] = useState<TokenMeta>(DEFAULT_SOL);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [priceDirection, setPriceDirection] = useState<"above" | "below">("above");
  /** "price" = absolute USD threshold · "percent" = % move over a window. */
  const [thresholdType, setThresholdType] = useState<"price" | "percent">("price");
  const [thresholdUsd, setThresholdUsd] = useState("");
  const [pricePercent, setPricePercent] = useState("");
  const [priceWindow, setPriceWindow] = useState("24");

  // Wallet fields
  const [walletAddress, setWalletAddress] = useState("");
  const [walletLabel, setWalletLabel] = useState("");
  const [walletMinUsd, setWalletMinUsd] = useState("");

  // Portfolio fields
  const [pnlDirection, setPnlDirection] = useState<"up" | "down" | "both">("both");
  const [pnlPercent, setPnlPercent] = useState("");
  const [pnlWindow, setPnlWindow] = useState("24");

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setKind("price");
    setLabel("");
    setPriceToken(DEFAULT_SOL);
    setPriceDirection("above");
    setThresholdType("price");
    setThresholdUsd("");
    setPricePercent("");
    setPriceWindow("24");
    setWalletAddress("");
    setWalletLabel("");
    setWalletMinUsd("");
    setPnlDirection("both");
    setPnlPercent("");
    setPnlWindow("24");
  }, [open]);

  const submit = async () => {
    if (saving) return;
    let config: AlertRuleConfig;
    let autoLabel = label.trim();

    if (kind === "price") {
      if (!priceToken.address) {
        toast.error("Pick a token");
        return;
      }
      const dirWord = priceDirection === "above" ? "rises above" : "falls below";
      if (thresholdType === "price") {
        const n = Number(thresholdUsd);
        if (!Number.isFinite(n) || n <= 0) {
          toast.error("Set a positive price target");
          return;
        }
        config = {
          token_symbol: priceToken.symbol,
          token_name: priceToken.name,
          token_logo: priceToken.logo,
          token_address: priceToken.address,
          direction: priceDirection,
          threshold_type: "price",
          threshold_usd: n,
        };
        if (!autoLabel) autoLabel = `${priceToken.symbol} ${dirWord} $${n}`;
      } else {
        const pct = Number(pricePercent);
        const win = Number(priceWindow);
        if (!Number.isFinite(pct) || pct <= 0 || !Number.isFinite(win) || win <= 0) {
          toast.error("Set a positive percent and window");
          return;
        }
        config = {
          token_symbol: priceToken.symbol,
          token_name: priceToken.name,
          token_logo: priceToken.logo,
          token_address: priceToken.address,
          direction: priceDirection,
          threshold_type: "percent",
          percent_change: pct,
          window_hours: win,
        };
        const arrow = priceDirection === "above" ? "+" : "-";
        if (!autoLabel) autoLabel = `${priceToken.symbol} ${arrow}${pct}% / ${win}h`;
      }
    } else if (kind === "wallet_activity") {
      const n = Number(walletMinUsd);
      if (!walletAddress.trim() || !Number.isFinite(n) || n <= 0) {
        toast.error("Pick a wallet and set a minimum value");
        return;
      }
      config = {
        wallet_address: walletAddress.trim(),
        wallet_label: walletLabel.trim() || undefined,
        min_value_usd: n,
      };
      if (!autoLabel)
        autoLabel = `${walletLabel.trim() || walletAddress.slice(0, 6)} > $${n}`;
    } else {
      const n = Number(pnlPercent);
      const w = Number(pnlWindow);
      if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(w) || w <= 0) {
        toast.error("Set a percent and time window");
        return;
      }
      config = {
        direction: pnlDirection,
        percent_change: n,
        window_hours: w,
      };
      if (!autoLabel) autoLabel = `Portfolio ${pnlDirection} ${n}% / ${w}h`;
    }

    setSaving(true);
    const row = await create({ kind, label: autoLabel, config });
    setSaving(false);
    if (!row) {
      toast.error("Couldn't create rule");
      return;
    }
    toast.success("Rule created");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New alert rule</DialogTitle>
          <DialogDescription>
            Vision will ping you when this trigger matches.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Trigger type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as AlertRuleKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="price">Price threshold</SelectItem>
                <SelectItem value="wallet_activity">Wallet activity</SelectItem>
                <SelectItem value="portfolio_pnl">Portfolio PnL</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === "price" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Token symbol</Label>
                  <Input
                    value={tokenSymbol}
                    onChange={(e) => setTokenSymbol(e.target.value)}
                    placeholder="SOL"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Direction</Label>
                  <Select
                    value={priceDirection}
                    onValueChange={(v) => setPriceDirection(v as "above" | "below")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="above">Rises above</SelectItem>
                      <SelectItem value="below">Falls below</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Price (USD)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={thresholdUsd}
                  onChange={(e) => setThresholdUsd(e.target.value)}
                  placeholder="200"
                />
              </div>
            </>
          )}

          {kind === "wallet_activity" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Wallet</Label>
                {wallets.length > 0 ? (
                  <Select
                    value={walletAddress}
                    onValueChange={(v) => {
                      setWalletAddress(v);
                      const w = wallets.find((x) => x.address === v);
                      setWalletLabel(w?.label ?? "");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a tracked wallet" />
                    </SelectTrigger>
                    <SelectContent>
                      {wallets.map((w) => (
                        <SelectItem key={w.id} value={w.address}>
                          {w.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    placeholder="Wallet address"
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">
                  Minimum transaction value (USD)
                </Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={walletMinUsd}
                  onChange={(e) => setWalletMinUsd(e.target.value)}
                  placeholder="10000"
                />
              </div>
            </>
          )}

          {kind === "portfolio_pnl" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Direction</Label>
                  <Select
                    value={pnlDirection}
                    onValueChange={(v) => setPnlDirection(v as "up" | "down" | "both")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="up">Up only</SelectItem>
                      <SelectItem value="down">Down only</SelectItem>
                      <SelectItem value="both">Either way</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Window (hours)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={pnlWindow}
                    onChange={(e) => setPnlWindow(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Percent change</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={pnlPercent}
                  onChange={(e) => setPnlPercent(e.target.value)}
                  placeholder="10"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">
              Label (optional)
            </Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Auto-generated if empty"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
