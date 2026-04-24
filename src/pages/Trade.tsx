import { Link, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  ArrowLeftRight,
  Bell,
  LogOut,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Repeat,
  Settings as SettingsIcon,
  Shield,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { VisionLogo } from "@/components/VisionLogo";
import { UserAvatar } from "@/components/UserAvatar";
import { TradeSwap } from "@/components/trade/TradeSwap";
import { TradeLimit } from "@/components/trade/TradeLimit";
import { TradePro } from "@/components/trade/TradePro";
import type { TradeTab } from "@/components/trade/TradeTabs";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cn } from "@/lib/utils";

const Trade = () => {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { isAdmin } = useIsAdmin();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tab, setTab] = useState<TradeTab>(() => {
    const params = new URLSearchParams(location.search);
    const t = params.get("tab");
    if (t === "limit" || t === "pro" || t === "trade") return t;
    return "trade";
  });

  // Honor ?tab= changes when navigating between deep-links from chat.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const t = params.get("tab");
    if (t === "limit" || t === "pro" || t === "trade") setTab(t);
  }, [location.search]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("vision:sidebar-collapsed") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("vision:sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  return (
    <div className="relative flex h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      {/* Desktop sidebar */}
      <div
        className={cn(
          "relative z-10 hidden h-full shrink-0 transition-[width] duration-200 ease-vision md:flex",
          sidebarCollapsed ? "w-14" : "w-64",
        )}
      >
        <TradeSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
          activePath={location.pathname}
          isAdmin={isAdmin}
          user={user}
          profile={profile}
          onSignOut={signOut}
        />
      </div>

      {/* Main column */}
      <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-border/60 bg-background/60 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden h-8 w-8 text-muted-foreground"
                  aria-label="Open menu"
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 [&>button.absolute]:hidden">
                <TradeSidebar
                  collapsed={false}
                  activePath={location.pathname}
                  isAdmin={isAdmin}
                  user={user}
                  profile={profile}
                  onSignOut={signOut}
                />
              </SheetContent>
            </Sheet>
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
          <ConnectWalletButton size="default" />
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-12">
          <div className="mx-auto flex w-full max-w-[520px] flex-col items-center">
            <div className="mb-8 flex flex-col items-center text-center">
              <div className="relative">
                <div
                  className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-primary/40 blur-2xl animate-pulse-glow"
                  aria-hidden
                />
                <VisionLogo size={56} className="text-foreground drop-shadow-[0_0_18px_hsl(var(--primary)/0.7)]" />
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {tab === "limit"
                  ? "Set a price. We'll fill automatically when the market hits it."
                  : tab === "pro"
                    ? "Bracket orders with take-profit and stop-loss in a single placement."
                    : "Swap any Solana token at the best on-chain price."}
              </p>
            </div>
            {tab === "pro" ? (
              <TradePro tab={tab} onTabChange={setTab} />
            ) : tab === "limit" ? (
              <TradeLimit tab={tab} onTabChange={setTab} />
            ) : (
              <TradeSwap tab={tab} onTabChange={setTab} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Trade;

// ---------------- Sidebar (lightweight, mirrors Chat layout) ----------------

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  activePath: string;
  isAdmin: boolean;
  user: { email?: string | null } | null;
  profile: { display_name?: string | null; avatar_url?: string | null } | null;
  onSignOut: () => void | Promise<unknown>;
}

const TradeSidebar = ({
  collapsed,
  onToggleCollapsed,
  activePath,
  isAdmin,
  user,
  profile,
  onSignOut,
}: SidebarProps) => {
  if (collapsed) {
    return (
      <aside className="flex h-full w-full flex-col items-center border-r border-border/60 bg-background/80 py-3 backdrop-blur-md">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapsed}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <div className="mt-3 flex flex-col items-center gap-1.5">
          <Link
            to="/chat"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="New chat"
            title="New chat"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Link>
          <Link
            to="/contacts"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Contacts"
            title="Contacts"
          >
            <Users className="h-4 w-4" />
          </Link>
          <Link
            to="/tracked-wallets"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Tracked wallets"
            title="Tracked wallets"
          >
            <Radar className="h-4 w-4" />
          </Link>
          <Link
            to="/trade"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md hover:bg-secondary/60 hover:text-foreground",
              activePath === "/trade"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground",
            )}
            aria-label="Trade"
            title="Trade"
          >
            <Repeat className="h-4 w-4" />
          </Link>
        </div>
        {isAdmin && (
          <div className="mt-1.5 flex flex-col items-center">
            <Link
              to="/admin"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              aria-label="Admin"
              title="Admin"
            >
              <Shield className="h-4 w-4" />
            </Link>
          </div>
        )}
        <div className="mt-auto flex flex-col items-center gap-1.5">
          <Link
            to="/settings"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>
          <button
            onClick={() => onSignOut()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <Link to="/settings" className="mt-1" aria-label="Account">
            <UserAvatar
              name={profile?.display_name}
              email={user?.email}
              src={profile?.avatar_url}
              size={28}
            />
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-border/60 bg-background/80 backdrop-blur-md">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
        <Link to="/chat" className="flex items-center gap-2">
          <VisionLogo size={20} />
          <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
            Vision
          </span>
        </Link>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="New chat"
            title="New chat"
          >
            <Link to="/chat">
              <MessageSquarePlus className="h-4 w-4" />
            </Link>
          </Button>
          {onToggleCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleCollapsed}
              className="hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="shrink-0 px-2 py-2">
        <NavRow to="/contacts" icon={<Users className="h-3.5 w-3.5" />} label="Contacts" />
        <NavRow to="/tracked-wallets" icon={<Radar className="h-3.5 w-3.5" />} label="Tracked wallets" />
        <NavRow
          to="/trade"
          icon={<Repeat className="h-3.5 w-3.5" />}
          label="Trade"
          active={activePath === "/trade"}
        />
        <button
          type="button"
          disabled
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground/50 ease-vision cursor-not-allowed"
          aria-label="Bridge (coming soon)"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          <span>Bridge</span>
          <span className="ml-auto rounded-full border border-border/60 bg-secondary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            Soon
          </span>
        </button>
        <button
          type="button"
          disabled
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground/50 ease-vision cursor-not-allowed"
          aria-label="Alerts (coming soon)"
        >
          <Bell className="h-3.5 w-3.5" />
          <span>Alerts</span>
          <span className="ml-auto rounded-full border border-border/60 bg-secondary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            Soon
          </span>
        </button>
        {isAdmin && <NavRow to="/admin" icon={<Shield className="h-3.5 w-3.5" />} label="Admin" />}
      </div>

      <div className="flex-1" />

      <div className="shrink-0 border-t border-border/60 px-3 py-3">
        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 -m-1.5 text-left ease-vision hover:bg-secondary/60"
          >
            <UserAvatar
              name={profile?.display_name}
              email={user?.email}
              src={profile?.avatar_url}
              size={32}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-foreground">
                {profile?.display_name?.trim() || user?.email || "Account"}
              </p>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Settings"
          >
            <Link to="/settings">
              <SettingsIcon className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSignOut()}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
};

const NavRow = ({
  to,
  icon,
  label,
  active = false,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) => (
  <Link
    to={to}
    className={cn(
      "ease-vision flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
      active
        ? "bg-secondary text-foreground"
        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
    )}
  >
    {icon}
    {label}
  </Link>
);
