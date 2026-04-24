import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Menu, Plus, Trash2, UserRound, Wallet } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ContactRow, useContacts } from "@/hooks/useContacts";
import { cn } from "@/lib/utils";

const truncate = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const Contacts = () => {
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
  const { contacts, loading, addContact, updateContact, deleteContact } = useContacts();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ContactRow | null>(null);

  const openAdd = () => {
    setEditing(null);
    setName("");
    setAddress("");
    setDialogOpen(true);
  };

  const openEdit = (c: ContactRow) => {
    setEditing(c);
    setName(c.name);
    setAddress(c.address);
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!name.trim() || !address.trim()) {
      toast.error("Name and address required");
      return;
    }
    setSubmitting(true);
    if (editing) {
      const ok = await updateContact(editing.id, { name, address });
      setSubmitting(false);
      if (ok) {
        toast.success("Contact updated");
        setDialogOpen(false);
      } else {
        toast.error("Couldn't update contact");
      }
      return;
    }
    const result = await addContact({ name, address });
    setSubmitting(false);
    if ("error" in result) {
      toast.error("Couldn't add contact", { description: result.error });
    } else {
      toast.success(`Saved ${result.name}`);
      setDialogOpen(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const ok = await deleteContact(pendingDelete.id);
    if (ok) toast.success(`Removed ${pendingDelete.name}`);
    else toast.error("Couldn't remove contact");
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
          <NotificationBell />
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-8 sm:px-6">
          <div className="mx-auto max-w-2xl">
            <button
              onClick={() => navigate("/chat")}
              className="mb-6 hidden md:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground ease-vision"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to chat
            </button>

        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
              <span className="font-serif-italic text-primary">Contacts</span>
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Save wallets by name. Vision will use them when you say "send to mom".
            </p>
          </div>
          <Button
            onClick={openAdd}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 ease-vision"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add
          </Button>
        </div>

        {loading ? (
          <div className="text-xs text-muted-foreground/70">Loading…</div>
        ) : contacts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/30 p-10 text-center backdrop-blur-md">
            <UserRound className="mx-auto h-6 w-6 text-muted-foreground/60" />
            <p className="mt-3 text-sm text-muted-foreground">
              No contacts yet. Save your first wallet.
            </p>
            <Button
              onClick={openAdd}
              variant="outline"
              className="mt-5 rounded-full border-border"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add contact
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-card/40 backdrop-blur-md">
            {contacts.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "group flex items-center justify-between gap-3 px-4 py-3 ease-vision",
                  "hover:bg-secondary/30",
                )}
              >
                <button
                  onClick={() => openEdit(c)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-xs font-medium text-foreground">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {c.name}
                    </p>
                    <p className="flex items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground">
                      <Wallet className="h-3 w-3 shrink-0" />
                      {truncate(c.address)}
                      {c.resolved_address && c.resolved_address !== c.address && (
                        <span className="text-muted-foreground/60">
                          → {truncate(c.resolved_address)}
                        </span>
                      )}
                    </p>
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPendingDelete(c)}
                  className="h-8 w-8 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                  aria-label={`Delete ${c.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
          </div>
        </main>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit contact" : "Add contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name" className="text-xs uppercase tracking-wider text-muted-foreground">
                Name
              </Label>
              <Input
                id="contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mom, Cold wallet"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-address" className="text-xs uppercase tracking-wider text-muted-foreground">
                Wallet address or .sol name
              </Label>
              <Input
                id="contact-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="7xKX… or toly.sol"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={submitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? "Saving…" : editing ? "Save" : "Add contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove contact?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.name}" will be removed from your address book.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Contacts;
