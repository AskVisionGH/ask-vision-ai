import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/chat-stream";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PortfolioCard } from "@/components/PortfolioCard";
import { TokenCard } from "@/components/TokenCard";
import { TrendingCard } from "@/components/TrendingCard";
import { SwapPreviewCard } from "@/components/SwapPreviewCard";
import { TransferPreviewCard } from "@/components/TransferPreviewCard";

interface Props {
  message: ChatMessage;
  /** When provided, user messages get a hover edit affordance. */
  onEdit?: (message: ChatMessage, newContent: string) => void;
  /** Hide controls (e.g. on the public shared view). */
  readOnly?: boolean;
}

export const ChatBubble = ({ message, onEdit, readOnly = false }: Props) => {
  const isUser = message.role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset the draft whenever the underlying message changes (e.g. another edit committed).
  useEffect(() => {
    setDraft(message.content);
  }, [message.content]);

  // Focus + auto-size on entering edit mode.
  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing]);

  const canEdit = !readOnly && isUser && !!onEdit;

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.content) {
      setEditing(false);
      setDraft(message.content);
      return;
    }
    onEdit?.(message, trimmed);
    setEditing(false);
  };

  if (isUser) {
    return (
      <div className="group flex w-full animate-fade-up items-start justify-end gap-2">
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 rounded-md p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
            aria-label="Edit message"
            title="Edit and regenerate"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}

        <div
          className={cn(
            "max-w-[88%] rounded-2xl border border-border bg-secondary px-4 py-3 text-sm leading-relaxed text-foreground sm:max-w-[78%]",
            editing && "w-full max-w-[88%] sm:max-w-[78%]",
          )}
        >
          {editing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  // Grow with content.
                  e.currentTarget.style.height = "auto";
                  e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    commitEdit();
                  }
                  if (e.key === "Escape") {
                    setEditing(false);
                    setDraft(message.content);
                  }
                }}
                className="min-h-[40px] resize-none border-0 bg-transparent p-0 font-mono text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setDraft(message.content);
                  }}
                  className="h-7 px-2 text-xs text-muted-foreground"
                >
                  <X className="mr-1 h-3 w-3" />
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={commitEdit}
                  disabled={!draft.trim() || draft.trim() === message.content}
                  className="h-7 rounded-full bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
                >
                  Save & regenerate
                </Button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap font-mono text-[13px]">{message.content}</p>
          )}
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
