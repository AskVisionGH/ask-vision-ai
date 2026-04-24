import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

const urlBase64ToUint8Array = (base64: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
};

const isSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/**
 * Manages the browser's Web Push subscription.
 * Registers `/sw.js`, requests permission on demand, subscribes with the
 * VAPID public key from `push-vapid-key`, and stores the subscription via
 * `push-subscribe`. Mirrors unsubscribe via `push-unsubscribe`.
 */
export const useWebPush = () => {
  const [permission, setPermission] = useState<PermissionState>(() =>
    isSupported() ? (Notification.permission as PermissionState) : "unsupported",
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSupported()) {
      setPermission("unsupported");
      setSubscribed(false);
      return;
    }
    setPermission(Notification.permission as PermissionState);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    } catch {
      setSubscribed(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!isSupported()) return false;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") return false;

      // Register SW (idempotent).
      const reg =
        (await navigator.serviceWorker.getRegistration("/sw.js")) ??
        (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;

      // Fetch VAPID public key.
      const { data: keyData, error: keyErr } = await supabase.functions.invoke(
        "push-vapid-key",
      );
      if (keyErr || !keyData?.publicKey) return false;

      // Subscribe (reuse existing sub if present).
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        }));

      const raw = sub.toJSON();
      if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) return false;

      const { error } = await supabase.functions.invoke("push-subscribe", {
        body: {
          endpoint: raw.endpoint,
          keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
          user_agent: navigator.userAgent,
        },
      });
      if (error) return false;

      setSubscribed(true);
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<boolean> => {
    if (!isSupported()) return false;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.functions.invoke("push-unsubscribe", {
          body: { endpoint: sub.endpoint },
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    supported: permission !== "unsupported",
    permission,
    subscribed,
    busy,
    enable,
    disable,
    refresh,
  };
};
