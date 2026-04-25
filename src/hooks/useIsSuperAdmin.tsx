import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Tells you whether the signed-in user has the protected `super_admin` role.
 *
 * Super admins are the only accounts allowed to grant or revoke roles via
 * the app — regular admins only get read access to the Roles tab and the
 * usual admin-panel features. The DB enforces this with RLS policies on
 * `user_roles`; this hook exists purely to gate the UI.
 */
export const useIsSuperAdmin = () => {
  const { user, loading: authLoading } = useAuth();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsSuperAdmin(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "super_admin")
        .maybeSingle();
      if (cancelled) return;
      setIsSuperAdmin(!error && !!data);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return { isSuperAdmin, loading: loading || authLoading };
};
