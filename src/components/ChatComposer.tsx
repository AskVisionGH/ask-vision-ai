import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage } from "@/lib/chat-stream";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** Recent messages, used as context for autocomplete suggestions. */
  recentMessages?: ChatMessage[];
  /** Whether a wallet is currently connected (changes suggestion flavor). */
  walletConnected?: boolean;
}

export const ChatComposer = ({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Ask Vision anything…",
  recentMessages = [],
  walletConnected = false,
}: Props) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  // Track the input we last fetched for, so stale responses can't override
  // newer ones.
  const lastFetchedFor = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);

  // Auto-grow up to ~6 lines
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [value]);

  // Debounced suggestion fetch.
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < 3 || disabled) {
      setSuggestions([]);
      setLoadingSuggest(false);
      abortRef.current?.abort();
      return;
    }
    const handle = window.setTimeout(async () => {
      // Cancel any in-flight request.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const targetInput = value;
      lastFetchedFor.current = targetInput;
      setLoadingSuggest(true);
      try {
        const { data, error } = await supabase.functions.invoke("chat-suggest", {
          body: {
            partial: targetInput,
            walletConnected,
            recent: recentMessages.slice(-4).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          },
        });
        // Drop the response if the input has moved on.
        if (controller.signal.aborted || lastFetchedFor.current !== targetInput) return;
        if (error) {
          setSuggestions([]);
        } else {
          const list = Array.isArray(data?.suggestions) ? (data.suggestions as string[]) : [];
          setSuggestions(list);
        }
      } catch {
        if (!controller.signal.aborted) setSuggestions([]);
      } finally {
        if (lastFetchedFor.current === targetInput) setLoadingSuggest(false);
      }
    }, 350);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, disabled, walletConnected]);

  // The first suggestion is rendered as inline ghost text behind the textarea
  // (autocomplete-style). Tab to accept.
  const ghost =
    suggestions[0] && suggestions[0].toLowerCase().startsWith(value.toLowerCase()) && value.length > 0
      ? suggestions[0].slice(value.length)
      : "";

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && ghost) {
      e.preventDefault();
      onChange(suggestions[0]);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  };

  const acceptSuggestion = (s: string) => {
    onChange(s);
    setSuggestions([]);
    // Refocus so the user can keep typing or hit enter.
    requestAnimationFrame(() => ref.current?.focus());
  };

  const canSend = value.trim().length > 0 && !disabled;
  // Show the dropdown for suggestions 2 & 3 (the first one is the ghost).
  const dropdownItems = suggestions.slice(1).filter((s) => s !== suggestions[0]);
  const showDropdown = !disabled && value.trim().length >= 3 && dropdownItems.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
      className="relative w-full"
    >
      {showDropdown && (
        <div className="absolute bottom-full left-0 right-0 mb-2 flex flex-col gap-1.5 rounded-xl border border-border/60 bg-popover/95 p-2 shadow-soft backdrop-blur-md">
          <div className="flex items-center gap-1.5 px-1.5 pb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
            <Sparkles className="h-3 w-3 text-primary/70" />
            <span>Suggestions</span>
          </div>
          {dropdownItems.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => acceptSuggestion(s)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-left text-[13px] text-muted-foreground ease-vision",
                "hover:bg-accent hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-border bg-popover px-4 py-3 shadow-soft ease-vision",
          "focus-within:border-primary/40 focus-within:shadow-glow",
        )}
      >
        <div className="relative flex-1">
          {/* Ghost autocomplete layer — sits behind the textarea, perfectly aligned. */}
          {ghost && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-muted-foreground/40"
            >
              <span className="invisible">{value}</span>
              <span>{ghost}</span>
            </div>
          )}
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            rows={1}
            className={cn(
              "relative min-h-[24px] w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed text-foreground outline-none",
              "placeholder:text-muted-foreground/60",
            )}
          />
        </div>
        <button
          type="submit"
          disabled={!canSend}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full ease-vision",
            canSend
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-muted text-muted-foreground/40 cursor-not-allowed",
          )}
          aria-label="Send"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>

      {ghost && (
        <p className="mt-1 px-1 font-mono text-[10px] tracking-wider text-muted-foreground/40">
          press <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-px text-[9px]">Tab</kbd> to complete
          {loadingSuggest ? " · thinking…" : ""}
        </p>
      )}
    </form>
  );
};
