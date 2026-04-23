export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const AUTH_TOKEN = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface StreamArgs {
  messages: ChatMessage[];
  onDelta: (chunk: string) => void;
  onDone: () => void;
  onError: (status: number, message: string) => void;
  signal?: AbortSignal;
}

/**
 * Streams a chat response from the Vision edge function.
 * Parses SSE line-by-line and emits each token chunk via onDelta.
 */
export async function streamChat({
  messages,
  onDelta,
  onDone,
  onError,
  signal,
}: StreamArgs): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    onError(0, "Network error. Check your connection.");
    return;
  }

  if (!resp.ok || !resp.body) {
    let msg = "Something went wrong.";
    try {
      const data = await resp.json();
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    onError(resp.status, msg);
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  while (!done) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      onError(0, "Stream interrupted.");
      return;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;

      const json = line.slice(6).trim();
      if (json === "[DONE]") {
        done = true;
        break;
      }
      try {
        const parsed = JSON.parse(json);
        const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (delta) onDelta(delta);
      } catch {
        // partial JSON across chunks — re-buffer
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    for (let raw of buffer.split("\n")) {
      if (!raw) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (raw.startsWith(":") || raw.trim() === "") continue;
      if (!raw.startsWith("data: ")) continue;
      const json = raw.slice(6).trim();
      if (json === "[DONE]") continue;
      try {
        const parsed = JSON.parse(json);
        const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (delta) onDelta(delta);
      } catch {
        /* ignore */
      }
    }
  }

  onDone();
}
