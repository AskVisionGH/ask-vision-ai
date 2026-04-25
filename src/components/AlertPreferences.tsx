import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Smartphone, Inbox, MoonStar } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  useNotificationPreferences,
  type NotificationPreferences,
} from "@/hooks/useNotificationPreferences";
import { useWebPush } from "@/hooks/useWebPush";
import { PushEnableDialog } from "@/components/PushEnableDialog";
import { PushDeniedDialog } from "@/components/PushDeniedDialog";
import { cn } from "@/lib/utils";

/**
 * Notifications panel embedded inside Settings.
 *
 * Layers:
 *   1. Master toggle — global kill-switch
 *   2. Channels — in-app bell + Web Push (the latter also registers the SW)
 *   3. Categories — which kinds of alerts to fire
 *   4. Quiet hours — time-range suppression with the user's IANA timezone
 */
export const AlertPreferences = () => {
  const { prefs, loading, update } = useNotificationPreferences();
  const push = useWebPush();
  const [savingQuiet, setSavingQuiet] = useState(false);
  const [quietStart, setQuietStart] = useState<string>("22:00");
  const [quietEnd, setQuietEnd] = useState<string>("08:00");
  const [showEnableDialog, setShowEnableDialog] = useState(false);
  const [showDeniedDialog, setShowDeniedDialog] = useState(false);

  // Hydrate quiet-hours inputs from prefs the first time they arrive.
  useEffect(() => {
    if (!prefs) return;
    if (prefs.quiet_start) setQuietStart(prefs.quiet_start.slice(0, 5));
    if (prefs.quiet_end) setQuietEnd(prefs.quiet_end.slice(0, 5));
  }, [prefs]);

  if (loading || !prefs) {
    return <p className="text-xs text-muted-foreground/70">Loading…</p>;
  }

  const disabled = !prefs.master_enabled;

  const flip = async (key: keyof NotificationPreferences, value: boolean) => {
    const ok = await update({ [key]: value } as Partial<NotificationPreferences>);
    if (!ok) toast.error("Couldn't save preference");
  };

  // Actually trigger the native permission flow + subscribe. Used both by
  // the pre-prompt dialog (default state) and the recovery dialog (denied
  // state, after the user has flipped permissions back to allow).
  const runEnable = async () => {
    const ok = await push.enable();
    if (ok) {
      await update({ channel_web_push: true });
      setShowEnableDialog(false);
      setShowDeniedDialog(false);
      toast.success("Push notifications enabled");
      return;
    }
    // Failure paths:
    //  - "denied": browser already blocked; show recovery instructions.
    //  - other: probably unsupported / network — surface a toast.
    if (push.permission === "denied") {
      setShowEnableDialog(false);
      setShowDeniedDialog(true);
    } else {
      toast.error("Couldn't enable push", {
        description: "Your browser may not support Web Push.",
      });
    }
  };

  const toggleWebPush = async (on: boolean) => {
    if (on) {
      // Route based on current permission state so we never fire the native
      // prompt cold (which is what causes the un-recoverable denial).
      if (push.permission === "denied") {
        setShowDeniedDialog(true);
        return;
      }
      if (push.permission === "granted") {
        // Already allowed at the OS level — just subscribe quietly.
        await runEnable();
        return;
      }
      // "default" — show our friendly explainer first.
      setShowEnableDialog(true);
    } else {
      await push.disable();
      await update({ channel_web_push: false });
    }
  };

  const saveQuietHours = async () => {
    setSavingQuiet(true);
    const ok = await update({
      quiet_start: quietStart || null,
      quiet_end: quietEnd || null,
      quiet_timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    setSavingQuiet(false);
    if (ok) toast.success("Quiet hours saved");
    else toast.error("Couldn't save quiet hours");
  };

  return (
    <div className="space-y-5">
      {/* Master */}
      <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card/40 p-4">
        <div className="flex min-w-0 items-start gap-3">
          {prefs.master_enabled ? (
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          ) : (
            <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">All alerts</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Master switch for every notification we send you.
            </p>
          </div>
        </div>
        <Switch
          checked={prefs.master_enabled}
          onCheckedChange={(v) => void flip("master_enabled", v)}
          aria-label="Enable all notifications"
        />
      </div>

      {/* Channels */}
      <section className={cn("space-y-2", disabled && "opacity-50")}>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Channels
        </h3>
        <ToggleRow
          icon={<Inbox className="h-3.5 w-3.5 text-muted-foreground" />}
          label="In-app bell"
          description="Show alerts in the bell dropdown."
          checked={prefs.channel_in_app}
          onChange={(v) => void flip("channel_in_app", v)}
          disabled={disabled}
        />
        <ToggleRow
          icon={<Smartphone className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Browser push"
          description={
            !push.supported
              ? "Not supported on this browser."
              : push.permission === "denied"
                ? "Blocked — tap to see how to re-enable."
                : "Desktop + mobile browser notifications."
          }
          checked={prefs.channel_web_push && push.subscribed}
          onChange={(v) => void toggleWebPush(v)}
          disabled={disabled || !push.supported || push.busy}
        />
      </section>

      {/* Categories */}
      <section className={cn("space-y-2", disabled && "opacity-50")}>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Categories
        </h3>
        <ToggleRow
          label="Order fills"
          description="Limit orders, DCA slices, TP/SL triggers."
          checked={prefs.cat_order_fills}
          onChange={(v) => void flip("cat_order_fills", v)}
          disabled={disabled}
        />
        <ToggleRow
          label="Price movements"
          description="Custom price rules you create in the Rules tab."
          checked={prefs.cat_price}
          onChange={(v) => void flip("cat_price", v)}
          disabled={disabled}
        />
        <ToggleRow
          label="Wallet activity"
          description="Tracked wallets making moves above your set threshold."
          checked={prefs.cat_wallet_activity}
          onChange={(v) => void flip("cat_wallet_activity", v)}
          disabled={disabled}
        />
        <ToggleRow
          label="News & sentiment"
          description="Big narrative shifts and social chatter on your tokens."
          checked={prefs.cat_news_sentiment}
          onChange={(v) => void flip("cat_news_sentiment", v)}
          disabled={disabled}
          comingSoon
        />
      </section>

      {/* Quiet hours */}
      <section className={cn("space-y-3", disabled && "opacity-50")}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <MoonStar className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Quiet hours
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Suppress push during this range ({prefs.quiet_timezone}).
              </p>
            </div>
          </div>
          <Switch
            checked={prefs.quiet_hours_enabled}
            onCheckedChange={(v) => void flip("quiet_hours_enabled", v)}
            disabled={disabled}
            aria-label="Enable quiet hours"
          />
        </div>
        {prefs.quiet_hours_enabled && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="quiet-start" className="text-[11px] text-muted-foreground">
                Start
              </Label>
              <Input
                id="quiet-start"
                type="time"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="quiet-end" className="text-[11px] text-muted-foreground">
                End
              </Label>
              <Input
                id="quiet-end"
                type="time"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                disabled={disabled}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void saveQuietHours()}
              disabled={disabled || savingQuiet}
              className="shrink-0"
            >
              {savingQuiet ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </section>

      <PushEnableDialog
        open={showEnableDialog}
        busy={push.busy}
        onEnable={() => void runEnable()}
        onDismiss={() => setShowEnableDialog(false)}
      />
      <PushDeniedDialog
        open={showDeniedDialog}
        busy={push.busy}
        onRetry={() => void runEnable()}
        onDismiss={() => setShowDeniedDialog(false)}
      />
    </div>
  );
};

const ToggleRow = ({
  icon,
  label,
  description,
  checked,
  onChange,
  disabled,
  comingSoon,
}: {
  icon?: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  comingSoon?: boolean;
}) => (
  <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card/40 p-3.5">
    <div className="flex min-w-0 items-start gap-2.5">
      {icon}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm text-foreground">{label}</p>
          {comingSoon && (
            <span className="rounded-full border border-border/60 bg-secondary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
              Soon
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled || comingSoon}
      aria-label={label}
    />
  </div>
);
