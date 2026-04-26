ALTER TABLE public.notification_preferences
ADD COLUMN IF NOT EXISTS chat_push_prompt_seen BOOLEAN NOT NULL DEFAULT false;