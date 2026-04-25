DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'super_admin'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'super_admin';
  END IF;
END$$;