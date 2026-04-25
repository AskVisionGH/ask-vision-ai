import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { ChatBubble } from "@/components/ChatBubble";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { AlertBell } from "@/components/AlertBell";
import { ShareConversationDialog } from "@/components/ShareConversationDialog";
import { VisionLogo } from "@/components/VisionLogo";
import { WalletOnboardingPrompt } from "@/components/WalletOnboardingPrompt";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { useContacts } from "@/hooks/useContacts";
import {
  autoTitleConversation,
  deleteMessagesFrom,
  fetchMessages,
  saveMessage,
  searchConversationsByContent,
  useConversations,
  type ConversationRow,
  type ShareMode,
} from "@/hooks/useConversations";
import { streamChat, type ChatMessage, type ToolEvent } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Swap 1 SOL into USDC",
  "Bridge 0.5 SOL to ETH on Ethereum",
  "Find smart money buying memecoins right now",
  "Show me the hottest tokens trending on Solana",
];

const Chat = () => {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { contacts, addContact } = useContacts();
  const { connected, publicKey } = useWallet();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    conversations,
    loading: convosLoading,
    createConversation,
    renameConversation,
    deleteConversation,
    togglePin,
    reorderPinned,
    toggleShare,
    applyTitleLocal,
  } = useConversations();

  const activeId = searchParams.get("c");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<Set<string> | null>(null);
  const [shareTarget, setShareTarget] = useState<ConversationRow | null>(null);
  // Whether the signed-in user has zero linked wallets in the DB. Drives the
  // one-time wallet-onboarding prompt for email signups. `null` = unknown
  // (still loading), so the prompt waits instead of flashing in then out.
  const [hasNoWallet, setHasNoWallet] = useState<boolean | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Conversations created in-session via send() — we already have their
  // messages locally, so skip the network fetch (which would race against
  // the optimistic user message + streaming assistant placeholder).
  const localConvoIds = useRef<Set<string>>(new Set());

  // Load messages when active conversation changes.
  useEffect(() => {
    let cancelled = false;
    if (!activeId) {
      setMessages([]);
      return;
    }
    if (localConvoIds.current.has(activeId)) {
      // Just-created convo — local state is already correct.
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

  // Debounced server-side search across all of the user's messages.
  // Title matches happen client-side inside the sidebar; we only need the
  // server when matching message bodies.
  useEffect(() => {
    if (!user) {
      setSearchHits(null);
      return;
    }
    const q = searchQuery.trim();
    if (!q) {
      setSearchHits(null);
      return;
    }
    const handle = window.setTimeout(async () => {
      const ids = await searchConversationsByContent(user.id, q);
      setSearchHits(ids);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [searchQuery, user]);

  // One-time check: does this user have any linked wallets? Drives the
  // wallet-onboarding prompt. We only need a count, and we re-run on user
  // change (e.g. account switch). The prompt itself dismisses on `connected`
  // from the wallet adapter context, and `useWalletAutoLink` handles
  // persisting the new row.
  useEffect(() => {
    if (!user) {
      setHasNoWallet(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { count, error } = await supabase
        .from("wallet_links")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (cancelled) return;
      if (error) {
        // Fail closed: don't show the prompt if we can't tell. Better to
        // under-prompt than to nag a user who already has a wallet.
        setHasNoWallet(false);
        return;
      }
      setHasNoWallet((count ?? 0) === 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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

  // Opens the share dialog. Used both for first-time sharing and for managing
  // an existing share link.
  const handleShare = (c: ConversationRow) => setShareTarget(c);

  const handleEnableShare = async (mode: ShareMode): Promise<string | null> => {
    if (!shareTarget) return null;
    return await toggleShare(shareTarget.id, true, mode);
  };

  const handleChangeShareMode = async (mode: ShareMode): Promise<boolean> => {
    if (!shareTarget?.share_id) return false;
    // Reuse toggleShare with share=true to update the mode without rotating
    // the share id — but we don't want a new id. Update directly instead.
    const { error } = await supabase
      .from("conversations")
      .update({ share_mode: mode } as never)
      .eq("id", shareTarget.id);
    if (error) return false;
    setShareTarget((prev) => (prev ? { ...prev, share_mode: mode } : prev));
    return true;
  };

  const handleUnshare = async (c?: ConversationRow) => {
    const target = c ?? shareTarget;
    if (!target) return;
    await toggleShare(target.id, false);
    toast.success("Sharing disabled");
  };

  /**
   * Runs the AI for the current message list, streaming the assistant reply
   * into a placeholder message in real time. Used by both the normal send
   * flow and the edit-and-regenerate flow.
   */
  const runAssistant = async (history: ChatMessage[], convoId: string) => {
    const wallet = publicKey?.toBase58() ?? null;
    setIsThinking(true);

    // Create a placeholder assistant message we'll mutate as deltas arrive.
    const placeholder: ChatMessage = { role: "assistant", content: "", toolEvents: [] };
    setMessages((prev) => [...prev, placeholder]);

    let accumulated = "";
    const collectedEvents: ToolEvent[] = [];
    let firstDelta = true;
    let errored: { message: string; status: number } | null = null;

    await streamChat({
      messages: history,
      walletAddress: wallet ?? undefined,
      userId: user?.id ?? null,
      profile: profile
        ? {
            displayName: profile.display_name,
            experience: profile.experience,
            interests: profile.interests,
            riskTolerance: profile.risk_tolerance,
            language: profile.language,
          }
        : undefined,
      contacts: contacts.map((c) => ({
        name: c.name,
        address: c.address,
        resolved_address: c.resolved_address,
      })),
      onDelta: (text) => {
        if (firstDelta) {
          // Hide the typing dots once the first token lands.
          setIsThinking(false);
          firstDelta = false;
        }
        accumulated += text;
        setMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { ...last, content: accumulated };
          }
          return copy;
        });
      },
      onToolEvent: (ev) => {
        collectedEvents.push(ev);
        setMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = {
              ...last,
              toolEvents: [...(last.toolEvents ?? []), ev],
            };
          }
          return copy;
        });
      },
      onError: (message, status) => {
        errored = { message, status };
      },
      onDone: () => {
        /* handled below */
      },
    });

    setIsThinking(false);

    if (errored) {
      // Drop the placeholder on hard error.
      setMessages((prev) => {
        const copy = prev.slice();
        if (copy.length && copy[copy.length - 1] === placeholder) copy.pop();
        // Also drop if we replaced placeholder with an empty assistant msg.
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant" && !last.content && !(last.toolEvents?.length)) {
          copy.pop();
        }
        return copy;
      });
      const e = errored as { message: string; status: number };
      if (e.status === 429) toast.error("Slow down", { description: e.message });
      else if (e.status === 402) toast.error("Out of AI credits", { description: e.message });
      else if (e.status !== 0) toast.error("Vision hit a snag", { description: e.message });
      return;
    }

    // Persist the contact requests the AI asked for.
    for (const ev of collectedEvents) {
      if (ev.type === "save_contact_request" && ev.data && !ev.data.error && ev.data.name && ev.data.address) {
        const r = await addContact({ name: ev.data.name, address: ev.data.address });
        if ("error" in r) toast.error("Couldn't save contact", { description: r.error });
        else toast.success(`Saved ${r.name} to contacts`);
      }
    }

    const finalMsg: ChatMessage = {
      role: "assistant",
      content: accumulated,
      toolEvents: collectedEvents,
    };

    localConvoIds.current.delete(convoId);

    if (user) {
      await saveMessage(convoId, user.id, finalMsg);

      const currentConversationId = new URLSearchParams(window.location.search).get("c");
      if (currentConversationId === convoId) {
        const synced = await fetchMessages(convoId);
        if (synced.length) setMessages(synced);
      }
    }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking || !user) return;

    // Show the typing indicator immediately so users get instant feedback,
    // even before the conversation row is created and the AI request is fired.
    setIsThinking(true);

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
      // Mark as local BEFORE updating the URL so the activeId effect skips its fetch.
      localConvoIds.current.add(convoId);
      setSearchParams({ c: convoId }, { replace: true });
    } else if (messages.length === 0) {
      isFirstMessage = true;
    }

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");

    // Persist the user message immediately (don't block the AI call on it).
    void saveMessage(convoId, user.id, userMsg);
    if (isFirstMessage) {
      void (async () => {
        const title = await autoTitleConversation(convoId!, trimmed);
        if (title) applyTitleLocal(convoId!, title);
      })();
    }

    await runAssistant(next, convoId);
  };

  /**
   * Replaces a user message with new content, drops everything that came after,
   * and re-runs the assistant. Requires the message to have a known createdAt
   * (which is true once it's been persisted).
   */
  const editAndRegenerate = async (target: ChatMessage, newContent: string) => {
    if (!user || !activeId || isThinking) return;

    const idx = messages.findIndex((m) => m === target || (m.id && m.id === target.id));
    if (idx < 0) return;

    const original = messages[idx];

    // 1. Update local state: keep everything up to idx, replace the message.
    const truncated = messages.slice(0, idx);
    const editedMsg: ChatMessage = {
      ...original,
      id: undefined, // will be re-issued on insert
      createdAt: undefined,
      content: newContent,
    };
    const nextMessages = [...truncated, editedMsg];
    setMessages(nextMessages);

    // 2. Server-side: drop the original + everything after it (uses the original's createdAt).
    if (original.createdAt) {
      await deleteMessagesFrom(activeId, original.createdAt);
    }

    // 3. Insert the edited user message.
    const newId = await saveMessage(activeId, user.id, editedMsg);
    if (newId) {
      setMessages((prev) =>
        prev.map((m, i) => (i === idx ? { ...m, id: newId } : m)),
      );
    }

    // 4. Regenerate the assistant reply from the new message list.
    await runAssistant(nextMessages, activeId);
  };

  const isEmpty = messages.length === 0 && !loadingThread;

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("vision:sidebar-collapsed") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("vision:sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  const sidebar = (collapsed: boolean) => (
    <ChatSidebar
      conversations={conversations}
      activeId={activeId}
      loading={convosLoading}
      searchQuery={searchQuery}
      searchHits={searchHits}
      onSearchQueryChange={setSearchQuery}
      onSelect={selectConversation}
      onNew={startNewConversation}
      onRename={renameConversation}
      onDelete={handleDelete}
      onTogglePin={togglePin}
      onReorderPinned={reorderPinned}
      onShare={handleShare}
      onUnshare={handleUnshare}
      collapsed={collapsed}
      onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
    />
  );

  // Memoize the edit handler so each ChatBubble doesn't churn every render.
  const handleEdit = useMemo(
    () => (msg: ChatMessage, newContent: string) => {
      void editAndRegenerate(msg, newContent);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, activeId, isThinking, user, profile, contacts],
  );

  return (
    <div className="relative flex h-screen bg-background text-foreground">
      {/* One-time wallet prompt for email signups with no linked wallet. */}
      <WalletOnboardingPrompt needsWallet={hasNoWallet === true} />
      <ShareConversationDialog
        conversation={shareTarget}
        open={!!shareTarget}
        onOpenChange={(o) => !o && setShareTarget(null)}
        onEnableShare={handleEnableShare}
        onChangeMode={handleChangeShareMode}
        onUnshare={() => handleUnshare()}
      />
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      {/* Desktop sidebar */}
      <div
        className={cn(
          "relative z-10 hidden h-full shrink-0 transition-[width] duration-200 ease-vision md:flex",
          sidebarCollapsed ? "w-14" : "w-64",
        )}
      >
        {sidebar(sidebarCollapsed)}
      </div>

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
                {sidebar(false)}
              </SheetContent>
            </Sheet>
            <div className="flex items-center gap-2 md:hidden">
              <VisionLogo size={20} />
              <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                Vision
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <AlertBell />
            <ConnectWalletButton size="default" />
          </div>
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
                  {profile?.display_name ? (
                    <>
                      Hey{" "}
                      <span className="font-serif-italic text-primary">
                        {profile.display_name.split(" ")[0]}
                      </span>
                      , what can I help you with?
                    </>
                  ) : (
                    <>
                      What can I help you{" "}
                      <span className="font-serif-italic text-primary">do</span>?
                    </>
                  )}
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
              messages.map((m, i) => (
                <ChatBubble key={m.id ?? i} message={m} onEdit={handleEdit} />
              ))
            )}

            {isThinking && (
              <div
                className="flex items-center gap-2 px-1 text-foreground"
                aria-label="Vision is thinking"
                role="status"
              >
                <VisionLogo
                  size={9}
                  className="animate-pulse text-foreground drop-shadow-[0_0_6px_hsl(var(--primary-glow)/0.9)] [animation-delay:0ms]"
                />
                <VisionLogo
                  size={9}
                  className="animate-pulse text-foreground drop-shadow-[0_0_6px_hsl(var(--primary-glow)/0.9)] [animation-delay:200ms]"
                />
                <VisionLogo
                  size={9}
                  className="animate-pulse text-foreground drop-shadow-[0_0_6px_hsl(var(--primary-glow)/0.9)] [animation-delay:400ms]"
                />
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
