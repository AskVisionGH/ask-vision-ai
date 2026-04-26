import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Whether the current user has `admin` or `super_admin` in `user_roles`.
 *
 * Backed by React Query so the result is cached across page navigations —
 * without this, every page mount re-ran the role check and the Admin nav
 * row briefly disappeared/flashed when moving between pages.
 */
export const useIsAdmin = () => {
  const { user, loading: authLoading } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["is-admin", user?.id ?? null],
    enabled: !authLoading,
    // Roles change very rarely; keep the answer fresh across the whole session
    // so sidebar nav stays stable when navigating between pages.
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      if (!user) return false;
      // Super admins implicitly have admin access — no separate `admin` row
      // needed. Treat either role as admin so we can keep one row per user.
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "super_admin"]);
      if (error) return false;
      return !!data && data.length > 0;
    },
  });

  return {
    isAdmin: data ?? false,
    loading: authLoading || isLoading,
  };
};
