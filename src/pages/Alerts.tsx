import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Bell,
  Inbox,
  Laptop,
  Plus,
  Settings2,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertPreferences } from "@/components/AlertPreferences";
import { AlertRuleDialog } from "@/components/AlertRuleDialog";
import { AppSidebar } from "@/components/AppSidebar";
import { VisionLogo } from "@/components/VisionLogo";
import { AlertBell } from "@/components/AlertBell";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useNotifications } from "@/hooks/useNotifications";
import { useAlertRules, type AlertRule } from "@/hooks/useAlertRules";
import { usePushDevices } from "@/hooks/usePushDevices";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  price: "Price",
  wallet_activity: "Wallet",
  order_fills: "Orders",
  news_sentiment: "News",
};

const KIND_LABEL: Record<string, string> = {
  price: "Price threshold",
  wallet_activity: "Wallet activity",
  portfolio_pnl: "Portfolio PnL",
};

const Alerts = () => {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { isAdmin } = useIsAdmin();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("vision:sidebar-collapsed") === "1";
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((v) => {
      const next = !v;
      if (typeof window !== "undefined")
        window.localStorage.setItem("vision:sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="relative flex h-[100dvh] bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      {/* Desktop sidebar */}
      <div
        className={cn(
          "relative z-10 hidden h-full shrink-0 transition-[width] duration-200 ease-vision md:flex",
          sidebarCollapsed ? "w-14" : "w-64",
        )}
      >
        <AppSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebar}
          activePath="/alerts"
          isAdmin={isAdmin}
          user={user}
          profile={profile}
          onSignOut={signOut}
        />
      </div>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 md:hidden [&>button.absolute]:hidden">
          <AppSidebar
            collapsed={false}
            activePath="/alerts"
            isAdmin={isAdmin}
            user={user}
            profile={profile}
            onSignOut={signOut}
          />
        </SheetContent>
      </Sheet>

      <div className="relative z-10 flex flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 md:hidden">
              <VisionLogo size={20} />
              <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                Vision
              </span>
            </div>
            <Link
              to="/chat"
              className="hidden md:flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 ease-vision"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to chat
            </Link>
          </div>
          <div className="flex items-center gap-1.5">
            <AlertBell />
            <ConnectWalletButton size="default" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10">
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-8">
              <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
                <span className="font-serif-italic text-primary">Alerts</span>
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Tell Vision what to watch. Get pinged the moment it happens.
              </p>
            </div>

            <Tabs defaultValue="feed" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="feed" className="gap-1.5">
                  <Inbox className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Feed</span>
                </TabsTrigger>
                <TabsTrigger value="rules" className="gap-1.5">
                  <Bell className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Rules</span>
                </TabsTrigger>
                <TabsTrigger value="devices" className="gap-1.5">
                  <Laptop className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Devices</span>
                </TabsTrigger>
                <TabsTrigger value="preferences" className="gap-1.5">
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Preferences</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="feed" className="mt-6">
                <AlertsFeed />
              </TabsContent>

              <TabsContent value="rules" className="mt-6">
                <AlertsRules />
              </TabsContent>

              <TabsContent value="devices" className="mt-6">
                <AlertsDevices />
              </TabsContent>

              <TabsContent value="preferences" className="mt-6">
                <AlertPreferences />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
};

// --------------------- Feed ---------------------
const AlertsFeed = () => {
  const { items, loading, markAllRead, markRead, unreadCount } =
    useNotifications();

  if (loading) {
    return <p className="text-xs text-muted-foreground/70">Loading…</p>;
  }
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card/40 p-10 text-center">
        <Bell className="mx-auto mb-3 h-6 w-6 text-muted-foreground/60" />
        <p className="text-sm text-foreground">No alerts yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create a rule to start getting pinged.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {unreadCount > 0 && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void markAllRead()}
            className="text-xs"
          >
            Mark all read
          </Button>
        </div>
      )}
      <ul className="space-y-2">
        {items.map((n) => {
          const unread = !n.read_at;
          return (
            <li
              key={n.id}
              className={cn(
                "rounded-xl border border-border bg-card/40 p-4 ease-vision",
                unread && "border-primary/30 bg-primary/[0.04]",
              )}
              onClick={() => unread && void markRead(n.id)}
            >
              <div className="flex items-start gap-3">
                {unread && (
                  <span className="mt-1.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {n.title}
                    </p>
                    <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                      {CATEGORY_LABEL[n.category] ?? n.category}
                    </span>
                  </div>
                  {n.body && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.body}
                    </p>
                  )}
                  <p className="mt-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">
                    {formatDistanceToNow(new Date(n.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// --------------------- Rules ---------------------
const AlertsRules = () => {
  const { rules, loading, update, remove } = useAlertRules();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AlertRule | null>(null);

  const summarize = (r: AlertRule): string => {
    const c = r.config as unknown as Record<string, unknown>;
    if (r.kind === "price") {
      const sym = (c.token_symbol as string) ?? "Token";
      const ttype = (c.threshold_type as string) ?? "price";
      if (ttype === "percent") {
        const pct = Number(c.percent_change ?? 0);
        const win = Number(c.window_hours ?? 24);
        const word = c.direction === "below" ? "drops" : "pumps";
        return `${sym} ${word} ${pct}% in ${win}h`;
      }
      return `${sym} ${
        c.direction === "above" ? "rises above" : "falls below"
      } $${Number(c.threshold_usd).toLocaleString()}`;
    }
    if (r.kind === "wallet_activity") {
      const label = (c.wallet_label as string) || (c.wallet_address as string);
      return `${label} moves more than $${Number(c.min_value_usd).toLocaleString()}`;
    }
    if (r.kind === "portfolio_pnl") {
      const dir =
        c.direction === "up"
          ? "up"
          : c.direction === "down"
            ? "down"
            : "up or down";
      return `Portfolio moves ${dir} ${Number(c.percent_change)}% in ${Number(c.window_hours)}h`;
    }
    return "Custom trigger";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Custom triggers that fire an alert when conditions match.
        </p>
        <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New rule
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground/70">Loading…</p>
      ) : rules.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card/40 p-10 text-center">
          <Bell className="mx-auto mb-3 h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm text-foreground">No rules yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create your first rule to get alerted on price, wallet, or portfolio moves.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => (
            <li
              key={r.id}
              className={cn(
                "rounded-xl border border-border bg-card/40 p-4 ease-vision",
                !r.enabled && "opacity-60",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {r.label}
                    </p>
                    <span className="shrink-0 rounded-full border border-border bg-secondary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      {KIND_LABEL[r.kind]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {summarize(r)}
                  </p>
                  {r.last_triggered_at && (
                    <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">
                      Last fired{" "}
                      {formatDistanceToNow(new Date(r.last_triggered_at), {
                        addSuffix: true,
                      })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(v) => {
                      void update(r.id, { enabled: v });
                    }}
                    aria-label="Toggle rule"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDelete(r)}
                    aria-label="Delete rule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertRuleDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.label} — you'll stop receiving alerts for this trigger.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return;
                const ok = await remove(confirmDelete.id);
                setConfirmDelete(null);
                if (ok) toast.success("Rule deleted");
                else toast.error("Couldn't delete");
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// --------------------- Devices ---------------------
const AlertsDevices = () => {
  const { devices, loading, remove } = usePushDevices();

  const uaLabel = (ua: string | null): string => {
    if (!ua) return "Unknown browser";
    if (/iPhone|iPad/.test(ua)) return "iOS";
    if (/Android/.test(ua)) return "Android";
    if (/Firefox/.test(ua)) return "Firefox";
    if (/Edg/.test(ua)) return "Edge";
    if (/Chrome/.test(ua)) return "Chrome";
    if (/Safari/.test(ua)) return "Safari";
    return ua.slice(0, 40);
  };

  if (loading) return <p className="text-xs text-muted-foreground/70">Loading…</p>;

  if (devices.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card/40 p-10 text-center">
        <Smartphone className="mx-auto mb-3 h-6 w-6 text-muted-foreground/60" />
        <p className="text-sm text-foreground">No devices subscribed</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Enable browser push in Preferences to register this device.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Each browser you've enabled push on shows up here. Revoke any device to stop receiving push on it.
      </p>
      <ul className="space-y-2">
        {devices.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/40 p-4"
          >
            <div className="flex items-start gap-3">
              <Smartphone className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {uaLabel(d.user_agent)}
                </p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  Added{" "}
                  {formatDistanceToNow(new Date(d.created_at), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const ok = await remove(d.endpoint);
                if (ok) toast.success("Device removed");
                else toast.error("Couldn't remove device");
              }}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Alerts;
