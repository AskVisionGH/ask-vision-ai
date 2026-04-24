import { ArrowUp, Mic, Loader2, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/useProfile";
import { getLanguageOption } from "@/lib/languages";

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
  const [recState, setRecState] = useState<RecState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

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
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-border bg-popover px-4 py-3 shadow-soft ease-vision",
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
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            rows={1}
            className={cn(
              "relative min-h-[24px] flex-1 resize-none bg-transparent font-mono text-[13px] leading-relaxed text-foreground outline-none",
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
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full ease-vision",
            recording
              ? "bg-destructive text-destructive-foreground hover:opacity-90"
              : transcribing
                ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                : "bg-secondary text-foreground hover:bg-secondary/80",
          )}
          aria-label={recording ? "Stop recording" : "Record voice message"}
        >
          {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
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
