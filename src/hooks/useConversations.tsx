import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { ChatMessage, ToolEvent } from "@/lib/chat-stream";

export type ShareMode = "read_only" | "importable";

export interface ConversationRow {
  id: string;
  title: string;
  wallet_address: string | null;
  pinned: boolean;
  pin_order: number;
  share_id: string | null;
  share_mode: ShareMode;
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

const CONVO_COLS =
  "id, title, wallet_address, pinned, pin_order, share_id, share_mode, created_at, updated_at";

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
      .select(CONVO_COLS)
      .order("pinned", { ascending: false })
      .order("pin_order", { ascending: true })
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
        .select(CONVO_COLS)
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
    let newOrder = 0;
    setConversations((prev) => {
      // When pinning, place at the end of the pinned list (highest order + 1).
      // When unpinning, order is irrelevant — reset to 0.
      if (pinned) {
        const maxOrder = prev
          .filter((c) => c.pinned)
          .reduce((m, c) => Math.max(m, c.pin_order), -1);
        newOrder = maxOrder + 1;
      }
      const next = prev.map((c) =>
        c.id === id ? { ...c, pinned, pin_order: pinned ? newOrder : 0 } : c,
      );
      return next.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.pinned && b.pinned) return a.pin_order - b.pin_order;
        return b.updated_at.localeCompare(a.updated_at);
      });
    });
    await supabase
      .from("conversations")
      .update({ pinned, pin_order: pinned ? newOrder : 0 } as never)
      .eq("id", id);
  }, []);

  /** Reorders the pinned conversations to the given id sequence. */
  const reorderPinned = useCallback(async (orderedIds: string[]) => {
    setConversations((prev) => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      const next = prev.map((c) =>
        orderMap.has(c.id) ? { ...c, pin_order: orderMap.get(c.id)! } : c,
      );
      return next.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.pinned && b.pinned) return a.pin_order - b.pin_order;
        return b.updated_at.localeCompare(a.updated_at);
      });
    });
    await Promise.all(
      orderedIds.map((id, i) =>
        supabase
          .from("conversations")
          .update({ pin_order: i } as never)
          .eq("id", id),
      ),
    );
  }, []);

  /**
   * Toggles a public share link for the conversation. When enabling, callers
   * pick `mode`: `read_only` (view only) or `importable` (viewer can copy it
   * into their own account). Unsharing clears the id; existing links stop
   * working.
   */
  const toggleShare = useCallback(
    async (
      id: string,
      share: boolean,
      mode: ShareMode = "read_only",
    ): Promise<string | null> => {
      const newShareId = share ? crypto.randomUUID() : null;
      const newMode: ShareMode = share ? mode : "read_only";
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, share_id: newShareId, share_mode: newMode } : c,
        ),
      );
      const { error } = await supabase
        .from("conversations")
        .update({ share_id: newShareId, share_mode: newMode } as never)
        .eq("id", id);
      if (error) {
        // Roll back optimistic update on failure.
        await refresh();
        return null;
      }
      return newShareId;
    },
    [refresh],
  );

  /**
   * Updates a conversation's title in local state without hitting the DB.
   * Used after autoTitleConversation persists an AI-generated title.
   */
  const applyTitleLocal = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c)),
    );
  }, []);

  return {
    conversations,
    loading,
    refresh,
    createConversation,
    renameConversation,
    deleteConversation,
    togglePin,
    reorderPinned,
    toggleShare,
    applyTitleLocal,
  };
};

/** Loads all messages for a single conversation, normalised into ChatMessage shape. */
export const fetchMessages = async (conversationId: string): Promise<ChatMessage[]> => {
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, tool_events, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    role: row.role as ChatMessage["role"],
    content: row.content ?? "",
    toolEvents: (row.tool_events as ToolEvent[] | null) ?? undefined,
    createdAt: row.created_at,
  }));
};

/** Persists one chat message for the current user. Returns the new row id (or null on failure). */
export const saveMessage = async (
  conversationId: string,
  userId: string,
  msg: ChatMessage,
): Promise<string | null> => {
  const { data, error } = await supabase
    .from("messages")
    .insert([
      {
        conversation_id: conversationId,
        user_id: userId,
        role: msg.role,
        content: msg.content,
        tool_events: (msg.toolEvents ?? null) as never,
      },
    ])
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id as string;
};

/**
 * Deletes every message in the conversation that was created at or after the
 * given timestamp. Used when a user edits a message — we throw away the
 * original + everything that followed before regenerating from that point.
 */
export const deleteMessagesFrom = async (
  conversationId: string,
  fromCreatedAt: string,
): Promise<boolean> => {
  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("conversation_id", conversationId)
    .gte("created_at", fromCreatedAt);
  return !error;
};

/**
 * Asks the AI to generate a concise title for a brand-new conversation,
 * persists it, and returns the title (or null on failure).
 * Only updates the row if it still has the default "New chat" title.
 */
export const autoTitleConversation = async (
  id: string,
  firstMessage: string,
): Promise<string | null> => {
  const cleaned = firstMessage.trim();
  if (!cleaned) return null;

  let title = cleaned.replace(/\s+/g, " ").slice(0, 40);
  try {
    const { data, error } = await supabase.functions.invoke("chat-title", {
      body: { message: cleaned },
    });
    if (!error && data?.title && typeof data.title === "string") {
      title = data.title;
    }
  } catch (e) {
    console.error("chat-title invoke failed:", e);
  }

  const { error } = await supabase
    .from("conversations")
    .update({ title })
    .eq("id", id)
    .eq("title", "New chat"); // only overwrite the default
  if (error) return null;
  return title;
};

/**
 * Searches the user's conversations by message content.
 * Returns the conversation ids that contain at least one matching message.
 */
export const searchConversationsByContent = async (
  userId: string,
  needle: string,
): Promise<Set<string>> => {
  const cleaned = needle.trim();
  if (!cleaned) return new Set();
  const { data, error } = await supabase
    .from("messages")
    .select("conversation_id")
    .eq("user_id", userId)
    .ilike("content", `%${cleaned}%`)
    .limit(500);
  if (error || !data) return new Set();
  return new Set(data.map((row) => row.conversation_id as string));
};
