-- Allow conversations to be shared via a public, unguessable URL.
-- Null = not shared. Setting/clearing it is how the owner toggles sharing.
ALTER TABLE public.conversations
ADD COLUMN share_id UUID UNIQUE;

CREATE INDEX idx_conversations_share_id ON public.conversations (share_id) WHERE share_id IS NOT NULL;

-- Public can read a conversation row only when it has a share_id set.
CREATE POLICY "Anyone can view shared conversations"
ON public.conversations
FOR SELECT
TO anon, authenticated
USING (share_id IS NOT NULL);

-- Public can read messages belonging to a shared conversation.
CREATE POLICY "Anyone can view messages in shared conversations"
ON public.messages
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND c.share_id IS NOT NULL
  )
);