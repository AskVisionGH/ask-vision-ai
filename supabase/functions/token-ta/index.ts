import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Lightweight TA: take a recent candle slice + a few derived indicators,
// hand it to Lovable AI Gateway, get a tight 2-3 sentence read.
// We compute indicators server-side so the model gets clean numbers, not raw OHLCV.

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { symbol, interval, candles } = await req.json();
    if (!Array.isArray(candles) || candles.length < 10) {
      return json({ error: "Not enough candles for a TA read" }, 400);
    }
    const sym = String(symbol ?? "this token");
    const tf = String(interval ?? "15m");

    const closes = candles.map((c: Candle) => c.c);
    const vols = candles.map((c: Candle) => c.v);
    const last = closes[closes.length - 1];
    const first = closes[0];
    const high = Math.max(...candles.map((c: Candle) => c.h));
    const low = Math.min(...candles.map((c: Candle) => c.l));
    const changePct = ((last - first) / first) * 100;
    const rsi = calcRsi(closes, 14);
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const macdLine = ema12 - ema26;
    const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
    const lastVol = vols[vols.length - 1];
    const volRatio = avgVol > 0 ? lastVol / avgVol : 0;
    const atrPct = avgRange(candles) / last * 100;

    const indicatorBlock = [
      `Symbol: ${sym}`,
      `Timeframe: ${tf}`,
      `Bars: ${candles.length}`,
      `Window change: ${changePct.toFixed(2)}%`,
      `Last close: ${last}`,
      `Window high: ${high}`,
      `Window low: ${low}`,
      `RSI(14): ${rsi.toFixed(1)}`,
      `EMA12 - EMA26 (MACD line): ${macdLine.toFixed(6)}`,
      `Volatility (avg true range as % of price): ${atrPct.toFixed(2)}%`,
      `Volume vs avg: ${volRatio.toFixed(2)}x`,
    ].join("\n");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "AI not configured" }, 500);

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a sharp crypto technical analyst. Read the indicator snapshot and write a 2-3 sentence take. Be specific: name the trend, call out RSI extremes if any, mention volume context, flag obvious supports/resistances. NEVER give buy/sell advice. NEVER predict. Use plain language. No headers, no lists — just the paragraph. Always end with one short risk caveat sentence.",
          },
          { role: "user", content: indicatorBlock },
        ],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return json({ error: "Rate limited, try again in a sec" }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted" }, 402);
      return json({ error: "AI gateway error" }, 502);
    }

    const aiJson = await aiResp.json();
    const text = aiJson.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return json({ error: "Empty AI response" }, 502);

    return json({
      symbol: sym,
      interval: tf,
      commentary: text,
      indicators: {
        rsi,
        macdLine,
        changePct,
        atrPct,
        volRatio,
        high,
        low,
      },
    });
  } catch (e) {
    console.error("token-ta error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function calcRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function avgRange(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  return (
    candles.reduce((acc, c) => acc + (c.h - c.l), 0) / candles.length
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
