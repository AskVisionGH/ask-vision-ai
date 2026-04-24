// Shared formatting + edge-function helpers for the chat-driven trading
// preview cards (limit, DCA, bracket, ladder, open orders). Keeps each
// card lean and consistent with /trade.

import { supabase } from "@/integrations/supabase/client";

export const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toExponential(2)}`;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
};

export const fmtAmount = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (Math.abs(n) < 0.000001) return n.toExponential(3);
  if (Math.abs(n) < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (Math.abs(n) < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

export const fmtRate = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs >= 0.01) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
};

export const truncSig = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const supaPost = async (
  fn: string,
  body: unknown,
  attempt = 0,
): Promise<any> => {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as any).context;
    let serverMsg: string | null = null;
    let status: number | undefined;
    if (ctx) {
      status = ctx.status;
      if (typeof ctx.json === "function") {
        try {
          const parsed = await ctx.json();
          if (parsed?.error) serverMsg = String(parsed.error);
        } catch {
          /* ignore */
        }
      }
    }
    const message = serverMsg ?? error.message ?? `${fn} failed`;
    const transient =
      status === 503 ||
      status === 504 ||
      message.toLowerCase().includes("temporarily unavailable") ||
      message.toLowerCase().includes("runtime_error");
    if (transient && attempt < 2) {
      await sleep(400 * (attempt + 1));
      return supaPost(fn, body, attempt + 1);
    }
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in (data as any) && (data as any).error) {
    throw new Error((data as any).error);
  }
  return data;
};

export const fmtDuration = (sec: number) => {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h`;
  return `${Math.floor(sec / 60)}m`;
};
