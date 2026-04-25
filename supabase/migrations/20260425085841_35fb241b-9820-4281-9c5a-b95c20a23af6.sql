-- Daniel only needs the super_admin row; the duplicate admin row was left
-- behind from before super_admin existed and the UI now treats super_admin
-- as implying admin (see useIsAdmin hook).
DELETE FROM public.user_roles
WHERE user_id = 'dc7caa9a-ff7d-4af8-9106-19a2f8a2696f'
  AND role = 'admin';