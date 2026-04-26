import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PushEnableDialog } from "@/components/PushEnableDialog";
import { PushDeniedDialog } from "@/components/PushDeniedDialog";
import { useAuth } from "@/hooks/useAuth";
import { useWebPush } from "@/hooks/useWebPush";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";

/**
 * One-time "Enable notifications" pre-prompt for the Chat page.
 *
 * Shown automatically the first time a logged-in user lands on /chat IF:
 *   - The browser supports Web Push.
 *   - Permission is still in the default state (never granted, never
 *     explicitly denied — denied state would just be annoying).
 *   - We haven't already recorded `chat_push_prompt_seen = true` for them.
 *
 * Mirrors the Alerts page UX: friendly pre-prompt → native permission
 * → on success, flips master_enabled + channel_web_push so the user
 * actually starts receiving notifications without a second trip to
 * Alerts → Preferences.
 *
 * The "seen" flag is server-side (notification_preferences table) so it
 * follows the user across devices and isn't reset by clearing storage.
 */
const SHOW_DELAY_MS = 1500;

export const ChatPushPrompt = () => {
  const { user } = useAuth();
  const { prefs, loading, update } = useNotificationPreferences();
  const push = useWebPush();
  const [open, setOpen] = useState(false);
  const [deniedOpen, setDeniedOpen] = useState(false);
  const decidedRef = useRef(false);

  useEffect(() => {
    // Only consider opening once per mount, after we know the user's prefs.
    if (decidedRef.current) return;
    if (!user || loading || !prefs) return;
    if (!push.supported) return;
    if (prefs.chat_push_prompt_seen) return;
    if (push.permission !== "default") {
      // Already granted or denied — record as seen so we never re-prompt,
      // but don't pop a dialog.
      decidedRef.current = true;
      void update({ chat_push_prompt_seen: true });
      return;
    }
    decidedRef.current = true;
    const t = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [user, loading, prefs, push.supported, push.permission, update]);

  const markSeen = () => {
    void update({ chat_push_prompt_seen: true });
  };

  const handleEnable = async () => {
    const ok = await push.enable();
    if (ok) {
      // Make sure the master switch + web-push channel are on so the
      // permission they just granted actually delivers notifications.
      await update({
        chat_push_prompt_seen: true,
        master_enabled: true,
        channel_web_push: true,
      });
      setOpen(false);
      toast.success("Notifications enabled");
    } else if (push.permission === "denied") {
      // Native prompt was answered with "Block".
      markSeen();
      setOpen(false);
      setDeniedOpen(true);
    } else {
      // User cancelled or some other failure — close gracefully and don't
      // nag again. They can re-enable from Alerts → Preferences.
      markSeen();
      setOpen(false);
    }
  };

  const handleDismiss = () => {
    markSeen();
    setOpen(false);
  };

  return (
    <>
      <PushEnableDialog
        open={open}
        busy={push.busy}
        onEnable={handleEnable}
        onDismiss={handleDismiss}
      />
      <PushDeniedDialog
        open={deniedOpen}
        onRetry={() => setDeniedOpen(false)}
        onDismiss={() => setDeniedOpen(false)}
      />
    </>
  );
};
