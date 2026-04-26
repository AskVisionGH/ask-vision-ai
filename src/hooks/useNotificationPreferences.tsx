import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface NotificationPreferences {
  master_enabled: boolean;
  channel_in_app: boolean;
  channel_web_push: boolean;
  cat_price: boolean;
  cat_wallet_activity: boolean;
  cat_order_fills: boolean;
  cat_news_sentiment: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  quiet_timezone: string;
  post_order_prompt_seen: boolean;
  chat_push_prompt_seen: boolean;
}

const DEFAULTS: NotificationPreferences = {
  master_enabled: false,
  channel_in_app: true,
  channel_web_push: true,
  cat_price: false,
  cat_wallet_activity: false,
  cat_order_fills: false,
  cat_news_sentiment: false,
  quiet_hours_enabled: false,
  quiet_start: null,
  quiet_end: null,
  quiet_timezone:
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : "UTC",
  post_order_prompt_seen: false,
  chat_push_prompt_seen: false,
};

/**
 * Reads and updates the user's `notification_preferences` row.
 * Lazily inserts a default row the first time a user touches the panel.
 */
export const useNotificationPreferences = () => {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setPrefs(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data) {
      setPrefs({
        master_enabled: data.master_enabled,
        channel_in_app: data.channel_in_app,
        channel_web_push: data.channel_web_push,
        cat_price: data.cat_price,
        cat_wallet_activity: data.cat_wallet_activity,
        cat_order_fills: data.cat_order_fills,
        cat_news_sentiment: data.cat_news_sentiment,
        quiet_hours_enabled: data.quiet_hours_enabled,
        quiet_start: data.quiet_start,
        quiet_end: data.quiet_end,
        quiet_timezone: data.quiet_timezone,
        post_order_prompt_seen: data.post_order_prompt_seen,
      });
    } else {
      setPrefs(DEFAULTS);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback(
    async (patch: Partial<NotificationPreferences>): Promise<boolean> => {
      if (!user || !prefs) return false;
      const next = { ...prefs, ...patch };
      // Optimistic update so toggles feel instant.
      setPrefs(next);
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(
          { user_id: user.id, ...next },
          { onConflict: "user_id" },
        );
      if (error) {
        // Roll back on failure.
        setPrefs(prefs);
        return false;
      }
      return true;
    },
    [user, prefs],
  );

  return { prefs, loading, update, refresh: load };
};
