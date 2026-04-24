import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// Public VAPID key — safe to embed client-side (the matching private key lives
// only in the edge function env). This is our project's VAPID_PUBLIC_KEY.
const VAPID_PUBLIC_KEY =
  "BB7gAyOB03BQ5JJO38mXTX2v5o7B5BQ8x7KAIk-osTtpkO_WMmHhU49fD-7U82rtdhPu4HhVfrcRCSweuGaAFbo";

// Push API requires the server's public key as a BufferSource. Convert our
// base64url string into a fresh ArrayBuffer (avoids SharedArrayBuffer
// inference issues with Uint8Array).
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).split("-").join("+").split("_").join("/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

type PermissionState = NotificationPermission | "unsupported";

interface UseWebPush {
  supported: boolean;
  permission: PermissionState;
  subscribed: boolean;
  loading: boolean;
  /** Request permission AND register subscription. Resolves to `true` if fully subscribed. */
  enable: () => Promise<boolean>;
  /** Remove subscription locally and on server. */
  disable: () => Promise<void>;
}

/**
 * Wraps Web Push registration: checks support, reflects permission state,
 * upserts the subscription on our edge function, and cleans up on disable.
 *
 * Callers only need `supported`, `subscribed`, and the enable/disable verbs.
 */
export function useWebPush(): UseWebPush {
  const { user } = useAuth();
  const supported = useMemo(
    () =>
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    [],
  );

  const [permission, setPermission] = useState<PermissionState>(
    supported ? Notification.permission : "unsupported",
  );
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Detect current subscription on mount / when user changes.
  useEffect(() => {
    if (!supported || !user) {
      setSubscribed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) {
          if (!cancelled) setSubscribed(false);
          return;
        }
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(!!sub);
      } catch {
        if (!cancelled) setSubscribed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, user]);

  const ensureRegistration = useCallback(async () => {
    // Register once; subsequent calls return the existing registration.
    const existing = await navigator.serviceWorker.getRegistration("/sw.js");
    if (existing) return existing;
    return navigator.serviceWorker.register("/sw.js");
  }, []);

  const enable = useCallback(async () => {
    if (!supported) return false;
    setLoading(true);
    try {
      // 1. Permission
      let perm = Notification.permission;
      if (perm === "default") {
        perm = await Notification.requestPermission();
      }
      setPermission(perm);
      if (perm !== "granted") return false;

      // 2. Service worker
      const reg = await ensureRegistration();
      await navigator.serviceWorker.ready;

      // 3. Subscribe (or reuse)
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      // 4. Persist on server. The subscription JSON includes endpoint + keys.
      const json = sub.toJSON() as {
        endpoint: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Invalid subscription payload");
      }
      const { error } = await supabase.functions.invoke("push-subscribe", {
        body: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          user_agent: navigator.userAgent,
        },
      });
      if (error) throw error;
      setSubscribed(true);
      return true;
    } catch (err) {
      console.error("enable push failed", err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [ensureRegistration, supported]);

  const disable = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const endpoint = sub.endpoint;
        try {
          await sub.unsubscribe();
        } catch {
          /* ignore */
        }
        try {
          await supabase.functions.invoke("push-unsubscribe", {
            body: { endpoint },
          });
        } catch {
          /* ignore — server cleanup is best-effort */
        }
      }
      setSubscribed(false);
    } finally {
      setLoading(false);
    }
  }, [supported]);

  return { supported, permission, subscribed, loading, enable, disable };
}
