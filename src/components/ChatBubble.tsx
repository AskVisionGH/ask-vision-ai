import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/chat-stream";
import { PortfolioCard } from "@/components/PortfolioCard";
import { TokenCard } from "@/components/TokenCard";
import { TrendingCard } from "@/components/TrendingCard";
import { SwapPreviewCard } from "@/components/SwapPreviewCard";
import { TransferPreviewCard } from "@/components/TransferPreviewCard";

interface Props {
  message: ChatMessage;
}

export const ChatBubble = ({ message }: Props) => {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex w-full animate-fade-up justify-end">
        <div className="max-w-[88%] rounded-2xl border border-border bg-secondary px-4 py-3 text-sm leading-relaxed text-foreground sm:max-w-[78%]">
          <p className="whitespace-pre-wrap font-mono text-[13px]">{message.content}</p>
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div className="flex w-full animate-fade-up flex-col gap-3">
      {message.content && (
        <div
          className={cn(
            "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed text-foreground sm:max-w-[78%]",
            "prose prose-invert prose-sm max-w-none",
            "prose-p:my-2 prose-p:leading-relaxed",
            "prose-headings:font-medium prose-headings:tracking-tight",
            "prose-strong:text-foreground prose-strong:font-medium",
            "prose-code:font-mono prose-code:text-primary prose-code:bg-secondary prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
            "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
            "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
            "prose-pre:bg-popover prose-pre:border prose-pre:border-border",
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      )}

      {message.toolEvents?.map((event, i) => {
        if (event.type === "wallet_balance") {
          return <PortfolioCard key={i} data={event.data} />;
        }
        if (event.type === "token_info") {
          return <TokenCard key={i} data={event.data} />;
        }
        if (event.type === "trending") {
          return <TrendingCard key={i} data={event.data} />;
        }
        if (event.type === "swap_quote") {
          return <SwapPreviewCard key={i} data={event.data} />;
        }
        if (event.type === "transfer_quote") {
          return <TransferPreviewCard key={i} data={event.data} />;
        }
        return null;
      })}
    </div>
  );
};
