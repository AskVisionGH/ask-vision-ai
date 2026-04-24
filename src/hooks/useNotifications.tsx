import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type NotificationCategory =
  | "price"
  | "wallet_activity"
  | "order_fills"
  | "news_sentiment";

export interface NotificationRow {
  id: string;
  user_id: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Subscribes to the current user's in-app notifications.
 * Keeps a local list + unread count and mirrors Postgres changes via the
 * Supabase realtime channel on `notifications`.
 */
export const useNotifications = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial fetch.
  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      setItems((data as NotificationRow[] | null) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Realtime stream.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setItems((cur) => [payload.new as NotificationRow, ...cur].slice(0, 50));
          } else if (payload.eventType === "UPDATE") {
            setItems((cur) =>
              cur.map((n) =>
                n.id === (payload.new as NotificationRow).id
                  ? (payload.new as NotificationRow)
                  : n,
              ),
            );
          } else if (payload.eventType === "DELETE") {
            setItems((cur) =>
              cur.filter((n) => n.id !== (payload.old as NotificationRow).id),
            );
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);

  const unreadCount = useMemo(
    () => items.filter((n) => !n.read_at).length,
    [items],
  );

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    setItems((cur) => cur.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);
  }, [user]);

  const markRead = useCallback(
    async (id: string) => {
      if (!user) return;
      const now = new Date().toISOString();
      setItems((cur) =>
        cur.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? now } : n)),
      );
      await supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("id", id)
        .eq("user_id", user.id);
    },
    [user],
  );

  return { items, loading, unreadCount, markAllRead, markRead };
};
