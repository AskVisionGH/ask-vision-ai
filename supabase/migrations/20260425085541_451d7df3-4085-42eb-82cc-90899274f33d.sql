-- Grant super_admin to Daniel; keep existing admin row so existing
-- has_role(_, 'admin') checks (admin-panel access etc.) keep working.
INSERT INTO public.user_roles (user_id, role)
VALUES ('dc7caa9a-ff7d-4af8-9106-19a2f8a2696f', 'super_admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- Replace INSERT/DELETE policies on user_roles.
DROP POLICY IF EXISTS "Admins can grant roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can revoke roles" ON public.user_roles;

CREATE POLICY "Super admins can grant roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins can revoke non-super roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin')
  AND role <> 'super_admin'
);