import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface PushDeviceRow {
  id: string;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
}

/**
 * Lists the current user's registered browser push subscriptions so they can
 * audit and revoke them from the Alerts → Devices tab.
 */
export const usePushDevices = () => {
  const { user } = useAuth();
  const [devices, setDevices] = useState<PushDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setDevices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, user_agent, created_at, last_used_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setDevices((data as PushDeviceRow[] | null) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (endpoint: string): Promise<boolean> => {
      const { error } = await supabase.functions.invoke("push-unsubscribe", {
        body: { endpoint },
      });
      if (error) return false;
      setDevices((cur) => cur.filter((d) => d.endpoint !== endpoint));
      return true;
    },
    [],
  );

  return { devices, loading, refresh: load, remove };
};
