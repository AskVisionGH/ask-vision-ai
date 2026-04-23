import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { ChatBubble } from "@/components/ChatBubble";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { VisionLogo } from "@/components/VisionLogo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  autoTitleConversation,
  fetchMessages,
  saveMessage,
  useConversations,
} from "@/hooks/useConversations";
import { sendChat, type ChatMessage } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What's in my wallet?",
  "Show me $SOL price",
  "What's trending on Solana?",
  "Explain Jupiter routing in plain English",
];

const Chat = () => {
  const { user } = useAuth();
  const { connected, publicKey } = useWallet();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    conversations,
    loading: convosLoading,
    createConversation,
    renameConversation,
    deleteConversation,
  } = useConversations();

  const activeId = searchParams.get("c");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Land users on a blank "new chat" by default — past threads remain in the
  // sidebar for selection. Only honour an explicit `?c=...` from the URL.

  // Load messages when active conversation changes.
  useEffect(() => {
    let cancelled = false;
    if (!activeId) {
      setMessages([]);
      return;
    }
    setLoadingThread(true);
    fetchMessages(activeId).then((rows) => {
      if (cancelled) return;
      setMessages(rows);
      setLoadingThread(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Auto-scroll on new content.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  const selectConversation = (id: string) => {
    setSearchParams({ c: id });
    setMobileOpen(false);
  };

  const startNewConversation = async () => {
    setSearchParams({}, { replace: true });
    setMessages([]);
    setInput("");
    setMobileOpen(false);
  };

  const handleDelete = async (id: string) => {
    await deleteConversation(id);
    if (id === activeId) {
      setSearchParams({}, { replace: true });
      setMessages([]);
    }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking || !user) return;

    const wallet = publicKey?.toBase58() ?? null;

    // Ensure we have a conversation to write into.
    let convoId = activeId;
    let isFirstMessage = false;
    if (!convoId) {
      const created = await createConversation(wallet);
      if (!created) {
        toast.error("Couldn't start a new conversation");
        return;
      }
      convoId = created.id;
      isFirstMessage = true;
      setSearchParams({ c: convoId }, { replace: true });
    } else if (messages.length === 0) {
      isFirstMessage = true;
    }

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setIsThinking(true);

    // Persist the user message immediately (don't block the AI call on it).
    void saveMessage(convoId, user.id, userMsg);
    if (isFirstMessage) void autoTitleConversation(convoId, trimmed);

    const result = await sendChat({
      messages: next,
      walletAddress: wallet ?? undefined,
    });

    setIsThinking(false);

    if ("error" in result) {
      if (result.status === 429) {
        toast.error("Slow down", { description: result.error });
      } else if (result.status === 402) {
        toast.error("Out of AI credits", { description: result.error });
      } else if (result.status !== 0) {
        toast.error("Vision hit a snag", { description: result.error });
      }
      return;
    }

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: result.content,
      toolEvents: result.toolEvents,
    };
    setMessages((prev) => [...prev, assistantMsg]);
    void saveMessage(convoId, user.id, assistantMsg);
  };

  const isEmpty = messages.length === 0 && !loadingThread;

  const sidebar = (
    <ChatSidebar
      conversations={conversations}
      activeId={activeId}
      loading={convosLoading}
      onSelect={selectConversation}
      onNew={startNewConversation}
      onRename={renameConversation}
      onDelete={handleDelete}
    />
  );

  return (
    <div className="relative flex h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      {/* Desktop sidebar */}
      <div className="relative z-10 hidden h-full w-64 shrink-0 md:flex">{sidebar}</div>

      {/* Main column */}
      <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-border/60 bg-background/60 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden h-8 w-8 text-muted-foreground"
                  aria-label="Open conversations"
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 [&>button.absolute]:hidden">
                {sidebar}
              </SheetContent>
            </Sheet>
            <div className="flex items-center gap-2 md:hidden">
              <VisionLogo size={20} />
              <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                Vision
              </span>
            </div>
          </div>
          <ConnectWalletButton size="default" />
        </header>

        {/* Messages */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            {loadingThread ? (
              <div className="flex justify-center pt-12 text-xs text-muted-foreground/60">
                Loading conversation…
              </div>
            ) : isEmpty ? (
              <div className="flex flex-col items-center pt-16 text-center sm:pt-24">
                <VisionLogo
                  size={40}
                  className="mb-6 drop-shadow-[0_0_24px_hsl(var(--primary-glow)/0.6)]"
                />
                <h2 className="text-2xl font-light tracking-tight sm:text-3xl">
                  What can I help you{" "}
                  <span className="font-serif-italic text-primary">do</span>?
                </h2>
                <p className="mt-3 max-w-sm text-sm text-muted-foreground">
                  Ask anything about Solana — your wallet, tokens, protocols, or how something works.
                </p>
                {!connected && (
                  <p className="mt-2 max-w-sm text-xs text-muted-foreground/70">
                    Connect a wallet to unlock balance, swap, and transfer actions.
                  </p>
                )}

                <div className="mt-10 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className={cn(
                        "rounded-xl border border-border bg-card/40 px-4 py-3 text-left text-xs text-muted-foreground ease-vision",
                        "hover:border-primary/30 hover:bg-card hover:text-foreground",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => <ChatBubble key={i} message={m} />)
            )}

            {isThinking && (
              <div className="flex items-center gap-1.5 px-1 text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-border/60 bg-background/80 px-4 py-4 backdrop-blur-md sm:px-6">
          <div className="mx-auto max-w-2xl">
            <ChatComposer
              value={input}
              onChange={setInput}
              onSubmit={() => send(input)}
              disabled={isThinking}
            />
            <p className="mt-2 text-center font-mono text-[10px] tracking-wider uppercase text-muted-foreground/50">
              Vision can make mistakes · not financial advice
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;
