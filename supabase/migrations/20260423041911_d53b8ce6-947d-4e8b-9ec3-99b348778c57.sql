ALTER TABLE public.conversations
ADD COLUMN pin_order INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS idx_conversations_user_pinned_updated;

CREATE INDEX idx_conversations_user_pinned_order_updated
ON public.conversations (user_id, pinned DESC, pin_order ASC, updated_at DESC);