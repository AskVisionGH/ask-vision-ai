import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Globe2, Moon, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { useWebPush } from "@/hooks/useWebPush";

// Clamp "HH:MM:SS" from DB -> "HH:MM" for <input type="time">.
const toHm = (value: string | null): string => {
  if (!value) return "";
  return value.slice(0, 5);
};
// Send "HH:MM" back as "HH:MM:00" to match the `time` column format.
const toHms = (value: string): string | null => {
  if (!value) return null;
  return value.length === 5 ? `${value}:00` : value;
};

const CATEGORIES: Array<{
  id: "price" | "wallet_activity" | "order_fills" | "news_sentiment";
  col:
    | "cat_price"
    | "cat_wallet_activity"
    | "cat_order_fills"
    | "cat_news_sentiment";
  label: string;
  description: string;
}> = [
  {
    id: "order_fills",
    col: "cat_order_fills",
    label: "Order fills",
    description: "Limit orders, DCA executions, TP/SL triggers.",
  },
  {
    id: "price",
    col: "cat_price",
    label: "Price alerts",
    description: "Price movements on tokens you hold or watch.",
  },
  {
    id: "wallet_activity",
    col: "cat_wallet_activity",
    label: "Wallet activity",
    description: "Big moves from wallets you track.",
  },
  {
    id: "news_sentiment",
    col: "cat_news_sentiment",
    label: "News & sentiment",
    description: "Breaking headlines and social sentiment shifts.",
  },
];

/**
 * Settings section for notification preferences.
 *
 * Layout:
 *   - Master toggle (all-off kill switch)
 *   - Per-category toggles
 *   - Channel toggles (in-app + web push). Enabling web push prompts the
 *     browser for permission and registers a subscription.
 *   - Quiet hours window (only one timezone — the user's detected one).
 *
 * The component is self-contained; hooks handle persistence.
 */
export const NotificationsSettings = () => {
  const { prefs, loading, update } = useNotificationPreferences();
  const push = useWebPush();

  // Local mirrors for quiet-hours inputs so the user can type without each
  // keystroke round-tripping to the DB.
  const [quietStart, setQuietStart] = useState<string>("");
  const [quietEnd, setQuietEnd] = useState<string>("");

  useEffect(() => {
    if (!prefs) return;
    setQuietStart(toHm(prefs.quiet_start));
    setQuietEnd(toHm(prefs.quiet_end));
  }, [prefs?.quiet_start, prefs?.quiet_end]);

  if (loading || !prefs) {
    return (
      <section
        id="notifications"
        className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md"
      >
        <h2 className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground">
          <Bell className="h-3.5 w-3.5 text-muted-foreground" />
          Notifications
        </h2>
        <p className="text-xs text-muted-foreground/70">Loading…</p>
      </section>
    );
  }

  const masterOn = prefs.master_enabled;

  const handlePushToggle = async (next: boolean) => {
    if (next) {
      // Enable: request permission AND subscribe.
      const ok = await push.enable();
      if (!ok) {
        if (push.permission === "denied") {
          toast.error("Browser notifications blocked", {
            description:
              "Enable notifications for this site in your browser settings.",
          });
        } else if (!push.supported) {
          toast.error("This browser doesn't support web push.");
        } else {
          toast.error("Couldn't enable web push");
        }
        return;
      }
      await update({ channel_web_push: true });
      toast.success("Web push enabled");
    } else {
      await push.disable();
      await update({ channel_web_push: false });
    }
  };

  const saveQuietHours = async () => {
    await update({
      quiet_start: toHms(quietStart),
      quiet_end: toHms(quietEnd),
    });
    toast.success("Quiet hours saved");
  };

  const detectedTz =
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      } catch {
        return "UTC";
      }
    })();

  return (
    <section
      id="notifications"
      className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md"
    >
      <h2 className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground">
        <Bell className="h-3.5 w-3.5 text-muted-foreground" />
        Notifications
      </h2>
      <p className="mb-5 text-xs text-muted-foreground">
        Choose what Vision pings you about, and when to stay quiet.
      </p>

      {/* Master */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {masterOn ? (
              <Bell className="h-3.5 w-3.5 text-primary" />
            ) : (
              <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            All notifications
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Master switch. When off, nothing is sent regardless of the toggles
            below.
          </p>
        </div>
        <Switch
          checked={masterOn}
          onCheckedChange={(v) => update({ master_enabled: v })}
          aria-label="Master notifications toggle"
        />
      </div>

      <div
        className={
          masterOn ? "mt-5 space-y-5" : "mt-5 space-y-5 opacity-50 pointer-events-none"
        }
        aria-hidden={!masterOn}
      >
        {/* Categories */}
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Categories
          </div>
          <div className="divide-y divide-border/50 rounded-xl border border-border">
            {CATEGORIES.map((c) => {
              const value = prefs[c.col] as boolean;
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-foreground">{c.label}</div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {c.description}
                    </p>
                  </div>
                  <Switch
                    checked={value}
                    onCheckedChange={(v) => update({ [c.col]: v })}
                    aria-label={c.label}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Channels */}
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Delivery
          </div>
          <div className="divide-y divide-border/50 rounded-xl border border-border">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                  In-app bell
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Show notifications in the bell menu while Vision is open.
                </p>
              </div>
              <Switch
                checked={prefs.channel_in_app}
                onCheckedChange={(v) => update({ channel_in_app: v })}
                aria-label="In-app notifications"
              />
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                  Web push
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {push.supported
                    ? "Native browser notifications, even when Vision isn't open."
                    : "Your browser doesn't support web push notifications."}
                </p>
                {push.permission === "denied" && (
                  <p className="mt-0.5 text-[11px] text-destructive">
                    Notifications are blocked in your browser. Re-enable them
                    in site settings.
                  </p>
                )}
              </div>
              <Switch
                checked={prefs.channel_web_push && push.subscribed}
                disabled={!push.supported || push.loading}
                onCheckedChange={handlePushToggle}
                aria-label="Web push notifications"
              />
            </div>
          </div>
        </div>

        {/* Quiet hours */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Quiet hours
            </div>
            <Switch
              checked={prefs.quiet_hours_enabled}
              onCheckedChange={(v) => update({ quiet_hours_enabled: v })}
              aria-label="Quiet hours"
            />
          </div>
          <div className="rounded-xl border border-border bg-background/40 p-4">
            <p className="mb-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Moon className="h-3 w-3" />
              During this window, notifications are suppressed. Windows can
              cross midnight.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="quiet-start" className="text-[11px] text-muted-foreground">
                  Start
                </Label>
                <Input
                  id="quiet-start"
                  type="time"
                  value={quietStart}
                  onChange={(e) => setQuietStart(e.target.value)}
                  disabled={!prefs.quiet_hours_enabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quiet-end" className="text-[11px] text-muted-foreground">
                  End
                </Label>
                <Input
                  id="quiet-end"
                  type="time"
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(e.target.value)}
                  disabled={!prefs.quiet_hours_enabled}
                />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Globe2 className="h-3 w-3" />
                Timezone:{" "}
                <span className="text-foreground">
                  {prefs.quiet_timezone || detectedTz}
                </span>
                {prefs.quiet_timezone !== detectedTz && (
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => update({ quiet_timezone: detectedTz })}
                  >
                    Use {detectedTz}
                  </button>
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={saveQuietHours}
                disabled={!prefs.quiet_hours_enabled}
              >
                Save window
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
