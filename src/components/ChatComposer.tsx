import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat-stream";

const SUGGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-suggest`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  recentMessages?: ChatMessage[];
  walletConnected?: boolean;
}

/**
 * Parse a single line from the gateway SSE stream and return any delta text.
 * Returns null for keepalives, [DONE], or unparseable JSON.
 */
function parseSseLine(line: string): string | null {
  if (line.startsWith(":") || line.trim() === "") return null;
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") return null;
  try {
    const parsed = JSON.parse(payload);
    return (parsed?.choices?.[0]?.delta?.content as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Turn a raw streaming buffer into an array of cleaned suggestion strings.
 * The model returns one suggestion per line; while it's still streaming we
 * also include the in-progress (last) line.
 */
function bufferToSuggestions(buffer: string, partial: string): string[] {
  const lines = buffer.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    // Strip stray markdown bullets / numbering / quotes the model occasionally adds.
    let s = raw
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!,;:]+$/g, "")
      .trim();
    if (!s) continue;
    // Force the user's exact typed prefix.
    const p = partial.trimEnd();
    if (s.toLowerCase().startsWith(p.toLowerCase())) {
      s = p + s.slice(p.length);
    } else {
      // Skip lines that don't extend the partial — they'd render as broken ghost text.
      continue;
    }
    if (s.toLowerCase() === p.toLowerCase()) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= 3) break;
  }
  return out;
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
  // Cache of partial → suggestions so we can show stale-but-relevant results
  // instantly while a new request streams in. Cleared when the field empties.
  const cacheRef = useRef<Map<string, string[]>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const lastFetchedFor = useRef<string>("");

  // Auto-grow up to ~6 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [value]);

  // Reset cache when the field is cleared so stale prefixes don't haunt new prompts.
  useEffect(() => {
    if (value.length === 0) {
      cacheRef.current.clear();
      setSuggestions([]);
      abortRef.current?.abort();
    }
  }, [value]);

  // Streamed suggestion fetch on every keystroke (debounced 80ms).
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < 3 || disabled) {
      setSuggestions([]);
      abortRef.current?.abort();
      return;
    }

    // Show the best cached match instantly. Prefer the longest cached prefix
    // that starts the current value (keeps the ghost text alive while we fetch).
    let best: { key: string; suggestions: string[] } | null = null;
    for (const [key, list] of cacheRef.current) {
      if (value.toLowerCase().startsWith(key.toLowerCase())) {
        if (!best || key.length > best.key.length) best = { key, suggestions: list };
      }
    }
    if (best) {
      const usable = best.suggestions
        .filter((s) => s.toLowerCase().startsWith(value.toLowerCase()) && s.length > value.length)
        .slice(0, 3);
      setSuggestions(usable);
    }

    const handle = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const targetInput = value;
      lastFetchedFor.current = targetInput;

      void (async () => {
        try {
          const resp = await fetch(SUGGEST_URL, {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${ANON_KEY}`,
              apikey: ANON_KEY,
            },
            body: JSON.stringify({
              partial: targetInput,
              walletConnected,
              recent: recentMessages.slice(-4).map((m) => ({
                role: m.role,
                content: m.content,
              })),
            }),
          });

          if (!resp.ok || !resp.body) return;

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let textBuffer = ""; // SSE line buffer
          let contentBuffer = ""; // accumulated model output

          while (true) {
            const { done, value: chunk } = await reader.read();
            if (done) break;
            if (controller.signal.aborted || lastFetchedFor.current !== targetInput) return;
            textBuffer += decoder.decode(chunk, { stream: true });

            let nl: number;
            while ((nl = textBuffer.indexOf("\n")) !== -1) {
              let line = textBuffer.slice(0, nl);
              textBuffer = textBuffer.slice(nl + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              const delta = parseSseLine(line);
              if (delta) {
                contentBuffer += delta;
                const next = bufferToSuggestions(contentBuffer, targetInput);
                if (next.length && lastFetchedFor.current === targetInput) {
                  setSuggestions(next);
                }
              }
            }
          }

          // Final flush + cache.
          const finalSuggestions = bufferToSuggestions(contentBuffer, targetInput);
          if (lastFetchedFor.current === targetInput) {
            if (finalSuggestions.length) {
              setSuggestions(finalSuggestions);
              cacheRef.current.set(targetInput, finalSuggestions);
              // Bound cache size.
              if (cacheRef.current.size > 40) {
                const firstKey = cacheRef.current.keys().next().value;
                if (firstKey) cacheRef.current.delete(firstKey);
              }
            }
          }
        } catch (e) {
          if ((e as any)?.name !== "AbortError") {
            // Silent — autocomplete failures shouldn't surface to the user.
          }
        }
      })();
    }, 80);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, disabled, walletConnected]);

  // Inline ghost text (first suggestion that extends what's typed).
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
    requestAnimationFrame(() => ref.current?.focus());
  };

  const canSend = value.trim().length > 0 && !disabled;
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
        </p>
      )}
    </form>
  );
};
