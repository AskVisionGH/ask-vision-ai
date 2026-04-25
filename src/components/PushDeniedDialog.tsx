import { useMemo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
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

type Browser = "chrome" | "edge" | "firefox" | "safari" | "brave" | "other";

/**
 * Best-effort UA sniff. We only need this to pick which set of step-by-step
 * instructions to show — failure mode is benign (we show generic steps).
 */
const detectBrowser = (): Browser => {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  // Order matters: Edge/Brave both contain "chrome".
  if (ua.includes("edg/")) return "edge";
  if ((navigator as unknown as { brave?: unknown }).brave) return "brave";
  if (ua.includes("firefox")) return "firefox";
  if (ua.includes("safari") && !ua.includes("chrome")) return "safari";
  if (ua.includes("chrome")) return "chrome";
  return "other";
};

const STEPS: Record<Browser, string[]> = {
  chrome: [
    "Click the lock or tune icon to the left of the URL in the address bar.",
    "Open 'Site settings' (or 'Permissions for this site').",
    "Find 'Notifications' and switch it from Block to Allow.",
    "Come back here and tap Retry below.",
  ],
  edge: [
    "Click the lock icon to the left of the URL.",
    "Open 'Permissions for this site'.",
    "Set 'Notifications' to Allow.",
    "Come back here and tap Retry below.",
  ],
  brave: [
    "Click the lock icon to the left of the URL.",
    "Open 'Site settings'.",
    "Set 'Notifications' to Allow (you may also need to disable Brave Shields for this site).",
    "Come back here and tap Retry below.",
  ],
  firefox: [
    "Click the lock icon to the left of the URL.",
    "Click the > arrow next to 'Connection secure', then 'More information' → 'Permissions'.",
    "Find 'Send Notifications' and uncheck 'Use Default' / 'Block', then choose Allow.",
    "Come back here and tap Retry below.",
  ],
  safari: [
    "Open Safari → Settings → Websites → Notifications.",
    "Find this site in the list and set it to Allow.",
    "On iOS: Settings → Safari → Advanced → Website Data, then re-grant from the share menu.",
    "Come back here and tap Retry below.",
  ],
  other: [
    "Open this site's permissions from your browser's address bar (usually a lock icon).",
    "Find Notifications and set it to Allow.",
    "Reload the page if needed.",
    "Tap Retry below once you're done.",
  ],
};

interface Props {
  open: boolean;
  busy?: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

export const PushDeniedDialog = ({ open, busy, onRetry, onDismiss }: Props) => {
  const browser = useMemo(detectBrowser, []);
  const steps = STEPS[browser] ?? STEPS.other;
  const browserLabel =
    browser === "other" ? "your browser" : browser[0].toUpperCase() + browser.slice(1);

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onDismiss()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <AlertDialogTitle className="text-center">
            Notifications are blocked
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {browserLabel} is currently blocking us. Browsers don't let apps
            re-ask once denied — you'll need to flip it back on manually.
            Takes 10 seconds:
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ol className="space-y-2 rounded-xl border border-border bg-card/40 p-4 text-xs text-muted-foreground">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] text-primary">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Close</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onRetry();
            }}
            disabled={busy}
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            Retry
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
