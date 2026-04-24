import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

export type NotificationRow =
  Database["public"]["Tables"]["notifications"]["Row"];

/**
 * Live feed of the signed-in user's notifications.
 *
 * - Loads the most recent 30 on mount.
 * - Subscribes to realtime INSERT/UPDATE/DELETE on `public.notifications`
 *   scoped to the current user_id so the bell badge updates instantly.
 */
export function useNotifications() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const unreadCount = useMemo(
    () => items.filter((n) => !n.read_at).length,
    [items],
  );

  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (cancelled) return;
      if (!error && data) setItems(data);
      setLoading(false);
    })();

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as NotificationRow;
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev].slice(0, 30);
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as NotificationRow;
              return prev.map((n) => (n.id === row.id ? row : n));
            }
            if (payload.eventType === "DELETE") {
              const row = payload.old as NotificationRow;
              return prev.filter((n) => n.id !== row.id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const markRead = useCallback(
    async (id: string) => {
      if (!user) return;
      // Optimistic
      setItems((prev) =>
        prev.map((n) =>
          n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n,
        ),
      );
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id);
    },
    [user],
  );

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const unread = items.filter((n) => !n.read_at);
    if (unread.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);
  }, [items, user]);

  return { items, loading, unreadCount, markRead, markAllRead };
}
