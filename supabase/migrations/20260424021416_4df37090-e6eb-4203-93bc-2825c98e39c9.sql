ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'auto';