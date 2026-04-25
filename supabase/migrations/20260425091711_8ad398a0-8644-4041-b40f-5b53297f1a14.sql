-- The materialized view should never be reachable via PostgREST.
-- Revoke from the API roles. Admins use admin_get_stats_summary() instead.
REVOKE ALL ON public.admin_stats_summary FROM anon, authenticated;