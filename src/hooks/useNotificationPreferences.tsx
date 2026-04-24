import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

export type NotificationPreferences =
  Database["public"]["Tables"]["notification_preferences"]["Row"];
type Update = Database["public"]["Tables"]["notification_preferences"]["Update"];

/**
 * Loads (and creates on first access) the user's notification_preferences row.
 * Use `update()` to patch any subset of columns.
 */
export function useNotificationPreferences() {
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

    const { data, error } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("load prefs failed", error);
      setPrefs(null);
      setLoading(false);
      return;
    }

    if (data) {
      setPrefs(data);
      setLoading(false);
      return;
    }

    // First time — create a row with DB defaults (all categories off, master off).
    // Detect the browser's IANA timezone for quiet-hours calculations.
    let tz = "UTC";
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) tz = detected;
    } catch {
      /* ignore */
    }
    const { data: created, error: insertErr } = await supabase
      .from("notification_preferences")
      .insert({ user_id: user.id, quiet_timezone: tz })
      .select("*")
      .single();
    if (insertErr) {
      console.error("create prefs failed", insertErr);
    }
    setPrefs(created ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(
    async (patch: Update) => {
      if (!user || !prefs) return;
      // Optimistic
      setPrefs({ ...prefs, ...patch } as NotificationPreferences);
      const { data, error } = await supabase
        .from("notification_preferences")
        .update(patch)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) {
        console.error("update prefs failed", error);
        // Re-sync from server
        load();
        return;
      }
      if (data) setPrefs(data);
    },
    [load, prefs, user],
  );

  return { prefs, loading, update, reload: load };
}
