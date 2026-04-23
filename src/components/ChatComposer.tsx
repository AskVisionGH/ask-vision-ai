import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatComposer = ({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Ask Vision anything…",
}: Props) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~6 lines
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [value]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  };

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
      className="relative w-full"
    >
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-border bg-popover px-4 py-3 shadow-soft ease-vision",
          "focus-within:border-primary/40 focus-within:shadow-glow",
        )}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          rows={1}
          className={cn(
            "min-h-[24px] flex-1 resize-none bg-transparent font-mono text-[13px] leading-relaxed text-foreground outline-none",
            "placeholder:text-muted-foreground/60",
          )}
        />
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
    </form>
  );
};
