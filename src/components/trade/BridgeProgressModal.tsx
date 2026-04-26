import { CheckCircle2, Loader2, Circle, ExternalLink, XCircle, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Progress modal for the EVM-source bridge flow.
 *
 * Each EVM bridge from an ERC-20 token requires three on-chain actions
 * stitched together:
 *   1. Switch the wallet to the source chain (if not already on it)
 *   2. Approve LI.FI's router to spend the token (only first time per
 *      token+spender, or when allowance < amount)
 *   3. Sign + submit the bridge tx itself
 *
 * Inline status text in the CTA isn't enough to make this clear — users
 * regularly think the flow is stuck after the approval popup closes
 * because the wallet is "doing nothing" while we wait for the receipt.
 * This modal shows a checklist with live spinners + tx links so each
 * step is observable.
 */

export type BridgeStepStatus = "pending" | "active" | "done" | "error" | "skipped";

export interface BridgeStep {
  id: "switch" | "approve" | "sign" | "confirm" | "bridge";
  label: string;
  status: BridgeStepStatus;
  /** Optional helper text shown beneath the label (e.g. tx hash, message). */
  hint?: string;
  /** Optional explorer URL for the tx that ran during this step. */
  explorerUrl?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  steps: BridgeStep[];
  /** True while any step is still in flight — disables the close button. */
  busy: boolean;
  errorMessage?: string | null;
  /** Optional title override. Defaults to "Bridging…" / "Bridge complete". */
  title?: string;
  /** Final state — when true the modal shows a "Done" CTA. */
  succeeded?: boolean;
  onPrimaryAction?: () => void;
  primaryLabel?: string;
}

const StepIcon = ({ status }: { status: BridgeStepStatus }) => {
  if (status === "active") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-up" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "skipped") return <Circle className="h-4 w-4 text-muted-foreground/30" />;
  return <Circle className="h-4 w-4 text-muted-foreground/40" />;
};

export const BridgeProgressModal = ({
  open,
  onOpenChange,
  steps,
  busy,
  errorMessage,
  title,
  succeeded,
  onPrimaryAction,
  primaryLabel,
}: Props) => {
  const computedTitle =
    title ?? (succeeded ? "Bridge complete" : errorMessage ? "Bridge failed" : "Bridging…");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block closing while a tx is still pending — closing the modal
        // doesn't cancel the wallet popup, and reopening it after the user
        // signs gets messy. Once succeeded/errored we let them dismiss.
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-sm gap-0 overflow-hidden p-0"
        showCloseButton={!busy}
      >
        <div className="border-b border-border/60 px-5 pb-3 pt-5">
          <DialogTitle className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {computedTitle}
          </DialogTitle>
        </div>

        <div className="px-5 py-4">
          <ol className="space-y-3">
            {steps.map((step, i) => {
              const isLast = i === steps.length - 1;
              const muted =
                step.status === "pending" || step.status === "skipped";
              return (
                <li key={step.id} className="relative flex gap-3">
                  {/* Connector line between step icons */}
                  {!isLast && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-2 top-5 h-[calc(100%+0.25rem)] w-px",
                        step.status === "done"
                          ? "bg-up/40"
                          : "bg-border/60",
                      )}
                    />
                  )}
                  <div className="relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    <StepIcon status={step.status} />
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <p
                      className={cn(
                        "text-sm",
                        muted ? "text-muted-foreground/70" : "text-foreground",
                        step.status === "active" && "font-medium",
                      )}
                    >
                      {step.label}
                      {step.status === "skipped" && (
                        <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50">
                          skipped
                        </span>
                      )}
                    </p>
                    {step.hint && (
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                        {step.hint}
                      </p>
                    )}
                    {step.explorerUrl && (
                      <a
                        href={step.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ease-vision mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
                      >
                        View tx
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {errorMessage && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <p className="text-[11px] leading-relaxed text-destructive/90">
                {errorMessage}
              </p>
            </div>
          )}

          {(succeeded || errorMessage) && onPrimaryAction && (
            <Button
              onClick={onPrimaryAction}
              className="ease-vision mt-4 w-full font-mono text-[11px] uppercase tracking-wider"
            >
              {primaryLabel ?? (succeeded ? "Done" : "Close")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
