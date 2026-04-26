import { ArrowUp, Mic, Loader2, Square, AtSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/useProfile";
import { getLanguageOption } from "@/lib/languages";
import { useContacts, type ContactRow } from "@/hooks/useContacts";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}

type RecState = "idle" | "recording" | "transcribing";

export const ChatComposer = ({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Ask Vision anything…",
}: Props) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { profile } = useProfile();
  const { contacts } = useContacts();
  const [recState, setRecState] = useState<RecState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

  // --- @mention dropdown state ---------------------------------------------
  // We watch the textarea caret for a `@<query>` token (no whitespace inside)
  // and surface matching contacts. Selecting one replaces the token with the
  // contact's display name so downstream chat handlers can resolve it via
  // findContactByName().
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number>(-1);
  const [mentionIndex, setMentionIndex] = useState(0);

  const mentionMatches = useMemo<ContactRow[]>(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const filtered = q
      ? contacts.filter((c) => c.name.toLowerCase().startsWith(q))
      : contacts;
    return filtered.slice(0, 6);
  }, [contacts, mentionQuery]);

  const mentionOpen = mentionQuery !== null && mentionMatches.length > 0;

  // Reset highlight when the candidate list changes so we never point past
  // the end of the array.
  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery, mentionMatches.length]);

  /** Inspect the text around the caret to decide whether a `@token` is active. */
  const detectMention = (text: string, caret: number) => {
    // Walk backwards from the caret looking for `@` — stop on whitespace.
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "@") {
        // `@` must be at start of input OR preceded by whitespace, otherwise
        // it's part of an email/handle inside another word.
        if (i === 0 || /\s/.test(text[i - 1])) {
          const query = text.slice(i + 1, caret);
          // Bail if the query already has whitespace (mention "closed").
          if (/\s/.test(query)) {
            setMentionQuery(null);
            setMentionStart(-1);
            return;
          }
          setMentionQuery(query);
          setMentionStart(i);
          return;
        }
        setMentionQuery(null);
        setMentionStart(-1);
        return;
      }
      if (/\s/.test(ch)) {
        setMentionQuery(null);
        setMentionStart(-1);
        return;
      }
      i--;
    }
    setMentionQuery(null);
    setMentionStart(-1);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next);
    detectMention(next, e.target.selectionStart ?? next.length);
  };

  const insertMention = (contact: ContactRow) => {
    if (mentionStart < 0) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    // Replace `@<query>` with `@Name ` (trailing space so user can keep typing).
    const before = value.slice(0, mentionStart);
    const after = value.slice(caret);
    const inserted = `@${contact.name} `;
    const next = `${before}${inserted}${after}`;
    onChange(next);
    setMentionQuery(null);
    setMentionStart(-1);
    // Restore caret right after the inserted mention.
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const closeMention = () => {
    setMentionQuery(null);
    setMentionStart(-1);
  };

  // Auto-grow up to ~6 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [value]);

  // Cleanup on unmount — release mic if still held.
  useEffect(() => {
    return () => {
      stopTracks();
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, []);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When the @mention list is open, intercept nav keys.
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = mentionMatches[mentionIndex];
        if (pick) insertMention(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  };

  const startRecording = async () => {
    if (recState !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      // Pick a mime type the browser supports — Safari prefers mp4/aac, others webm/opus.
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) =>
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
      ) ?? "";

      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void handleStop(recorder.mimeType || mime || "audio/webm");
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecState("recording");
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      tickRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 100);
    } catch (e) {
      console.error("mic permission/start failed", e);
      toast({
        variant: "destructive",
        title: "Microphone unavailable",
        description: "Please allow mic access and try again.",
      });
      stopTracks();
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    recorder.stop();
  };

  const handleStop = async (mimeType: string) => {
    stopTracks();
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    // Too short — likely a misclick.
    if (blob.size < 1500) {
      setRecState("idle");
      setElapsedMs(0);
      return;
    }

    setRecState("transcribing");
    try {
      const ext = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
      const form = new FormData();
      form.append("audio", new File([blob], `recording.${ext}`, { type: mimeType }));
      // Pass the user's language as an ISO 639-3 hint when set (improves accuracy
      // significantly vs auto-detect, especially for non-English speakers).
      const langOpt = getLanguageOption(profile?.language);
      if (langOpt.iso639_3) form.append("language", langOpt.iso639_3);

      const { data, error } = await supabase.functions.invoke("voice-transcribe", {
        body: form,
      });
      if (error) {
        // Try to surface the friendly server error.
        const ctx = (error as any).context;
        let msg = error.message ?? "Transcription failed";
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            if (parsed?.error) msg = String(parsed.error);
          } catch { /* noop */ }
        }
        throw new Error(msg);
      }
      const text = (data as any)?.text?.trim() ?? "";
      if (!text) {
        toast({ title: "Didn't catch that", description: "Try recording again." });
      } else {
        // Append (don't overwrite) so users can dictate into existing text.
        const next = value ? `${value.trimEnd()} ${text}` : text;
        onChange(next);
        // Refocus the textarea so user can edit/send.
        requestAnimationFrame(() => ref.current?.focus());
      }
    } catch (e) {
      console.error("transcribe failed", e);
      toast({
        variant: "destructive",
        title: "Transcription failed",
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setRecState("idle");
      setElapsedMs(0);
    }
  };

  const canSend = value.trim().length > 0 && !disabled && recState === "idle";
  const recording = recState === "recording";
  const transcribing = recState === "transcribing";

  const seconds = Math.floor(elapsedMs / 1000);
  const elapsedLabel = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
      className="relative w-full"
    >
      {/* @mention dropdown — anchored above the composer. */}
      {mentionOpen && (
        <div
          className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-xs overflow-hidden rounded-xl border border-border bg-popover shadow-soft"
          role="listbox"
          aria-label="Contacts"
        >
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <AtSign className="h-3 w-3" />
            Contacts
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {mentionMatches.map((c, idx) => {
              const active = idx === mentionIndex;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    // Use mousedown so the click registers before the textarea
                    // blur fires and we lose the caret position.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(c);
                    }}
                    onMouseEnter={() => setMentionIndex(idx)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left ease-vision",
                      active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                    )}
                  >
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground/70">
                      {c.address.length > 12
                        ? `${c.address.slice(0, 4)}…${c.address.slice(-4)}`
                        : c.address}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-border bg-popover px-3 py-2.5 shadow-soft ease-vision sm:px-4 sm:py-3",
          "focus-within:border-primary/40 focus-within:shadow-glow",
          recording && "border-destructive/50 shadow-glow",
        )}
      >
        {recording ? (
          <div className="flex flex-1 items-center gap-3 py-1">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
            </span>
            <span className="font-mono text-[12px] text-muted-foreground">
              Recording… <span className="text-foreground">{elapsedLabel}</span>
            </span>
          </div>
        ) : transcribing ? (
          <div className="flex flex-1 items-center gap-2 py-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="font-mono text-[12px] text-muted-foreground">Transcribing…</span>
          </div>
        ) : (
          <textarea
            ref={ref}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKey}
            // Re-evaluate the mention token whenever the caret moves, so
            // clicking back into a `@token` reopens the dropdown.
            onClick={(e) => detectMention(value, e.currentTarget.selectionStart ?? value.length)}
            onKeyUp={(e) => {
              const navKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
              if (navKeys.includes(e.key)) {
                detectMention(value, e.currentTarget.selectionStart ?? value.length);
              }
            }}
            // Close the dropdown when focus leaves the textarea (we use
            // mousedown on items so the click still registers first).
            onBlur={closeMention}
            placeholder={placeholder}
            rows={1}
            className={cn(
              // 16px on mobile prevents iOS Safari from auto-zooming on focus;
              // shrink to 13px from sm: upward to keep the desktop aesthetic.
              "relative min-h-[24px] flex-1 resize-none bg-transparent font-mono text-[16px] leading-relaxed text-foreground outline-none sm:text-[13px]",
              "placeholder:text-muted-foreground/60",
            )}
          />
        )}

        {/* Mic / stop */}
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={disabled || transcribing}
          className={cn(
            "group flex h-8 w-8 shrink-0 items-center justify-center rounded-full ease-vision",
            recording
              ? "bg-destructive text-destructive-foreground hover:opacity-90"
              : transcribing
                ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                : "bg-secondary text-muted-foreground hover:bg-primary/15 hover:text-primary hover:shadow-glow",
          )}
          aria-label={recording ? "Stop recording" : "Record voice message"}
        >
          {recording ? (
            <Square className="h-3.5 w-3.5" />
          ) : (
            <Mic className="h-4 w-4 transition-transform group-hover:scale-110" />
          )}
        </button>

        {/* Send */}
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
