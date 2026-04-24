import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { AlertBell } from "@/components/AlertBell";
import { VisionLogo } from "@/components/VisionLogo";
import { TradeSwap } from "@/components/trade/TradeSwap";
import { TradeLimit } from "@/components/trade/TradeLimit";
import { TradePro } from "@/components/trade/TradePro";
import { TradeBridge } from "@/components/trade/TradeBridge";
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
    if (t === "limit" || t === "pro" || t === "trade" || t === "bridge") return t;
    return "trade";
  });

  // Honor ?tab= changes when navigating between deep-links from chat.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const t = params.get("tab");
    if (t === "limit" || t === "pro" || t === "trade" || t === "bridge") setTab(t);
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
        <AppSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
          activePath={location.pathname}
          activeTradeTab={tab}
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
                <AppSidebar
                  collapsed={false}
                  activePath={location.pathname}
                  activeTradeTab={tab}
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
          <div className="flex items-center gap-1.5">
            <AlertBell />
            <ConnectWalletButton size="default" />
          </div>
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
                    : tab === "bridge"
                      ? "Move tokens across chains with Vision's smart cross-chain routing."
                      : "Swap any Solana token at the best on-chain price."}
              </p>
            </div>
            {tab === "pro" ? (
              <TradePro tab={tab} onTabChange={setTab} />
            ) : tab === "limit" ? (
              <TradeLimit tab={tab} onTabChange={setTab} />
            ) : tab === "bridge" ? (
              <TradeBridge tab={tab} onTabChange={setTab} />
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
