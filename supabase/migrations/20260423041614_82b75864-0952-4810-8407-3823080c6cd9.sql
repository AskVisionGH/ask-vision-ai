ALTER TABLE public.conversations
ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_conversations_user_pinned_updated
ON public.conversations (user_id, pinned DESC, updated_at DESC);