-- Allowed share modes
DO $$ BEGIN
  CREATE TYPE public.share_mode AS ENUM ('read_only', 'importable');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add the column. Default to read_only so existing shares keep current behaviour.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS share_mode public.share_mode NOT NULL DEFAULT 'read_only';