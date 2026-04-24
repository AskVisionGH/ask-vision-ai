import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ChatBubble } from "@/components/ChatBubble";
import { VisionLogo } from "@/components/VisionLogo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import type { ChatMessage, ToolEvent } from "@/lib/chat-stream";
import type { ShareMode } from "@/hooks/useConversations";

interface SharedConversation {
  id: string;
  title: string;
  share_mode: ShareMode;
  updated_at: string;
}

const SharedChat = () => {
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [convo, setConvo] = useState<SharedConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!shareId) {
      setStatus("missing");
      return;
    }

    (async () => {
      // 1. Look up the conversation by its public share id.
      const { data: conversation, error: convoErr } = await supabase
        .from("conversations")
        .select("id, title, share_mode, updated_at")
        .eq("share_id", shareId)
        .maybeSingle();

      if (cancelled) return;
      if (convoErr || !conversation) {
        setStatus("missing");
        return;
      }

      // 2. Pull its messages in chronological order. RLS allows anon reads
      //    only when the parent conversation has share_id set.
      const { data: msgs } = await supabase
        .from("messages")
        .select("id, role, content, tool_events, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      setConvo(conversation as SharedConversation);
      setMessages(
        (msgs ?? []).map((row) => ({
          id: row.id,
          role: row.role as ChatMessage["role"],
          content: row.content ?? "",
          toolEvents: (row.tool_events as ToolEvent[] | null) ?? undefined,
          createdAt: row.created_at,
        })),
      );
      setStatus("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [shareId]);

  /**
   * Copies the shared conversation (and all its messages) into the viewer's
   * own account, then navigates them to the new chat. Only enabled when the
   * owner set the share mode to `importable`.
   */
  const handleImport = async () => {
    if (!convo) return;
    if (!user) {
      navigate(`/auth?redirect=${encodeURIComponent(`/shared/${shareId}`)}`);
      return;
    }
    setImporting(true);
    try {
      const { data: newConvo, error: convoErr } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          title: convo.title,
        })
        .select("id")
        .single();
      if (convoErr || !newConvo) {
        toast.error("Couldn't import conversation");
        return;
      }

      if (messages.length > 0) {
        const rows = messages.map((m) => ({
          conversation_id: newConvo.id,
          user_id: user.id,
          role: m.role,
          content: m.content,
          tool_events: (m.toolEvents ?? null) as never,
        }));
        const { error: msgErr } = await supabase.from("messages").insert(rows);
        if (msgErr) {
          toast.error("Imported chat but messages failed to copy");
        }
      }

      toast.success("Conversation imported");
      navigate(`/chat?c=${newConvo.id}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      {/* Header */}
      <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-border/60 bg-background/60 px-4 py-3 backdrop-blur-md sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <VisionLogo size={20} />
          <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
            Vision
          </span>
        </Link>
        <Button
          asChild
          size="sm"
          className="rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 ease-vision"
        >
          <Link to="/auth">
            Try Vision
            <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </header>

      {/* Body */}
      <main className="relative z-10 flex-1 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-2xl">
          {status === "loading" && (
            <div className="pt-12 text-center text-xs text-muted-foreground/60">
              Loading conversation…
            </div>
          )}

          {status === "missing" && (
            <div className="pt-16 text-center">
              <h1 className="text-2xl font-light tracking-tight">
                This conversation isn't <span className="font-serif-italic text-primary">available</span>
              </h1>
              <p className="mt-3 text-sm text-muted-foreground">
                The owner may have stopped sharing it, or the link is incorrect.
              </p>
              <Button
                asChild
                className="mt-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Link to="/">Go home</Link>
              </Button>
            </div>
          )}

          {status === "ready" && convo && (
            <>
              <div className="mb-8 border-b border-border/60 pb-6">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  Shared conversation
                </p>
                <h1 className="mt-2 text-2xl font-light tracking-tight">
                  {convo.title}
                </h1>
              </div>

              <div className="flex flex-col gap-5">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    This conversation is empty.
                  </p>
                ) : (
                  messages.map((m) => (
                    <ChatBubble key={m.id ?? Math.random()} message={m} readOnly />
                  ))
                )}
              </div>

              <div className="mt-12 rounded-2xl border border-border bg-card/40 p-5 text-center backdrop-blur-md">
                <p className="text-sm text-foreground">
                  Want to talk to crypto like this?
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Vision turns plain English into on-chain action on Solana.
                </p>
                <Button
                  asChild
                  className="mt-4 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Link to="/auth">Start your own conversation</Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="relative z-10 px-6 py-6 text-center font-mono text-[10px] tracking-widest uppercase text-muted-foreground/50">
        askvision.ai
      </footer>
    </div>
  );
};

export default SharedChat;
