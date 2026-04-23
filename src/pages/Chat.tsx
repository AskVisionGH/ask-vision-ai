import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { VisionLogo } from "@/components/VisionLogo";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { ChatBubble } from "@/components/ChatBubble";
import { ChatComposer } from "@/components/ChatComposer";
import { sendChat, type ChatMessage } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What's in my wallet?",
  "Show my SOL balance",
  "Explain Jupiter routing in plain English",
  "What are SPL tokens?",
];

const Chat = () => {
  const { connected, publicKey } = useWallet();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!connected) navigate("/");
  }, [connected, navigate]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setIsThinking(true);

    const result = await sendChat({
      messages: next,
      walletAddress: publicKey?.toBase58(),
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

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: result.content,
        toolEvents: result.toolEvents,
      },
    ]);
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
                Ask anything about Solana — your wallet, tokens, protocols, or how something works.
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
      <div className="relative z-10 shrink-0 border-t border-border/60 bg-background/80 px-4 py-4 backdrop-blur-md sm:px-6">
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
  );
};

export default Chat;
