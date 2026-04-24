import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Check, Copy, ExternalLink, Loader2, Mail, RefreshCw, Shield, ShieldOff, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { EXPERIENCE_OPTIONS, INTEREST_OPTIONS, RISK_OPTIONS } from "@/lib/profile-options";

type SweepRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger: string;
  accounts_scanned: number;
  accounts_claimed: number;
  total_value_usd: number | null;
  signatures: string[];
  error_message: string | null;
};

// Full profile so the onboarding-answers dialog has everything it needs.
type ProfileRow = {
  user_id: string;
  display_name: string | null;
  experience: string | null;
  risk_tolerance: string | null;
  interests: string[];
  onboarding_completed: boolean;
  created_at: string;
};

type WalletLink = {
  user_id: string;
  wallet_address: string;
  created_at: string;
};

type RoleRow = {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
};

const FullScreenLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
);

const formatUsd = (n: number | null | undefined) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

const CopyId = ({ value, label }: { value: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: "Copied", description: shortId(value) });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      title={`Copy ${value}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-secondary/40 px-2 py-1 font-mono text-[10px] text-muted-foreground ease-vision hover:border-border hover:bg-secondary hover:text-foreground"
    >
      <span>{label ?? shortId(value)}</span>
      {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
    </button>
  );
};

const Admin = () => {
  const { isAdmin, loading } = useIsAdmin();

  if (loading) return <FullScreenLoader />;
  if (!isAdmin) return <Navigate to="/chat" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/chat">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Link>
            </Button>
            <div>
              <h1 className="text-lg font-semibold">Admin</h1>
              <p className="text-xs text-muted-foreground">
                Internal tooling — handle with care
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Shield className="h-3 w-3" /> Admin
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Tabs defaultValue="sweeps" className="space-y-4">
          <TabsList>
            <TabsTrigger value="sweeps">Fee sweeps</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
          </TabsList>

          <TabsContent value="sweeps">
            <SweepsTab />
          </TabsContent>
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
          <TabsContent value="roles">
            <RolesTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

/* ------------------------------- Sweeps tab ------------------------------- */

const SweepsTab = () => {
  const [runs, setRuns] = useState<SweepRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("sweep_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) {
      toast({ title: "Failed to load sweeps", description: error.message, variant: "destructive" });
    } else {
      setRuns((data ?? []) as SweepRun[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const success = runs.filter((r) => r.status === "success");
    return {
      runs: runs.length,
      claimed: success.reduce((sum, r) => sum + (r.total_value_usd ?? 0), 0),
      lastRun: runs[0]?.started_at ?? null,
    };
  }, [runs]);

  const triggerSweep = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("sweep-fees", {
        body: { trigger: "manual" },
      });
      if (error) throw error;
      toast({ title: "Sweep triggered", description: JSON.stringify(data).slice(0, 140) });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Sweep failed", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total runs
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">{totals.runs}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total claimed
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">{formatUsd(totals.claimed)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Last run
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm">
            {totals.lastRun ? format(new Date(totals.lastRun), "PPp") : "Never"}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Recent runs</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={triggerSweep} disabled={running}>
            {running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Sweep now
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Scanned</TableHead>
                <TableHead className="text-right">Claimed</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No sweep runs yet. They appear after the cron fires or you press "Sweep now".
                  </TableCell>
                </TableRow>
              ) : null}
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">
                    {format(new Date(r.started_at), "MMM d HH:mm")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{r.trigger}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={r.status === "success" ? "default" : r.status === "running" ? "secondary" : "destructive"}
                      className="text-xs"
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.accounts_scanned}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.accounts_claimed}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(r.total_value_usd)}</TableCell>
                  <TableCell className="text-xs">
                    {r.signatures?.[0] ? (
                      <a
                        href={`https://solscan.io/tx/${r.signatures[0]}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {r.signatures[0].slice(0, 6)}…
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

/* -------------------------------- Users tab ------------------------------- */

const UsersTab = () => {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [walletsByUser, setWalletsByUser] = useState<Record<string, WalletLink[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // The two clickable-pill dialogs share open state via the focused user id.
  const [onboardingFor, setOnboardingFor] = useState<ProfileRow | null>(null);
  const [walletsFor, setWalletsFor] = useState<ProfileRow | null>(null);

  useEffect(() => {
    (async () => {
      // Pull profiles first; then in parallel hydrate the auxiliary lookups
      // (emails via admin RPC, wallet links via the new admin RLS policy).
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "user_id, display_name, experience, risk_tolerance, interests, onboarding_completed, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) {
        toast({ title: "Failed to load users", description: error.message, variant: "destructive" });
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as ProfileRow[];
      setProfiles(rows);
      setLoading(false);

      const ids = rows.map((r) => r.user_id);
      if (ids.length === 0) return;

      const [emailRes, walletRes] = await Promise.all([
        supabase.rpc("admin_get_user_emails", { _user_ids: ids }),
        supabase
          .from("wallet_links")
          .select("user_id, wallet_address, created_at")
          .in("user_id", ids),
      ]);

      if (!emailRes.error && emailRes.data) {
        const map: Record<string, string> = {};
        for (const r of emailRes.data as { user_id: string; email: string | null }[]) {
          if (r.email) map[r.user_id] = r.email;
        }
        setEmails(map);
      }
      if (!walletRes.error && walletRes.data) {
        const map: Record<string, WalletLink[]> = {};
        for (const w of walletRes.data as WalletLink[]) {
          (map[w.user_id] ??= []).push(w);
        }
        setWalletsByUser(map);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.display_name?.toLowerCase().includes(q) ||
        p.user_id.toLowerCase().includes(q) ||
        emails[p.user_id]?.toLowerCase().includes(q),
    );
  }, [profiles, search, emails]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Input
          placeholder="Search by name, email or user ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <p className="text-xs text-muted-foreground">{filtered.length} of {profiles.length}</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Display name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Wallets</TableHead>
                <TableHead>Onboarded</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>User ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : null}
              {!loading && filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : null}
              {filtered.map((p) => {
                const email = emails[p.user_id];
                const wallets = walletsByUser[p.user_id] ?? [];
                return (
                  <TableRow key={p.user_id}>
                    <TableCell className="font-medium">
                      {p.display_name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {email ? (
                        <CopyId value={email} label={shortEmail(email)} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setWalletsFor(p)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/50 px-2.5 py-0.5 text-xs ease-vision hover:border-primary/60 hover:bg-secondary"
                      >
                        <Wallet className="h-3 w-3" />
                        {wallets.length === 0 ? "None" : `${wallets.length} linked`}
                      </button>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setOnboardingFor(p)}
                        className={
                          p.onboarding_completed
                            ? "inline-flex items-center rounded-full border border-primary/30 bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-foreground ease-vision hover:bg-primary/25"
                            : "inline-flex items-center rounded-full border border-border bg-secondary/40 px-2.5 py-0.5 text-xs text-muted-foreground ease-vision hover:bg-secondary"
                        }
                      >
                        {p.onboarding_completed ? "Yes" : "No"}
                      </button>
                    </TableCell>
                    <TableCell className="text-xs">{format(new Date(p.created_at), "MMM d, yyyy")}</TableCell>
                    <TableCell>
                      <CopyId value={p.user_id} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <OnboardingDialog
        profile={onboardingFor}
        onOpenChange={(open) => !open && setOnboardingFor(null)}
      />
      <WalletsDialog
        profile={walletsFor}
        wallets={walletsFor ? walletsByUser[walletsFor.user_id] ?? [] : []}
        onOpenChange={(open) => !open && setWalletsFor(null)}
      />
    </div>
  );
};

/* ----------------------------- Users tab dialogs --------------------------- */

const labelFor = <T extends { value: string; label: string }>(
  options: T[],
  value: string | null,
) => options.find((o) => o.value === value)?.label ?? value ?? "—";

const OnboardingDialog = ({
  profile,
  onOpenChange,
}: {
  profile: ProfileRow | null;
  onOpenChange: (open: boolean) => void;
}) => {
  const interestLabels = (profile?.interests ?? [])
    .map((v) => INTEREST_OPTIONS.find((o) => o.value === v)?.label ?? v);
  const expOpt = EXPERIENCE_OPTIONS.find((o) => o.value === profile?.experience);
  const riskOpt = RISK_OPTIONS.find((o) => o.value === profile?.risk_tolerance);

  return (
    <Dialog open={!!profile} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{profile?.display_name ?? "User"}'s onboarding</DialogTitle>
          <DialogDescription>
            What this user told us during sign-up.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Crypto experience
            </div>
            <div className="mt-1 font-medium">{labelFor(EXPERIENCE_OPTIONS, profile?.experience ?? null)}</div>
            {expOpt && (
              <p className="mt-0.5 text-xs text-muted-foreground">{expOpt.description}</p>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Risk tolerance
            </div>
            <div className="mt-1 font-medium">{labelFor(RISK_OPTIONS, profile?.risk_tolerance ?? null)}</div>
            {riskOpt && (
              <p className="mt-0.5 text-xs text-muted-foreground">{riskOpt.description}</p>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Interests
            </div>
            {interestLabels.length === 0 ? (
              <div className="mt-1 text-muted-foreground">None selected</div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {interestLabels.map((l) => (
                  <Badge key={l} variant="secondary" className="text-xs">{l}</Badge>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
            Joined {profile ? format(new Date(profile.created_at), "PPP") : ""}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const WalletsDialog = ({
  profile,
  wallets,
  onOpenChange,
}: {
  profile: ProfileRow | null;
  wallets: WalletLink[];
  onOpenChange: (open: boolean) => void;
}) => {
  const copy = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      toast({ title: "Address copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <Dialog open={!!profile} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Linked wallets</DialogTitle>
          <DialogDescription>
            Public Solana addresses linked to {profile?.display_name ?? "this user"}.
          </DialogDescription>
        </DialogHeader>

        {wallets.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No wallets linked yet. They'll appear here once the user signs in
            with a Solana wallet.
          </p>
        ) : (
          <ul className="space-y-2">
            {wallets.map((w) => (
              <li
                key={w.wallet_address}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/40 p-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs">{w.wallet_address}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                    Linked {format(new Date(w.created_at), "MMM d, yyyy")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => copy(w.wallet_address)}
                    title="Copy address"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground ease-vision"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <a
                    href={`https://solscan.io/account/${w.wallet_address}`}
                    target="_blank"
                    rel="noreferrer"
                    title="View on Solscan"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground ease-vision"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* -------------------------------- Roles tab ------------------------------- */

const RolesTab = () => {
  const { user } = useAuth();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [nameByUserId, setNameByUserId] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [granting, setGranting] = useState(false);
  const [newUserId, setNewUserId] = useState("");

  const load = async () => {
    setLoading(true);
    const [rolesRes, profilesRes] = await Promise.all([
      supabase.from("user_roles").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("user_id, display_name"),
    ]);
    if (rolesRes.error) {
      toast({ title: "Failed to load roles", description: rolesRes.error.message, variant: "destructive" });
    } else {
      setRoles((rolesRes.data ?? []) as RoleRow[]);
    }
    if (!profilesRes.error && profilesRes.data) {
      const map: Record<string, string | null> = {};
      for (const p of profilesRes.data as { user_id: string; display_name: string | null }[]) {
        map[p.user_id] = p.display_name;
      }
      setNameByUserId(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const grant = async () => {
    const id = newUserId.trim();
    if (!id) return;
    setGranting(true);
    const { error } = await supabase.from("user_roles").insert({ user_id: id, role: "admin" });
    setGranting(false);
    if (error) {
      toast({ title: "Could not grant", description: error.message, variant: "destructive" });
      return;
    }
    setNewUserId("");
    toast({ title: "Admin granted" });
    load();
  };

  const revoke = async (row: RoleRow) => {
    if (row.user_id === user?.id) {
      toast({ title: "Refusing to revoke your own admin role", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("user_roles").delete().eq("id", row.id);
    if (error) {
      toast({ title: "Could not revoke", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Role revoked" });
    load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Grant admin</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            placeholder="User ID (UUID from Users tab)"
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            className="font-mono text-xs"
          />
          <Button onClick={grant} disabled={granting || !newUserId.trim()}>
            {granting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Shield className="mr-1 h-3.5 w-3.5" />}
            Grant
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : null}
              {!loading && roles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No roles assigned.
                  </TableCell>
                </TableRow>
              ) : null}
              {roles.map((r) => {
                const name = nameByUserId[r.user_id];
                return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {name ?? <span className="text-muted-foreground">Unknown</span>}
                    {r.user_id === user?.id ? (
                      <Badge variant="outline" className="ml-2 text-[10px]">You</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <CopyId value={r.user_id} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">{r.role}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(r)}
                      disabled={r.user_id === user?.id}
                    >
                      <ShieldOff className="mr-1 h-3.5 w-3.5" />
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Admin;
