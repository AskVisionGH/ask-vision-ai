import { Bell, Check, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Friendly pre-prompt shown BEFORE the native browser permission dialog.
 *
 * Browsers permanently block notifications if a user dismisses the native
 * prompt cold (Chrome's "quiet UI", Safari's permanent denial). By
 * explaining value first and only firing the native prompt on an explicit
 * click, we dramatically improve the grant rate AND avoid getting stuck
 * in the un-recoverable "denied" state.
 *
 * Caller is responsible for:
 *  - Deciding when to open this (e.g. once per user, on Alerts entry).
 *  - Calling `useWebPush().enable()` from `onEnable` and showing the
 *    appropriate recovery UI if it returns false.
 */
interface Props {
  open: boolean;
  busy?: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}

export const PushEnableDialog = ({ open, busy, onEnable, onDismiss }: Props) => {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onDismiss()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <AlertDialogTitle className="text-center">
            Get notified the moment it matters
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Turn on browser notifications so we can ping you instantly when
            your alerts trigger — even when Vision isn't open.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="space-y-2 rounded-xl border border-border bg-card/40 p-4 text-xs text-muted-foreground">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>Order fills, price moves, and tracked-wallet activity in real time.</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>Quiet hours respected — we never wake you at 3 AM.</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>Toggle off any time from Alerts → Preferences.</span>
          </li>
        </ul>

        <p className="text-center text-[11px] text-muted-foreground/70">
          Your browser will show its own permission prompt next. Tap{" "}
          <span className="font-medium text-foreground">Allow</span> to finish.
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Not now</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onEnable();
            }}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Enabling…
              </>
            ) : (
              "Enable notifications"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
