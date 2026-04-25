import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Menu,
  Plus,
  Search,
  Star,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { VisionLogo } from "@/components/VisionLogo";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useProfile } from "@/hooks/useProfile";
import { useSmartWallets, type SmartWalletRow } from "@/hooks/useSmartWallets";
import { WalletSocialLinks } from "@/components/WalletSocialLinks";
import { cn } from "@/lib/utils";

const truncate = (a: string) =>
  a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

const TrackedWallets = () => {
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
    window.localStorage.setItem("vision:sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);
  const {
    tracked,
    trackedAddresses,
    curated,
    loading,
    addWallet,
    removeWallet,
    toggleCurated,
    trackAllCurated,
    untrackAllCurated,
  } = useSmartWallets();

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [twitter, setTwitter] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SmartWalletRow | null>(null);

  // Curated wallets the user added themselves are filtered out of the
  // "your custom" list — they live in the curated section as toggles.
  const customRows = useMemo(() => {
    const curatedAddrs = new Set(curated.map((c) => c.address));
    return tracked.filter((t) => !curatedAddrs.has(t.address));
  }, [tracked, curated]);

  const filteredCurated = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return curated;
    return curated.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.twitter_handle?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q),
    );
  }, [curated, search]);

  const trackedCount = trackedAddresses.size;

  const resetForm = () => {
    setName("");
    setAddress("");
    setTwitter("");
    setNotes("");
  };

  const submitAdd = async () => {
    if (!name.trim() || !address.trim()) {
      toast.error("Label and address required");
      return;
    }
    setSubmitting(true);
    const res = await addWallet({
      label: name,
      address,
      twitter_handle: twitter.trim().replace(/^@/, "") || null,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if ("error" in res) {
      toast.error("Couldn't add wallet", { description: res.error });
      return;
    }
    toast.success(`Tracking ${res.label}`);
    resetForm();
    setAddOpen(false);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const ok = await removeWallet(pendingDelete.id);
    if (ok) toast.success(`Stopped tracking ${pendingDelete.label}`);
    else toast.error("Couldn't remove wallet");
    setPendingDelete(null);
  };

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
          isAdmin={isAdmin}
          user={user}
          profile={profile}
          onSignOut={signOut}
        />
      </div>

      {/* Main column */}
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
          <div className="mx-auto max-w-3xl">
            <button
              onClick={() => navigate("/chat")}
              className="mb-6 hidden md:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground ease-vision"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to chat
            </button>

        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
              <span className="font-serif-italic text-primary">Tracked</span> wallets
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The wallets Vision watches when you ask "who's buying", "who bought
              this early", or run smart-money alpha. {trackedCount} tracked.
            </p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setAddOpen(true);
            }}
            className="rounded-full bg-primary px-4 text-primary-foreground hover:bg-primary/90 ease-vision"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add wallet
          </Button>
        </div>

        {loading ? (
          <div className="text-xs text-muted-foreground/70">Loading…</div>
        ) : (
          <div className="space-y-6">
            {/* Custom wallets */}
            <section className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md">
              <div className="mb-4 flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-medium text-foreground">Your wallets</h2>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {customRows.length} custom
                </span>
              </div>
              {customRows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/60 bg-card/20 px-4 py-6 text-center text-xs text-muted-foreground">
                  No custom wallets yet. Hit “Add wallet” above to start tracking
                  someone Vision doesn't already know about.
                </p>
              ) : (
                <ul className="space-y-2">
                  {customRows.map((w) => (
                    <li
                      key={w.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card/30 px-3 py-2.5"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-xs font-medium text-foreground">
                        {w.label.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {w.label}
                          </span>
                          <WalletSocialLinks
                            address={w.address}
                            twitterHandle={w.twitter_handle}
                            hideSolscan
                          />
                        </div>
                        <a
                          href={`https://solscan.io/account/${w.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] text-muted-foreground hover:text-primary"
                        >
                          {truncate(w.address)}
                        </a>
                        {w.notes && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                            {w.notes}
                          </p>
                        )}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(w)}
                        aria-label="Remove wallet"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Curated */}
            <section className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md">
              <div className="mb-4 flex items-center gap-2">
                <Star className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-medium text-foreground">Curated wallets</h2>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {curated.length} known traders & devs
                </span>
              </div>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search curated wallets…"
                  className="h-8 border-border/60 bg-secondary/40 pl-8 pr-7 text-xs"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {filteredCurated.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
                  No curated wallets match that search.
                </p>
              ) : (
                <ul className="space-y-1">
                  {filteredCurated.map((c) => {
                    const on = trackedAddresses.has(c.address);
                    return (
                      <li
                        key={c.address}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border px-3 py-2 ease-vision",
                          on
                            ? "border-primary/40 bg-primary/[0.06]"
                            : "border-border bg-card/20",
                        )}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-[10px] font-medium text-foreground">
                          {c.label.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {c.label}
                            </span>
                            {c.category && (
                              <span className="rounded-full border border-border/60 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                                {c.category}
                              </span>
                            )}
                            {c.notes === "community" && (
                              <span
                                className="rounded-full border border-border/60 bg-secondary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground/80"
                                title="Address widely circulated in the trading community but not personally confirmed by the wallet owner"
                              >
                                community
                              </span>
                            )}
                            <WalletSocialLinks
                              address={c.address}
                              twitterHandle={c.twitter_handle}
                              hideSolscan
                            />
                          </div>
                          <a
                            href={`https://solscan.io/account/${c.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[10px] text-muted-foreground hover:text-primary"
                          >
                            {truncate(c.address)}
                          </a>
                        </div>
                        <Switch
                          checked={on}
                          onCheckedChange={async (next) => {
                            const ok = await toggleCurated(c, !next);
                            if (!ok) toast.error("Couldn't update tracking");
                          }}
                          aria-label={on ? `Stop tracking ${c.label}` : `Track ${c.label}`}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
          </div>
        </main>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Track a wallet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="wallet-label" className="text-xs uppercase tracking-wider text-muted-foreground">
                Label
              </Label>
              <Input
                id="wallet-label"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Memecoin maxi"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wallet-address" className="text-xs uppercase tracking-wider text-muted-foreground">
                Solana address
              </Label>
              <Input
                id="wallet-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="7xKX…9aPq"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wallet-twitter" className="text-xs uppercase tracking-wider text-muted-foreground">
                X / Twitter (optional)
              </Label>
              <Input
                id="wallet-twitter"
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                placeholder="@handle"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wallet-notes" className="text-xs uppercase tracking-wider text-muted-foreground">
                Notes (optional)
              </Label>
              <Input
                id="wallet-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Why are you watching them?"
                maxLength={140}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAddOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={submitAdd}
              disabled={submitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? "Saving…" : "Track wallet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop tracking this wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.label} won't show up in smart-money feeds anymore.
              You can re-add them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Stop tracking
            </AlertDialogAction>
          </AlertDialogFooter>
      </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrackedWallets;
