import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { VisionLogo } from "@/components/VisionLogo";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { ChatBubble } from "@/components/ChatBubble";
import { ChatComposer } from "@/components/ChatComposer";
import { streamChat, type ChatMessage } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What's in my wallet?",
  "Swap 10 USDC to SOL",
  "Show trending tokens on Solana",
  "Explain Jupiter routing in plain English",
];

const Chat = () => {
  const { connected } = useWallet();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!connected) navigate("/");
  }, [connected, navigate]);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setIsStreaming(true);

    let assistantBuffer = "";
    let assistantStarted = false;
    const controller = new AbortController();
    abortRef.current = controller;

    await streamChat({
      messages: next,
      signal: controller.signal,
      onDelta: (chunk) => {
        assistantBuffer += chunk;
        setMessages((prev) => {
          if (!assistantStarted) {
            assistantStarted = true;
            return [...prev, { role: "assistant", content: assistantBuffer }];
          }
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: assistantBuffer };
          return copy;
        });
      },
      onDone: () => {
        setIsStreaming(false);
        abortRef.current = null;
      },
      onError: (status, msg) => {
        setIsStreaming(false);
        abortRef.current = null;
        if (status === 429) {
          toast.error("Slow down", { description: msg });
        } else if (status === 402) {
          toast.error("Out of AI credits", { description: msg });
        } else {
          toast.error("Vision hit a snag", { description: msg });
        }
        // Drop the empty assistant placeholder if no content arrived
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
          return prev;
        });
      },
    });
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="relative flex h-screen flex-col bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      {/* Header */}
      <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-border/60 bg-background/60 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-2">
          <VisionLogo size={20} />
          <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
            Vision
          </span>
        </div>
        <ConnectWalletButton size="default" />
      </header>

      {/* Messages */}
      <div
        ref={scrollerRef}
        className="relative z-10 flex-1 overflow-y-auto px-4 py-6 sm:px-6"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          {isEmpty ? (
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
                Ask anything about Solana — tokens, swaps, wallets, protocols, or how something works.
              </p>

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
            messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              return (
                <ChatBubble
                  key={i}
                  message={m}
                  isStreaming={isStreaming && isLast && m.role === "assistant"}
                />
              );
            })
          )}

          {isStreaming && messages[messages.length - 1]?.role === "user" && (
            <div className="flex gap-1.5 px-1 text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="relative z-10 shrink-0 border-t border-border/60 bg-background/80 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="mx-auto max-w-2xl">
          <ChatComposer
            value={input}
            onChange={setInput}
            onSubmit={() => send(input)}
            disabled={isStreaming}
          />
          <p className="mt-2 text-center font-mono text-[10px] tracking-wider uppercase text-muted-foreground/50">
            Vision can make mistakes · not financial advice
          </p>
        </div>
      </div>
    </div>
  );
};

export default Chat;
