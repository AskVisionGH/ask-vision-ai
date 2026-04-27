import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Menu } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { VisionLogo } from "@/components/VisionLogo";
import { OrdersPanel } from "@/components/orders/OrdersPanel";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useProfile } from "@/hooks/useProfile";
import { cn } from "@/lib/utils";

/**
 * /orders — unified active orders page (Limit + DCA, Vision + external).
 *
 * Cancel only — Jupiter doesn't expose an edit endpoint, so users cancel
 * here and re-create from the Trade page if they need a different price
 * or amount. That keeps the platform-fee accounting clean (one fee per
 * order) and avoids a 2-tx, 2-signature edit flow.
 */
const OrdersPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { isAdmin } = useIsAdmin();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("vision:sidebar-collapsed") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "vision:sidebar-collapsed",
      sidebarCollapsed ? "1" : "0",
    );
  }, [sidebarCollapsed]);

  return (
    <>
      <Helmet>
        <title>Orders · Vision</title>
        <meta
          name="description"
          content="Active limit and DCA orders across your Vision Wallet and connected wallets — view status and cancel from one place."
        />
      </Helmet>

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
            onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
            activePath={location.pathname}
            isAdmin={isAdmin}
            user={user}
            profile={profile}
            onSignOut={signOut}
          />
        </div>

        <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          {/* Mobile header */}
          <header className="flex shrink-0 items-center justify-between border-b border-border/60 bg-background/60 px-4 py-3 backdrop-blur-md md:hidden">
            <div className="flex items-center gap-2">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    aria-label="Open menu"
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-72 p-0 [&>button.absolute]:hidden"
                >
                  <AppSidebar
                    collapsed={false}
                    activePath={location.pathname}
                    isAdmin={isAdmin}
                    user={user}
                    profile={profile}
                    onSignOut={signOut}
                  />
                </SheetContent>
              </Sheet>
              <div className="flex items-center gap-2">
                <VisionLogo size={20} />
                <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Vision
                </span>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto px-4 py-8 sm:px-6">
            <div className="mx-auto max-w-2xl">
              <button
                onClick={() => navigate("/chat")}
                className="ease-vision mb-6 hidden items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground md:flex"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to chat
              </button>

              <div className="mb-8 flex items-end justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
                    <span className="font-serif-italic text-primary">Orders</span>
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Active limit and DCA orders across your Vision Wallet and
                    connected wallets. Cancel anytime — re-create from the Trade
                    page if you need a different price or amount.
                  </p>
                </div>
                <Button
                  onClick={() => navigate("/trade")}
                  variant="outline"
                  className="ease-vision rounded-full"
                >
                  Trade
                </Button>
              </div>

              <OrdersPanel />
            </div>
          </main>
        </div>
      </div>
    </>
  );
};

export default OrdersPage;
