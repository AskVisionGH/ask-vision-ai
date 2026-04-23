import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { ChatMessage, ToolEvent } from "@/lib/chat-stream";

export interface ConversationRow {
  id: string;
  title: string;
  wallet_address: string | null;
  pinned: boolean;
  pin_order: number;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  tool_events: ToolEvent[] | null;
  created_at: string;
}

/** Subscribes to the user's conversations, sorted newest first. */
export const useConversations = () => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setConversations([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, wallet_address, pinned, created_at, updated_at")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });
    if (!error && data) setConversations(data as ConversationRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const createConversation = useCallback(
    async (walletAddress: string | null): Promise<ConversationRow | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          wallet_address: walletAddress,
          title: "New chat",
        })
        .select("id, title, wallet_address, pinned, created_at, updated_at")
        .single();
      if (error || !data) return null;
      const row = data as ConversationRow;
      setConversations((prev) => [row, ...prev]);
      return row;
    },
    [user],
  );

  const renameConversation = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)),
    );
    await supabase.from("conversations").update({ title: trimmed }).eq("id", id);
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    await supabase.from("conversations").delete().eq("id", id);
  }, []);

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    setConversations((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, pinned } : c));
      // Re-sort: pinned first, then by updated_at desc
      return next.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updated_at.localeCompare(a.updated_at);
      });
    });
    await supabase
      .from("conversations")
      .update({ pinned } as never)
      .eq("id", id);
  }, []);

  return {
    conversations,
    loading,
    refresh,
    createConversation,
    renameConversation,
    deleteConversation,
    togglePin,
  };
};

/** Loads all messages for a single conversation, normalised into ChatMessage shape. */
export const fetchMessages = async (conversationId: string): Promise<ChatMessage[]> => {
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, tool_events, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    role: row.role as ChatMessage["role"],
    content: row.content ?? "",
    toolEvents: (row.tool_events as ToolEvent[] | null) ?? undefined,
  }));
};

/** Persists one chat message for the current user. Returns true on success. */
export const saveMessage = async (
  conversationId: string,
  userId: string,
  msg: ChatMessage,
): Promise<boolean> => {
  const { error } = await supabase.from("messages").insert([
    {
      conversation_id: conversationId,
      user_id: userId,
      role: msg.role,
      content: msg.content,
      tool_events: (msg.toolEvents ?? null) as never,
    },
  ]);
  return !error;
};

/** Auto-titles a conversation from its first user prompt. */
export const autoTitleConversation = async (id: string, firstMessage: string) => {
  const cleaned = firstMessage.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!cleaned) return;
  await supabase
    .from("conversations")
    .update({ title: cleaned })
    .eq("id", id)
    .eq("title", "New chat"); // only overwrite the default
};
