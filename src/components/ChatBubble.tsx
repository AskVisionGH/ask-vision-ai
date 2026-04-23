import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/chat-stream";

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
}

export const ChatBubble = ({ message, isStreaming }: Props) => {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full animate-fade-up", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[78%]",
          isUser
            ? "bg-secondary text-foreground border border-border"
            : "bg-transparent text-foreground",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap font-mono text-[13px]">{message.content}</p>
        ) : (
          <div
            className={cn(
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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content || (isStreaming ? "​" : "")}
            </ReactMarkdown>
            {isStreaming && message.content && (
              <span className="ml-0.5 inline-block h-3.5 w-[2px] -mb-0.5 animate-pulse bg-primary align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
