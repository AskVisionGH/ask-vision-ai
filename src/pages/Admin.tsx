import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowLeftRight, BarChart3, CalendarIcon, Check, Copy, ExternalLink, History, Loader2, Mail, MailCheck, MailPlus, MessageSquare, RefreshCw, Send, Shield, ShieldOff, TrendingUp, UserCheck, Users, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { EXPERIENCE_OPTIONS, INTEREST_OPTIONS, RISK_OPTIONS } from "@/lib/profile-options";
import { isWalletSyntheticEmail } from "@/lib/wallet-email";

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
  related_user_id: string | null;
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
            <TabsTrigger value="emails">Emails</TabsTrigger>
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
          <TabsContent value="emails">
            <EmailsTab />
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
  signupsInRange: number;
  signupsByDay: { date: string; count: number }[];
  // "active" = currently in DB within the range.
  activeConversations: number;
  totalConversationsEver: number;
  activeMessages: number;
  totalMessagesEver: number;
  messagesInRange: number;
  activeUsersInRange: number;
  totalWalletLinks: number;
  uniqueLinkedWallets: number;
  totalTxs: number;
  txByKind: Record<string, { count: number; valueUsd: number }>;
  totalVolumeUsd: number;
  experienceBreakdown: { value: string; count: number }[];
  riskBreakdown: { value: string; count: number }[];
  topInterests: { value: string; count: number }[];
};

type ProfileLite = {
  user_id: string;
  experience: string | null;
  risk_tolerance: string | null;
  interests: string[];
  onboarding_completed: boolean;
  created_at: string;
};
type ConvLite = { user_id: string; created_at: string };
type MsgLite = { user_id: string; created_at: string };
type WalletLite = { user_id: string; wallet_address: string; created_at: string };
type TxLite = { kind: string; value_usd: number | null; created_at: string };

type RawStats = {
  profiles: ProfileLite[];
  conversations: ConvLite[];
  messages: MsgLite[];
  wallets: WalletLite[];
  txs: TxLite[];
  counters: Record<string, number>;
  summary: {
    total_users: number;
    onboarded_users: number;
    total_conversations: number;
    total_messages: number;
    total_wallet_links: number;
    unique_linked_wallets: number;
    total_txs: number;
    total_volume_usd: number;
    total_treasury_usd: number;
    refreshed_at: string;
  } | null;
};

type RangeKey = "1h" | "1d" | "1w" | "1m" | "1y" | "all" | "custom";

const RANGE_OPTIONS: { value: Exclude<RangeKey, "custom">; label: string }[] = [
  { value: "1h", label: "Last hour" },
  { value: "1d", label: "Last 24 hours" },
  { value: "1w", label: "Last 7 days" },
  { value: "1m", label: "Last 30 days" },
  { value: "1y", label: "Last year" },
  { value: "all", label: "All time" },
];

const rangeBounds = (
  range: RangeKey,
  custom: DateRange | undefined,
  earliest: number,
): { from: number; to: number } => {
  const now = Date.now();
  if (range === "custom" && custom?.from) {
    const fromDate = new Date(custom.from);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = custom.to ? new Date(custom.to) : new Date(custom.from);
    toDate.setHours(23, 59, 59, 999);
    return { from: fromDate.getTime(), to: toDate.getTime() };
  }
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  switch (range) {
    case "1h": return { from: now - hour, to: now };
    case "1d": return { from: now - day, to: now };
    case "1w": return { from: now - 7 * day, to: now };
    case "1m": return { from: now - 30 * day, to: now };
    case "1y": return { from: now - 365 * day, to: now };
    case "all":
    default: return { from: earliest, to: now };
  }
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
      {data.map((d, i) => {
        const heightPct = (d.count / max) * 100;
        return (
          <div
            key={`${i}-${d.date}`}
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
  const [raw, setRaw] = useState<RawStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("all");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [
        profilesRes,
        convsRes,
        messagesRes,
        walletsRes,
        txRes,
        countersRes,
        summaryRes,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, experience, risk_tolerance, interests, onboarding_completed, created_at")
          .limit(10000),
        supabase.from("conversations").select("id, user_id, created_at").limit(10000),
        supabase.from("messages").select("id, user_id, created_at").limit(50000),
        supabase.from("wallet_links").select("user_id, wallet_address, created_at").limit(10000),
        // Only count platform-originated transactions. Helius webhook rows
        // are tagged metadata.via = "helius_webhook" and would inflate volume.
        supabase
          .from("tx_events")
          .select("kind, value_usd, created_at")
          .or("metadata->>via.is.null,metadata->>via.neq.helius_webhook")
          .limit(50000),
        supabase.from("app_counters").select("key, value"),
        // Cached lifetime totals — refreshed every 5 min by pg_cron, used as
        // an authoritative floor when row queries hit the 1k–50k limits.
        supabase.rpc("admin_get_stats_summary"),
      ]);

      const profiles = (profilesRes.data ?? []) as ProfileLite[];
      const conversations = (convsRes.data ?? []) as ConvLite[];
      const messages = (messagesRes.data ?? []) as MsgLite[];
      const wallets = (walletsRes.data ?? []) as WalletLite[];
      const txs = (txRes.data ?? []) as TxLite[];
      const counters = Object.fromEntries(
        ((countersRes.data ?? []) as Array<{ key: string; value: number }>).map((c) => [c.key, Number(c.value)]),
      );
      const summaryRow = Array.isArray(summaryRes.data) ? summaryRes.data[0] : null;
      const summary = summaryRow
        ? {
            total_users: Number(summaryRow.total_users ?? 0),
            onboarded_users: Number(summaryRow.onboarded_users ?? 0),
            total_conversations: Number(summaryRow.total_conversations ?? 0),
            total_messages: Number(summaryRow.total_messages ?? 0),
            total_wallet_links: Number(summaryRow.total_wallet_links ?? 0),
            unique_linked_wallets: Number(summaryRow.unique_linked_wallets ?? 0),
            total_txs: Number(summaryRow.total_txs ?? 0),
            total_volume_usd: Number(summaryRow.total_volume_usd ?? 0),
            total_treasury_usd: Number(summaryRow.total_treasury_usd ?? 0),
            refreshed_at: String(summaryRow.refreshed_at ?? ""),
          }
        : null;

      setRaw({ profiles, conversations, messages, wallets, txs, counters, summary });
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

  const stats: StatsData | null = useMemo(() => {
    if (!raw) return null;
    const { profiles, conversations, messages, wallets, txs, counters, summary } = raw;

    // Earliest known timestamp anchors "All time" sparkline.
    const allTimes = [
      ...profiles.map((p) => new Date(p.created_at).getTime()),
      ...conversations.map((c) => new Date(c.created_at).getTime()),
      ...messages.map((m) => new Date(m.created_at).getTime()),
      ...txs.map((t) => new Date(t.created_at).getTime()),
    ].filter((n) => Number.isFinite(n));
    const earliest = allTimes.length > 0 ? Math.min(...allTimes) : Date.now() - 30 * 86400000;

    const { from, to } = rangeBounds(range, customRange, earliest);
    const inRange = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= from && t <= to;
    };

    // Lifetime totals: prefer the cached summary (authoritative count from
    // the materialized view) and fall back to row counts / counters.
    const totalConversationsEver = Math.max(
      summary?.total_conversations ?? 0,
      counters.conversations_created_total ?? 0,
      conversations.length,
    );
    const totalMessagesEver = Math.max(
      summary?.total_messages ?? 0,
      counters.messages_created_total ?? 0,
      messages.length,
    );

    const profilesInRange = profiles.filter((p) => inRange(p.created_at));
    const messagesInRange = messages.filter((m) => inRange(m.created_at));
    const conversationsInRange = conversations.filter((c) => inRange(c.created_at));
    const walletsInRange = wallets.filter((w) => inRange(w.created_at));
    const txsInRange = txs.filter((t) => inRange(t.created_at));

    // Sparkline buckets across the active window. Hourly under 48h, else daily.
    const span = Math.max(1, to - from);
    const bucketMs = span <= 48 * 60 * 60 * 1000 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const bucketCount = Math.min(60, Math.max(2, Math.ceil(span / bucketMs)));
    const stepMs = span / bucketCount;
    const dayBuckets: { date: string; count: number }[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const start = from + i * stepMs;
      const d = new Date(start);
      const key = bucketMs >= 24 * 60 * 60 * 1000
        ? d.toISOString().slice(0, 10)
        : `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
      dayBuckets.push({ date: key, count: 0 });
    }
    for (const p of profilesInRange) {
      const t = new Date(p.created_at).getTime();
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((t - from) / stepMs)));
      dayBuckets[idx].count += 1;
    }

    const activeUserSet = new Set(messagesInRange.map((m) => m.user_id));

    const txByKind: Record<string, { count: number; valueUsd: number }> = {};
    let totalVolumeUsd = 0;
    for (const t of txsInRange) {
      const bucket = (txByKind[t.kind] ??= { count: 0, valueUsd: 0 });
      bucket.count += 1;
      bucket.valueUsd += t.value_usd ?? 0;
      totalVolumeUsd += t.value_usd ?? 0;
    }

    // Onboarding breakdowns count only profiles created in the active range.
    const tally = (key: "experience" | "risk_tolerance") => {
      const counts = new Map<string, number>();
      for (const p of profilesInRange) {
        const v = p[key];
        if (!v) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    };
    const interestCounts = new Map<string, number>();
    for (const p of profilesInRange) {
      for (const i of p.interests ?? []) {
        interestCounts.set(i, (interestCounts.get(i) ?? 0) + 1);
      }
    }
    const topInterests = [...interestCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      totalUsers: profilesInRange.length,
      onboardedUsers: profilesInRange.filter((p) => p.onboarding_completed).length,
      signupsInRange: profilesInRange.length,
      signupsByDay: dayBuckets,
      activeConversations: conversationsInRange.length,
      totalConversationsEver,
      activeMessages: messagesInRange.length,
      totalMessagesEver,
      messagesInRange: messagesInRange.length,
      activeUsersInRange: activeUserSet.size,
      totalWalletLinks: walletsInRange.length,
      uniqueLinkedWallets: new Set(walletsInRange.map((w) => w.wallet_address)).size,
      totalTxs: txsInRange.length,
      txByKind,
      totalVolumeUsd,
      experienceBreakdown: tally("experience"),
      riskBreakdown: tally("risk_tolerance"),
      topInterests,
    };
  }, [raw, range, customRange]);

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
  const avgMessages = stats.totalUsers > 0
    ? (stats.messagesInRange / stats.totalUsers).toFixed(1)
    : "0";

  const expLabel = Object.fromEntries(EXPERIENCE_OPTIONS.map((o) => [o.value, o.label]));
  const riskLabel = Object.fromEntries(RISK_OPTIONS.map((o) => [o.value, o.label]));
  const interestLabel = Object.fromEntries(INTEREST_OPTIONS.map((o) => [o.value, o.label]));

  const rangeLabel = range === "custom"
    ? customRange?.from
      ? `${format(customRange.from, "MMM d")}${customRange.to ? ` – ${format(customRange.to, "MMM d")}` : ""}`
      : "Custom"
    : RANGE_OPTIONS.find((r) => r.value === range)?.label ?? "All time";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Overview</h2>
          <p className="text-xs text-muted-foreground/70">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={range}
            onValueChange={(v: RangeKey) => {
              setRange(v);
              if (v !== "custom") setCustomRange(undefined);
              if (v === "custom") setCalendarOpen(true);
            }}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
              <SelectItem value="custom" className="text-xs">Custom range…</SelectItem>
            </SelectContent>
          </Select>
          {range === "custom" && (
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {customRange?.from
                    ? customRange.to
                      ? `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d")}`
                      : format(customRange.from, "MMM d, yyyy")
                    : "Pick dates"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0">
                <Calendar
                  mode="range"
                  selected={customRange}
                  onSelect={setCustomRange}
                  numberOfMonths={2}
                  defaultMonth={customRange?.from ?? new Date()}
                />
              </PopoverContent>
            </Popover>
          )}
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Top-line numbers */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Users"
          value={stats.totalUsers.toLocaleString()}
          hint={`${stats.signupsInRange} signups in range`}
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
            value={stats.activeConversations.toLocaleString()}
            hint={`${stats.totalConversationsEver.toLocaleString()} lifetime`}
          />
          <StatCard
            icon={MessageSquare}
            label="Messages"
            value={stats.messagesInRange.toLocaleString()}
            hint={`${stats.totalMessagesEver.toLocaleString()} lifetime`}
          />
          <StatCard
            icon={BarChart3}
            label="Avg msgs / user"
            value={avgMessages}
          />
          <StatCard
            icon={Users}
            label="Active users"
            value={stats.activeUsersInRange.toLocaleString()}
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
            No transactions in this range.
          </p>
        ) : null}
      </div>

      {/* Signups sparkline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Signups · {rangeLabel.toLowerCase()}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SignupsSparkline data={stats.signupsByDay} />
          <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>{stats.signupsByDay[0]?.date}</span>
            <span>{stats.signupsByDay[stats.signupsByDay.length - 1]?.date}</span>
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

/* ------------------------------- Emails tab ------------------------------- */

type EmailLogRow = {
  id: string;
  message_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

const EMAIL_RANGE_OPTIONS: { value: "1d" | "7d" | "30d"; label: string }[] = [
  { value: "1d", label: "Last 24h" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  sent: "default",
  pending: "secondary",
  failed: "destructive",
  dlq: "destructive",
  bounced: "destructive",
  complained: "destructive",
  suppressed: "outline",
};

const EmailsTab = () => {
  const [rows, setRows] = useState<EmailLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"1d" | "7d" | "30d">("7d");
  const [templateFilter, setTemplateFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
    const from = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabase
      .from("email_send_log")
      .select("id, message_id, template_name, recipient_email, status, error_message, created_at")
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) {
      toast({ title: "Failed to load emails", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as EmailLogRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [range]);

  // Deduplicate by message_id, keeping latest row (rows are already DESC).
  const deduped = useMemo(() => {
    const seen = new Set<string>();
    const out: EmailLogRow[] = [];
    for (const r of rows) {
      const key = r.message_id ?? r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [rows]);

  const templates = useMemo(
    () => Array.from(new Set(deduped.map((r) => r.template_name))).sort(),
    [deduped],
  );

  const filtered = useMemo(() => {
    return deduped.filter((r) => {
      if (templateFilter !== "all" && r.template_name !== templateFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [deduped, templateFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: deduped.length,
    sent: deduped.filter((r) => r.status === "sent").length,
    failed: deduped.filter((r) => ["failed", "dlq", "bounced", "complained"].includes(r.status)).length,
    suppressed: deduped.filter((r) => r.status === "suppressed").length,
  }), [deduped]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard icon={Mail} label="Total" value={stats.total.toLocaleString()} />
        <StatCard icon={MailCheck} label="Sent" value={stats.sent.toLocaleString()} />
        <StatCard icon={AlertTriangle} label="Failed" value={stats.failed.toLocaleString()} />
        <StatCard icon={ShieldOff} label="Suppressed" value={stats.suppressed.toLocaleString()} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={range} onValueChange={(v: "1d" | "7d" | "30d") => setRange(v)}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {EMAIL_RANGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={templateFilter} onValueChange={setTemplateFilter}>
          <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="All templates" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All templates</SelectItem>
            {templates.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All statuses</SelectItem>
            <SelectItem value="sent" className="text-xs">Sent</SelectItem>
            <SelectItem value="pending" className="text-xs">Pending</SelectItem>
            <SelectItem value="failed" className="text-xs">Failed</SelectItem>
            <SelectItem value="dlq" className="text-xs">DLQ</SelectItem>
            <SelectItem value="suppressed" className="text-xs">Suppressed</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load} className="ml-auto h-8">
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No emails in this range.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.slice(0, 200).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{format(new Date(r.created_at), "MMM d HH:mm")}</TableCell>
                    <TableCell className="text-xs font-medium">{r.template_name}</TableCell>
                    <TableCell className="text-xs">{shortEmail(r.recipient_email)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-xs">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={r.error_message ?? ""}>
                      {r.error_message ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {filtered.length > 200 ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing 200 of {filtered.length}. Narrow your filters to see more.
        </p>
      ) : null}
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
  const [namesByUser, setNamesByUser] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [chainFilter, setChainFilter] = useState<"all" | "solana" | "ethereum">("all");
  const [kindFilter, setKindFilter] = useState<"all" | TreasuryFee["source_kind"]>("all");
  const [range, setRange] = useState<RangeKey>("all");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);

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
      const rows = (data ?? []) as TreasuryFee[];
      setFees(rows);
      // Backfill display names for any fee tied to a known user. Admin RLS
      // on profiles lets us read across all users in one shot.
      const ids = Array.from(
        new Set(rows.map((r) => r.related_user_id).filter((v): v is string => !!v)),
      );
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", ids);
        const map: Record<string, string | null> = {};
        for (const p of (profs ?? []) as { user_id: string; display_name: string | null }[]) {
          map[p.user_id] = p.display_name;
        }
        setNamesByUser(map);
      } else {
        setNamesByUser({});
      }
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

  const dateBounds = useMemo(() => {
    const earliest = fees.length > 0
      ? new Date(fees[fees.length - 1].block_time).getTime()
      : Date.now() - 30 * 86400000;
    return rangeBounds(range, customRange, earliest);
  }, [fees, range, customRange]);

  const inDateRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= dateBounds.from && t <= dateBounds.to;
  };

  const filtered = useMemo(() => {
    return fees.filter((f) => {
      if (chainFilter !== "all" && f.chain !== chainFilter) return false;
      if (kindFilter !== "all" && f.source_kind !== kindFilter) return false;
      if (!inDateRange(f.block_time)) return false;
      return true;
    });
  }, [fees, chainFilter, kindFilter, dateBounds]);

  const totals = useMemo(() => {
    const inRange = fees.filter((f) => inDateRange(f.block_time));
    const sum = (rows: TreasuryFee[]) => rows.reduce((acc, r) => acc + (r.amount_usd ?? 0), 0);
    return {
      all: sum(inRange),
      sol: sum(inRange.filter((f) => f.chain === "solana")),
      eth: sum(inRange.filter((f) => f.chain === "ethereum")),
      count: inRange.length,
    };
  }, [fees, dateBounds]);

  const rangeLabel = range === "custom"
    ? customRange?.from
      ? `${format(customRange.from, "MMM d")}${customRange.to ? ` – ${format(customRange.to, "MMM d")}` : ""}`
      : "Custom"
    : RANGE_OPTIONS.find((r) => r.value === range)?.label ?? "All time";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Treasury revenue</h2>
          <p className="text-xs text-muted-foreground/70">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={range}
            onValueChange={(v: RangeKey) => {
              setRange(v);
              if (v !== "custom") setCustomRange(undefined);
              if (v === "custom") setCalendarOpen(true);
            }}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
              <SelectItem value="custom" className="text-xs">Custom range…</SelectItem>
            </SelectContent>
          </Select>
          {range === "custom" && (
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {customRange?.from
                    ? customRange.to
                      ? `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d")}`
                      : format(customRange.from, "MMM d, yyyy")
                    : "Pick dates"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0">
                <Calendar
                  mode="range"
                  selected={customRange}
                  onSelect={setCustomRange}
                  numberOfMonths={2}
                  defaultMonth={customRange?.from ?? new Date()}
                />
              </PopoverContent>
            </Popover>
          )}
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

      <div className="flex flex-wrap items-center gap-1">
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
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
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    No fees recorded yet. Press "Refresh" to backfill from sweeps and the ETH treasury.
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
                    <TableCell className="text-xs">
                      {f.related_user_id ? (
                        namesByUser[f.related_user_id] ?? (
                          <span className="font-mono text-muted-foreground">
                            {f.related_user_id.slice(0, 6)}…
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
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
  const [resendingId, setResendingId] = useState<string | null>(null);

  // The two clickable-pill dialogs share open state via the focused user id.
  const [onboardingFor, setOnboardingFor] = useState<ProfileRow | null>(null);
  const [walletsFor, setWalletsFor] = useState<ProfileRow | null>(null);

  const resendWelcome = async (p: ProfileRow) => {
    const email = emails[p.user_id];
    if (!email) {
      toast({ title: "No email on file", variant: "destructive" });
      return;
    }
    setResendingId(p.user_id);
    try {
      const name = p.display_name ?? email.split("@")[0];
      // Use a fresh idempotency key each time so admin re-sends bypass the
      // server-side dedupe and actually deliver another email.
      const idempotencyKey = `welcome-resend-${p.user_id}-${Date.now()}`;
      const { error } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "welcome",
          recipientEmail: email,
          idempotencyKey,
          templateData: { name },
        },
      });
      if (error) throw error;
      toast({ title: "Welcome email resent", description: shortEmail(email) });
    } catch (e) {
      toast({
        title: "Resend failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResendingId(null);
    }
  };

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
    return profiles.filter((p) => {
      const e = emails[p.user_id];
      // Don't match synthetic wallet emails — they'd produce confusing hits
      // when an admin searches for a real domain like "gmail".
      const realEmail = isWalletSyntheticEmail(e) ? undefined : e;
      return (
        p.display_name?.toLowerCase().includes(q) ||
        p.user_id.toLowerCase().includes(q) ||
        realEmail?.toLowerCase().includes(q)
      );
    });
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : null}
              {!loading && filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : null}
              {filtered.map((p) => {
                const rawEmail = emails[p.user_id];
                // Wallet-only signups carry a synthetic `<wallet>@wallet.vision.local`
                // address — surface that as a "Wallet only" badge so admins
                // don't think it's a real inbox or try to email it.
                const isSynthetic = isWalletSyntheticEmail(rawEmail);
                const email = isSynthetic ? undefined : rawEmail;
                const wallets = walletsByUser[p.user_id] ?? [];
                const isResending = resendingId === p.user_id;
                return (
                  <TableRow key={p.user_id}>
                    <TableCell className="font-medium">
                      {p.display_name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {email ? (
                        <CopyId value={email} label={shortEmail(email)} />
                      ) : isSynthetic ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                          <Wallet className="h-3 w-3" />
                          Wallet only
                        </span>
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
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resendWelcome(p)}
                        disabled={!email || isResending}
                        title={
                          email
                            ? "Resend the welcome email"
                            : isSynthetic
                              ? "Wallet-only account — no email on file"
                              : "No email on file"
                        }
                      >
                        {isResending ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <MailPlus className="mr-1 h-3.5 w-3.5" />
                        )}
                        Resend welcome
                      </Button>
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

type AuditRow = {
  id: string;
  actor_id: string | null;
  target_id: string;
  role: string;
  action: string;
  created_at: string;
};

const RolesTab = () => {
  const { user } = useAuth();
  const { isSuperAdmin, loading: superLoading } = useIsSuperAdmin();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [nameByUserId, setNameByUserId] = useState<Record<string, string | null>>({});
  const [emailByUserId, setEmailByUserId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [granting, setGranting] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  // Typed-confirm dialog state — admin must type the matching user id to
  // confirm. Stops fat-finger promotions caused by clipboard slip-ups.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const load = async () => {
    setLoading(true);
    const [rolesRes, profilesRes, auditRes] = await Promise.all([
      supabase.from("user_roles").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("user_id, display_name"),
      supabase.from("role_audit_log").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (rolesRes.error) {
      toast({ title: "Failed to load roles", description: rolesRes.error.message, variant: "destructive" });
    } else {
      setRoles((rolesRes.data ?? []) as RoleRow[]);
    }
    if (!auditRes.error && auditRes.data) {
      setAudit(auditRes.data as AuditRow[]);
    }
    if (!profilesRes.error && profilesRes.data) {
      const map: Record<string, string | null> = {};
      for (const p of profilesRes.data as { user_id: string; display_name: string | null }[]) {
        map[p.user_id] = p.display_name;
      }
      setNameByUserId(map);
    }
    // Hydrate emails for actor/target chips on the audit log.
    const ids = Array.from(
      new Set([
        ...((rolesRes.data ?? []) as RoleRow[]).map((r) => r.user_id),
        ...((auditRes.data ?? []) as AuditRow[]).flatMap((a) => [a.actor_id, a.target_id].filter((v): v is string => !!v)),
      ]),
    );
    if (ids.length > 0) {
      const { data: emails } = await supabase.rpc("admin_get_user_emails", { _user_ids: ids });
      if (emails) {
        const m: Record<string, string> = {};
        for (const r of emails as { user_id: string; email: string | null }[]) {
          if (r.email) m[r.user_id] = r.email;
        }
        setEmailByUserId(m);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openConfirm = () => {
    const id = newUserId.trim();
    if (!id) return;
    setConfirmText("");
    setConfirmOpen(true);
  };

  const grant = async () => {
    const id = newUserId.trim();
    if (!id) return;
    setGranting(true);
    const { error } = await supabase.from("user_roles").insert({ user_id: id, role: "admin" });
    setGranting(false);
    setConfirmOpen(false);
    if (error) {
      toast({ title: "Could not grant", description: error.message, variant: "destructive" });
      return;
    }
    setNewUserId("");
    setConfirmText("");
    toast({ title: "Admin granted" });
    load();
  };

  const revoke = async (row: RoleRow) => {
    if (row.user_id === user?.id) {
      toast({ title: "Refusing to revoke your own role", variant: "destructive" });
      return;
    }
    if (row.role === "super_admin") {
      toast({ title: "Super admin role is protected", variant: "destructive" });
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

  // Preview chunk for typed confirmation — show last 6 chars of pasted ID
  // along with the matching user's name/email if known.
  const targetName = nameByUserId[newUserId.trim()] ?? null;
  const targetEmail = emailByUserId[newUserId.trim()] ?? null;
  const confirmExpected = newUserId.trim().slice(-6);

  return (
    <div className="space-y-4">
      {/* Only super admins can manage roles. Regular admins see a read-only
          notice and the role list. The DB enforces the same rule via RLS. */}
      {superLoading ? null : isSuperAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Grant admin</CardTitle>
            <p className="text-xs text-muted-foreground">
              Only super admins can grant or revoke roles. Pasted user must already exist.
            </p>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              placeholder="User ID (UUID from Users tab)"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              className="font-mono text-xs"
            />
            <Button onClick={openConfirm} disabled={granting || !newUserId.trim()}>
              {granting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Shield className="mr-1 h-3.5 w-3.5" />}
              Grant
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-start gap-2 py-3 text-xs text-muted-foreground">
            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Role management is restricted to super admins. You can view roles below
              but can't grant or revoke them.
            </span>
          </CardContent>
        </Card>
      )}

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
                const isProtected = r.role === "super_admin";
                const isSelf = r.user_id === user?.id;
                // Disable the revoke button for: self, super_admin rows,
                // or non-super-admin viewers (RLS would also reject).
                const canRevoke = isSuperAdmin && !isSelf && !isProtected;
                return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {name ?? <span className="text-muted-foreground">Unknown</span>}
                    {isSelf ? (
                      <Badge variant="outline" className="ml-2 text-[10px]">You</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <CopyId value={r.user_id} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={isProtected ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {isProtected ? "super admin" : r.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(r)}
                      disabled={!canRevoke}
                      title={
                        isProtected
                          ? "Super admin role is protected"
                          : isSelf
                            ? "You can't revoke your own role"
                            : !isSuperAdmin
                              ? "Only super admins can revoke roles"
                              : undefined
                      }
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

      {/* Audit log — last 50 grant/revoke actions, viewable by all admins. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <History className="h-3.5 w-3.5" /> Recent role changes
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Last 50 grants and revocations. Recorded automatically.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                    No role changes recorded yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {audit.map((a) => {
                const targetLabel = nameByUserId[a.target_id] ?? emailByUserId[a.target_id] ?? shortId(a.target_id);
                const actorLabel = a.actor_id
                  ? nameByUserId[a.actor_id] ?? emailByUserId[a.actor_id] ?? shortId(a.actor_id)
                  : "system";
                return (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs">{format(new Date(a.created_at), "MMM d HH:mm")}</TableCell>
                    <TableCell>
                      <Badge variant={a.action === "grant" ? "default" : "secondary"} className="text-xs">
                        {a.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{a.role}</TableCell>
                    <TableCell className="text-xs">{targetLabel}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{actorLabel}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Typed-confirm dialog — admin must retype the last 6 chars of the
          user id before the grant goes through. Stops accidental promotions. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grant admin role?</AlertDialogTitle>
            <AlertDialogDescription>
              You're about to grant <strong>admin</strong> access to{" "}
              <span className="font-medium">{targetName ?? targetEmail ?? "this user"}</span>
              {targetEmail ? <> (<span className="font-mono text-xs">{shortEmail(targetEmail)}</span>)</> : null}.
              Admins can read all user data, treasury, and email logs.
              Type <span className="font-mono text-xs">{confirmExpected}</span> (last 6 chars of their user id) to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={confirmExpected}
            className="font-mono text-xs"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={grant}
              disabled={granting || confirmText.trim() !== confirmExpected}
            >
              {granting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Confirm grant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Admin;
