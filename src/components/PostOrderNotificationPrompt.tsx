import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { useWebPush } from "@/hooks/useWebPush";

/**
 * Global one-time post-order upsell for notifications.
 *
 * Subscribes to `tx_events` INSERT for the signed-in user. When the
 * first event arrives AND prefs.post_order_prompt_seen is false,
 * the dialog opens. Any of the three choices flips the flag so it
 * never fires again.
 *
 * Render this once near the app root (inside AuthProvider).
 */
export const PostOrderNotificationPrompt = () => {
  const { user } = useAuth();
  const { prefs, update } = useNotificationPreferences();
  const push = useWebPush();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Subscribe to the user's own tx_events. The first INSERT we see, if they
  // haven't already dismissed the prompt, opens the dialog.
  useEffect(() => {
    if (!user) return;
    if (!prefs) return;
    if (prefs.post_order_prompt_seen) return;

    const channel = supabase
      .channel(`post-order-prompt:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tx_events",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          setOpen(true);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, prefs?.post_order_prompt_seen]);

  const markSeen = async () => {
    await update({ post_order_prompt_seen: true });
  };

  const handleClose = async () => {
    await markSeen();
    setOpen(false);
  };

  const enableAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Enable master + all categories + subscribe to push.
      const ok = push.supported ? await push.enable() : false;
      await update({
        master_enabled: true,
        cat_price: true,
        cat_wallet_activity: true,
        cat_order_fills: true,
        cat_news_sentiment: true,
        channel_in_app: true,
        channel_web_push: ok,
        post_order_prompt_seen: true,
      });
      if (ok) {
        toast.success("Notifications on", {
          description: "We'll ping you when orders fill and more.",
        });
      } else if (push.supported) {
        toast.message("Enabled in-app only", {
          description:
            "Browser permission was denied — we'll notify you in the bell.",
        });
      } else {
        toast.success("In-app notifications on");
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const inAppOnly = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await update({
        master_enabled: true,
        cat_price: true,
        cat_wallet_activity: true,
        cat_order_fills: true,
        cat_news_sentiment: true,
        channel_in_app: true,
        channel_web_push: false,
        post_order_prompt_seen: true,
      });
      toast.success("In-app notifications on");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <DialogTitle className="text-center">
            Want Vision to ping you?
          </DialogTitle>
          <DialogDescription className="text-center">
            Get notified when your orders fill, wallets you track make big
            moves, or prices hit your levels.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 rounded-xl border border-border bg-background/40 p-4 text-xs text-muted-foreground">
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3 w-3 text-primary" />
            Order fills (limit, DCA, TP/SL)
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3 w-3 text-primary" />
            Smart-money wallet activity
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3 w-3 text-primary" />
            Price moves on your holdings
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3 w-3 text-primary" />
            Breaking news & sentiment shifts
          </li>
        </ul>

        <p className="text-center text-[11px] text-muted-foreground/70">
          You can fine-tune categories and quiet hours any time in{" "}
          <Link to="/settings#notifications" className="underline">
            Settings
          </Link>
          .
        </p>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={enableAll}
            disabled={busy}
            className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {busy ? "Enabling…" : "Enable notifications"}
          </Button>
          <Button
            onClick={inAppOnly}
            disabled={busy}
            variant="outline"
            className="w-full rounded-full"
          >
            Just in-app
          </Button>
          <Button
            onClick={handleClose}
            disabled={busy}
            variant="ghost"
            className="w-full rounded-full text-muted-foreground"
          >
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
