// Transcribes a recorded audio blob using ElevenLabs Scribe v2.
// Receives multipart/form-data with an `audio` file, returns { text }.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) return json({ error: "Voice transcription not configured." }, 500);

    const inForm = await req.formData();
    const audio = inForm.get("audio");
    if (!(audio instanceof File) && !(audio instanceof Blob)) {
      return json({ error: "audio file required" }, 400);
    }

    // Forward to ElevenLabs.
    const out = new FormData();
    // ElevenLabs accepts a Blob — give it a sensible filename so the multipart
    // boundary parses cleanly on their side.
    const filename = (audio as File).name ?? "recording.webm";
    out.append("file", audio, filename);
    out.append("model_id", "scribe_v2");
    // Auto-detect language by omitting `language_code`. Don't tag audio events
    // or diarize — we just want the cleanest text for a chat input.

    const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: out,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("ElevenLabs STT error:", resp.status, errText);
      if (resp.status === 401) return json({ error: "Voice service unauthorized." }, 502);
      if (resp.status === 429) return json({ error: "Voice service rate-limited. Try again." }, 502);
      return json({ error: "Couldn't transcribe audio. Try again." }, 502);
    }

    const data = await resp.json();
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    return json({ text });
  } catch (e) {
    console.error("voice-transcribe error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
