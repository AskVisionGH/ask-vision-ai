import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Menu } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VisionLogo } from "@/components/VisionLogo";
import { WalletBalancesPanel } from "@/components/wallet/WalletBalancesPanel";
import { WalletWithdrawPanel } from "@/components/wallet/WalletWithdrawPanel";
import { WalletActivityPanel } from "@/components/wallet/WalletActivityPanel";
import { FundVisionWalletDialog } from "@/components/wallet/FundVisionWalletDialog";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useProfile } from "@/hooks/useProfile";
import { useVisionWallet } from "@/hooks/useVisionWallet";
import { cn } from "@/lib/utils";

/**
 * /wallet — dedicated home for the user's Vision Wallet.
 *
 * v1 ships Balances + Deposit. Withdraw and Activity tabs are placeholders
 * wired to the next iteration's edge functions (`wallet-withdraw-build` and
 * `wallet-activity`, which are already deployed).
 */
const WalletPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { isAdmin } = useIsAdmin();
  const { solanaAddress, evmAddress, loading } = useVisionWallet();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("vision:sidebar-collapsed") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("vision:sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  const hasWallet = !!(solanaAddress || evmAddress);

  return (
    <>
      <Helmet>
        <title>Wallet · Vision</title>
        <meta
          name="description"
          content="Manage your Vision Wallet — view balances, deposit, withdraw, and review activity."
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
                <SheetContent side="left" className="w-72 p-0 [&>button.absolute]:hidden">
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
                <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                  Vision
                </span>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto px-4 py-8 sm:px-6">
            <div className="mx-auto max-w-2xl">
              <button
                onClick={() => navigate("/chat")}
                className="mb-6 hidden items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground ease-vision md:flex"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to chat
              </button>

              <div className="mb-8 flex items-end justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
                    <span className="font-serif-italic text-primary">Wallet</span>
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your Vision Wallet — balances, deposits, withdrawals, and activity in one place.
                  </p>
                </div>
                {hasWallet && (
                  <Button
                    onClick={() => setDepositOpen(true)}
                    className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 ease-vision"
                  >
                    Deposit
                  </Button>
                )}
              </div>

              {loading ? (
                <p className="text-xs text-muted-foreground/70">Loading…</p>
              ) : !hasWallet ? (
                <div className="rounded-2xl border border-dashed border-border bg-card/30 p-10 text-center backdrop-blur-md">
                  <p className="text-sm text-muted-foreground">
                    No Vision Wallet yet. Create one from Settings to get started.
                  </p>
                </div>
              ) : (
                <Tabs defaultValue="balances" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="balances">Balances</TabsTrigger>
                    <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                  </TabsList>

                  <TabsContent value="balances" className="pt-6">
                    <WalletBalancesPanel />
                  </TabsContent>

                  <TabsContent value="withdraw" className="pt-6">
                    <WalletWithdrawPanel />
                  </TabsContent>

                  <TabsContent value="activity" className="pt-6">
                    <WalletActivityPanel />
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </main>
        </div>
      </div>

      <FundVisionWalletDialog open={depositOpen} onOpenChange={setDepositOpen} />
    </>
  );
};

export default WalletPage;
