import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Module-level cache of the admin lookup result, keyed by user id.
 *
 * Without this, every page navigation remounts `useIsAdmin`, which re-runs
 * the role query and briefly returns `isAdmin: false` — causing the Admin
 * nav row in the sidebar to flicker / repaint on each route change.
 *
 * Roles change very rarely, so we cache the answer for the lifetime of the
 * tab and reuse it synchronously on subsequent mounts.
 */
const adminCache = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();

export const useIsAdmin = () => {
  const { user, loading: authLoading } = useAuth();

  const cached = user ? adminCache.get(user.id) : undefined;
  const [isAdmin, setIsAdmin] = useState<boolean>(cached ?? false);
  const [loading, setLoading] = useState<boolean>(cached === undefined);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    // Hit cache synchronously — no flicker on remount.
    const hit = adminCache.get(user.id);
    if (hit !== undefined) {
      setIsAdmin(hit);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const promise =
      inflight.get(user.id) ??
      (async () => {
        // Super admins implicitly have admin access — treat either role as admin.
        const { data, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .in("role", ["admin", "super_admin"]);
        const result = !error && !!data && data.length > 0;
        adminCache.set(user.id, result);
        inflight.delete(user.id);
        return result;
      })();
    inflight.set(user.id, promise);

    promise.then((result) => {
      if (cancelled) return;
      setIsAdmin(result);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return { isAdmin, loading: loading || authLoading };
};
