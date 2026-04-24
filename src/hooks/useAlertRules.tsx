import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AlertRuleKind = "price" | "wallet_activity" | "portfolio_pnl";

export interface PriceRuleConfig {
  token_symbol: string;
  token_address?: string;
  direction: "above" | "below";
  threshold_usd: number;
}

export interface WalletRuleConfig {
  wallet_address: string;
  wallet_label?: string;
  min_value_usd: number;
}

export interface PortfolioRuleConfig {
  direction: "up" | "down" | "both";
  percent_change: number;
  window_hours: number;
}

export type AlertRuleConfig =
  | PriceRuleConfig
  | WalletRuleConfig
  | PortfolioRuleConfig;

export interface AlertRule {
  id: string;
  user_id: string;
  kind: AlertRuleKind;
  label: string;
  enabled: boolean;
  config: AlertRuleConfig;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewAlertRule {
  kind: AlertRuleKind;
  label: string;
  config: AlertRuleConfig;
  enabled?: boolean;
}

/**
 * CRUD hook for the user's custom alert rules.
 * Rules describe when to fire a Vision alert — the actual evaluation happens
 * in background jobs (price poller, wallet watcher, pnl cron) which will
 * insert into `notifications` when a rule matches.
 */
export const useAlertRules = () => {
  const { user } = useAuth();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setRules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
      const { data } = await supabase
        .from("alert_rules")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
    setRules((data as unknown as AlertRule[] | null) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (rule: NewAlertRule): Promise<AlertRule | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("alert_rules")
        .insert({
          user_id: user.id,
          kind: rule.kind,
          label: rule.label,
          enabled: rule.enabled ?? true,
          // Supabase JSON columns accept any shape — our typed union guards input.
          config: rule.config as unknown as Record<string, unknown>,
        })
        .select("*")
        .single();
      if (error || !data) return null;
      const row = data as AlertRule;
      setRules((cur) => [row, ...cur]);
      return row;
    },
    [user],
  );

  const update = useCallback(
    async (id: string, patch: Partial<AlertRule>): Promise<boolean> => {
      const updatePayload: Record<string, unknown> = {};
      if (patch.label !== undefined) updatePayload.label = patch.label;
      if (patch.enabled !== undefined) updatePayload.enabled = patch.enabled;
      if (patch.config !== undefined)
        updatePayload.config = patch.config as unknown as Record<string, unknown>;

      setRules((cur) =>
        cur.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
      const { error } = await supabase
        .from("alert_rules")
        .update(updatePayload)
        .eq("id", id);
      if (error) {
        void load();
        return false;
      }
      return true;
    },
    [load],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      setRules((cur) => cur.filter((r) => r.id !== id));
      const { error } = await supabase.from("alert_rules").delete().eq("id", id);
      if (error) {
        void load();
        return false;
      }
      return true;
    },
    [load],
  );

  return { rules, loading, refresh: load, create, update, remove };
};
