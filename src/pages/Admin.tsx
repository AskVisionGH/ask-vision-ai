import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, ArrowLeftRight, BarChart3, Check, Copy, ExternalLink, Loader2, Mail, MessageSquare, RefreshCw, Send, Shield, ShieldOff, TrendingUp, UserCheck, Users, Wallet } from "lucide-react";
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

type TreasuryFee = {
  id: string;
  chain: "solana" | "ethereum";
  treasury_address: string;
  source_kind: "swap_fee" | "dca_fee" | "bridge_fee" | "sweep" | "limit_fee" | "transfer_fee" | "other";
  asset_symbol: string | null;
  asset_address: string | null;
  amount: number;
  amount_usd: number | null;
  signature: string;
  from_address: string | null;
  block_time: string;
  metadata: Record<string, unknown> | null;
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
const shortEmail = (email: string) => {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const shortLocal = local.length > 10 ? `${local.slice(0, 8)}…` : local;
  return `${shortLocal}@${domain}`;
};

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
        <Tabs defaultValue="stats" className="space-y-4">
          <TabsList>
            <TabsTrigger value="stats">Stats</TabsTrigger>
            <TabsTrigger value="treasury">Treasury</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
          </TabsList>

          <TabsContent value="stats">
            <StatsTab />
          </TabsContent>
          <TabsContent value="treasury">
            <TreasuryTab />
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

/* -------------------------------- Stats tab ------------------------------- */

type StatsData = {
  totalUsers: number;
  onboardedUsers: number;
  signupsLast7d: number;
  signupsLast30d: number;
  signupsByDay: { date: string; count: number }[];
  // "active" = currently in DB, "totalEver" = lifetime including deleted.
  activeConversations: number;
  totalConversationsEver: number;
  activeMessages: number;
  totalMessagesEver: number;
  messagesLast7d: number;
  activeUsers7d: number;
  totalWalletLinks: number;
  uniqueLinkedWallets: number;
  totalTxs: number;
  txByKind: Record<string, { count: number; valueUsd: number }>;
  totalVolumeUsd: number;
  experienceBreakdown: { value: string; count: number }[];
  riskBreakdown: { value: string; count: number }[];
  topInterests: { value: string; count: number }[];
};

const StatCard = ({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
}) => (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </CardTitle>
    </CardHeader>
    <CardContent className="pt-0">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </CardContent>
  </Card>
);

const SignupsSparkline = ({ data }: { data: { date: string; count: number }[] }) => {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-24 items-end gap-0.5">
      {data.map((d) => {
        const heightPct = (d.count / max) * 100;
        return (
          <div
            key={d.date}
            className="group relative flex-1 rounded-sm bg-primary/30 ease-vision hover:bg-primary"
            style={{ height: `${Math.max(2, heightPct)}%` }}
            title={`${d.date}: ${d.count} signup${d.count === 1 ? "" : "s"}`}
          />
        );
      })}
    </div>
  );
};

const BreakdownBar = ({
  items,
  labelMap,
}: {
  items: { value: string; count: number }[];
  labelMap?: Record<string, string>;
}) => {
  const total = items.reduce((s, i) => s + i.count, 0);
  if (total === 0) return <p className="text-xs text-muted-foreground">No data yet.</p>;
  return (
    <div className="space-y-2">
      {items.map((i) => {
        const pct = (i.count / total) * 100;
        return (
          <div key={i.value}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span>{labelMap?.[i.value] ?? i.value}</span>
              <span className="tabular-nums text-muted-foreground">
                {i.count} · {pct.toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const StatsTab = () => {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      // Pull everything in parallel — RLS lets admins see all rows.
      const [
        profilesRes,
        convsRes,
        messagesRes,
        walletsRes,
        txRes,
        countersRes,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, experience, risk_tolerance, interests, onboarding_completed, created_at")
          .limit(10000),
        supabase.from("conversations").select("id, user_id, created_at").limit(10000),
        supabase.from("messages").select("id, user_id, created_at").limit(50000),
        supabase.from("wallet_links").select("user_id, wallet_address").limit(10000),
        supabase.from("tx_events").select("kind, value_usd, created_at").limit(50000),
        // Lifetime counters survive deletes (DB triggers increment on insert).
        supabase.from("app_counters").select("key, value"),
      ]);

      const profiles = (profilesRes.data ?? []) as Array<{
        user_id: string;
        experience: string | null;
        risk_tolerance: string | null;
        interests: string[];
        onboarding_completed: boolean;
        created_at: string;
      }>;
      const conversations = (convsRes.data ?? []) as Array<{ user_id: string; created_at: string }>;
      const messages = (messagesRes.data ?? []) as Array<{ user_id: string; created_at: string }>;
      const wallets = (walletsRes.data ?? []) as Array<{ user_id: string; wallet_address: string }>;
      const txs = (txRes.data ?? []) as Array<{ kind: string; value_usd: number | null; created_at: string }>;
      const counters = Object.fromEntries(
        ((countersRes.data ?? []) as Array<{ key: string; value: number }>).map((c) => [c.key, Number(c.value)]),
      );
      // Fall back to live counts if a counter is missing (e.g. backfill skipped).
      const totalConversationsEver = Math.max(
        counters.conversations_created_total ?? 0,
        conversations.length,
      );
      const totalMessagesEver = Math.max(
        counters.messages_created_total ?? 0,
        messages.length,
      );

      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      const since7 = now - 7 * day;
      const since30 = now - 30 * day;

      // Build a 30-day signup histogram (oldest → newest).
      const dayBuckets: { date: string; count: number }[] = [];
      const bucketIndex = new Map<string, number>();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * day);
        const key = d.toISOString().slice(0, 10);
        bucketIndex.set(key, dayBuckets.length);
        dayBuckets.push({ date: key, count: 0 });
      }
      for (const p of profiles) {
        const key = p.created_at.slice(0, 10);
        const idx = bucketIndex.get(key);
        if (idx !== undefined) dayBuckets[idx].count += 1;
      }

      const signupsLast7d = profiles.filter((p) => new Date(p.created_at).getTime() >= since7).length;
      const signupsLast30d = profiles.filter((p) => new Date(p.created_at).getTime() >= since30).length;
      const messagesLast7d = messages.filter((m) => new Date(m.created_at).getTime() >= since7).length;
      const activeUserSet = new Set(
        messages.filter((m) => new Date(m.created_at).getTime() >= since7).map((m) => m.user_id),
      );

      // Tx aggregates
      const txByKind: Record<string, { count: number; valueUsd: number }> = {};
      let totalVolumeUsd = 0;
      for (const t of txs) {
        const bucket = (txByKind[t.kind] ??= { count: 0, valueUsd: 0 });
        bucket.count += 1;
        bucket.valueUsd += t.value_usd ?? 0;
        totalVolumeUsd += t.value_usd ?? 0;
      }

      // Onboarding breakdowns
      const tally = (key: "experience" | "risk_tolerance") => {
        const counts = new Map<string, number>();
        for (const p of profiles) {
          const v = p[key];
          if (!v) continue;
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        return [...counts.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count);
      };
      const interestCounts = new Map<string, number>();
      for (const p of profiles) {
        for (const i of p.interests ?? []) {
          interestCounts.set(i, (interestCounts.get(i) ?? 0) + 1);
        }
      }
      const topInterests = [...interestCounts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      setStats({
        totalUsers: profiles.length,
        onboardedUsers: profiles.filter((p) => p.onboarding_completed).length,
        signupsLast7d,
        signupsLast30d,
        signupsByDay: dayBuckets,
        activeConversations: conversations.length,
        totalConversationsEver,
        activeMessages: messages.length,
        totalMessagesEver,
        messagesLast7d,
        activeUsers7d: activeUserSet.size,
        totalWalletLinks: wallets.length,
        uniqueLinkedWallets: new Set(wallets.map((w) => w.wallet_address)).size,
        totalTxs: txs.length,
        txByKind,
        totalVolumeUsd,
        experienceBreakdown: tally("experience"),
        riskBreakdown: tally("risk_tolerance"),
        topInterests,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Failed to load stats", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const onboardedPct = stats.totalUsers > 0
    ? Math.round((stats.onboardedUsers / stats.totalUsers) * 100)
    : 0;
  // Lifetime totals power the avg — deletes shouldn't make this number jump.
  const avgMessages = stats.totalUsers > 0
    ? (stats.totalMessagesEver / stats.totalUsers).toFixed(1)
    : "0";

  const expLabel = Object.fromEntries(EXPERIENCE_OPTIONS.map((o) => [o.value, o.label]));
  const riskLabel = Object.fromEntries(RISK_OPTIONS.map((o) => [o.value, o.label]));
  const interestLabel = Object.fromEntries(INTEREST_OPTIONS.map((o) => [o.value, o.label]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Overview</h2>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Top-line numbers */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Total users"
          value={stats.totalUsers.toLocaleString()}
          hint={`+${stats.signupsLast7d} in last 7d`}
        />
        <StatCard
          icon={UserCheck}
          label="Onboarded"
          value={`${stats.onboardedUsers.toLocaleString()}`}
          hint={`${onboardedPct}% completion rate`}
        />
        <StatCard
          icon={Wallet}
          label="Linked wallets"
          value={stats.uniqueLinkedWallets.toLocaleString()}
          hint={`${stats.totalWalletLinks} total links`}
        />
        <StatCard
          icon={TrendingUp}
          label="Total volume"
          value={formatUsd(stats.totalVolumeUsd) ?? "$0"}
          hint={`${stats.totalTxs.toLocaleString()} transactions`}
        />
      </div>

      {/* Engagement */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Engagement</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={MessageSquare}
            label="Conversations"
            value={stats.totalConversationsEver.toLocaleString()}
            hint={`${stats.activeConversations.toLocaleString()} active · ${(stats.totalConversationsEver - stats.activeConversations).toLocaleString()} deleted`}
          />
          <StatCard
            icon={MessageSquare}
            label="Messages"
            value={stats.totalMessagesEver.toLocaleString()}
            hint={`${stats.activeMessages.toLocaleString()} active · +${stats.messagesLast7d} in last 7d`}
          />
          <StatCard
            icon={BarChart3}
            label="Avg msgs / user"
            value={avgMessages}
          />
          <StatCard
            icon={Users}
            label="Active users (7d)"
            value={stats.activeUsers7d.toLocaleString()}
            hint="Sent at least one message"
          />
        </div>
      </div>

      {/* Transaction kinds */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Transactions by type</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["swap", "transfer", "bridge"] as const).map((k) => {
            const b = stats.txByKind[k] ?? { count: 0, valueUsd: 0 };
            const Icon = k === "swap" ? ArrowLeftRight : k === "transfer" ? Send : ExternalLink;
            return (
              <Card key={k}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground capitalize">
                    <Icon className="h-3.5 w-3.5" />
                    {k}s
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-2xl font-semibold tabular-nums">{b.count.toLocaleString()}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {formatUsd(b.valueUsd) ?? "$0"} total
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {stats.totalTxs === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No transactions logged yet — they'll appear here as users swap or transfer.
          </p>
        ) : null}
      </div>

      {/* Signups sparkline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Signups · last 30 days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SignupsSparkline data={stats.signupsByDay} />
          <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>{stats.signupsByDay[0]?.date}</span>
            <span>Today</span>
          </div>
        </CardContent>
      </Card>

      {/* Onboarding funnel */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Experience</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownBar items={stats.experienceBreakdown} labelMap={expLabel} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Risk tolerance</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownBar items={stats.riskBreakdown} labelMap={riskLabel} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top interests</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownBar items={stats.topInterests} labelMap={interestLabel} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

/* ------------------------------ Treasury tab ------------------------------ */

const SOURCE_LABELS: Record<TreasuryFee["source_kind"], string> = {
  swap_fee: "Swap fee",
  limit_fee: "Limit fee",
  dca_fee: "DCA fee",
  bridge_fee: "Bridge fee",
  sweep: "Sweep",
  transfer_fee: "Transfer fee",
  other: "Other",
};

const TreasuryTab = () => {
  const [fees, setFees] = useState<TreasuryFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [chainFilter, setChainFilter] = useState<"all" | "solana" | "ethereum">("all");
  const [kindFilter, setKindFilter] = useState<"all" | TreasuryFee["source_kind"]>("all");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("treasury_fees")
      .select("*")
      .order("block_time", { ascending: false })
      .limit(500);
    if (error) {
      toast({ title: "Failed to load treasury", description: error.message, variant: "destructive" });
    } else {
      setFees((data ?? []) as TreasuryFee[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("treasury-fees-sync", {
        body: { trigger: "manual" },
      });
      if (error) throw error;
      const summary = (data as { summary?: { swap_sweeps?: number; dca_fees?: number; bridge_fees?: number } })?.summary;
      toast({
        title: "Sync complete",
        description: summary
          ? `Sweeps: ${summary.swap_sweeps ?? 0} · DCA: ${summary.dca_fees ?? 0} · Bridge: ${summary.bridge_fees ?? 0}`
          : "Indexed.",
      });
      await load();
    } catch (e) {
      toast({ title: "Sync failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    return fees.filter((f) => {
      if (chainFilter !== "all" && f.chain !== chainFilter) return false;
      if (kindFilter !== "all" && f.source_kind !== kindFilter) return false;
      return true;
    });
  }, [fees, chainFilter, kindFilter]);

  const totals = useMemo(() => {
    const sum = (rows: TreasuryFee[]) => rows.reduce((acc, r) => acc + (r.amount_usd ?? 0), 0);
    return {
      all: sum(fees),
      sol: sum(fees.filter((f) => f.chain === "solana")),
      eth: sum(fees.filter((f) => f.chain === "ethereum")),
      bridge: sum(fees.filter((f) => f.source_kind === "bridge_fee")),
      count: fees.length,
    };
  }, [fees]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total revenue</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">{formatUsd(totals.all)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Solana</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">{formatUsd(totals.sol)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Ethereum</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">{formatUsd(totals.eth)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Entries</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">{totals.count}</CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(["all", "solana", "ethereum"] as const).map((c) => (
            <Button
              key={c}
              size="sm"
              variant={chainFilter === c ? "default" : "outline"}
              onClick={() => setChainFilter(c)}
              className="h-7 text-xs capitalize"
            >
              {c}
            </Button>
          ))}
          <span className="mx-2 h-7 w-px bg-border" />
          {(["all", "swap_fee", "limit_fee", "dca_fee", "bridge_fee", "sweep"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={kindFilter === k ? "default" : "outline"}
              onClick={() => setKindFilter(k)}
              className="h-7 text-xs"
            >
              {k === "all" ? "All kinds" : SOURCE_LABELS[k]}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={triggerSync} disabled={syncing || loading}>
            {syncing || loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Chain</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">USD</TableHead>
                <TableHead>Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No fees recorded yet. Press "Sync now" to backfill from sweeps and the ETH treasury.
                  </TableCell>
                </TableRow>
              ) : null}
              {filtered.map((f) => {
                const explorer = f.chain === "solana"
                  ? `https://solscan.io/tx/${f.signature}`
                  : `https://etherscan.io/tx/${f.signature}`;
                return (
                  <TableRow key={f.id}>
                    <TableCell className="text-xs">{format(new Date(f.block_time), "MMM d HH:mm")}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">{f.chain}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{SOURCE_LABELS[f.source_kind]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs font-medium">{f.asset_symbol ?? (f.chain === "solana" ? "SOL" : "ETH")}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {f.amount > 0 ? f.amount.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatUsd(f.amount_usd)}</TableCell>
                    <TableCell className="text-xs">
                      <a href={explorer} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {f.signature.slice(0, 6)}…
                      </a>
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
