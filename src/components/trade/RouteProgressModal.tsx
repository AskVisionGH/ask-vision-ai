// RouteProgressModal — unified progress modal for the multi-leg swap executor.
//
// Bridge-only flows (single LI.FI hop) and bridge+swap flows (LI.FI hop +
// destination Jupiter/0x swap) both have multiple visible phases that take
// many seconds each. Inline CTA text isn't enough to make those phases
// observable — users assume it's stuck. This modal renders a checklist of
// per-leg steps driven entirely by the `ExecutorStatus` stream emitted by
// `useRouteExecutor`, plus a shared success/error footer.
//
// The modal is purely presentational: it derives steps from
//   - the static `RoutePlan` (what legs we *will* run)
//   - the live `ExecutorStatus` (where we currently are)
// so it stays in lockstep with the executor without needing its own state
// machine. Same-chain swaps still get a modal but with a single compact step
// list — gives every flow the same "transactional" feel.
//
// Closing rules mirror BridgeProgressModal: blocked while any tx is in
// flight, then allowed once the executor reaches success / error / cancelled.

import { CheckCircle2, Loader2, Circle, ExternalLink, XCircle, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ExecutorStatus, RoutePlan } from "@/components/trade/useRouteExecutor";
import type { ChainKey, MultichainToken } from "@/components/trade/MultichainTokenPickerDialog";

type StepStatus = "pending" | "active" | "done" | "error";

interface Step {
  id: string;
  label: string;
  status: StepStatus;
  hint?: string;
  explorerUrl?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  plan: RoutePlan | null;
  status: ExecutorStatus;
  fromToken: MultichainToken;
  toToken: MultichainToken | null;
  /** Called when the user dismisses after success/error. */
  onDone: () => void;
}

const isSol = (c: ChainKey) => String(c).toUpperCase() === "SOL";
const CHAIN_LABEL: Record<string, string> = {
  SOL: "Solana",
  "1": "Ethereum",
  "10": "Optimism",
  "56": "BNB Chain",
  "137": "Polygon",
  "8453": "Base",
  "42161": "Arbitrum",
  "43114": "Avalanche",
  "59144": "Linea",
  "534352": "Scroll",
};
const chainLabel = (c: ChainKey) => CHAIN_LABEL[String(c)] ?? `Chain ${c}`;
const truncSig = (s: string) => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);

// ---- Step derivation ------------------------------------------------------

/**
 * Produce the visible step list for the current plan + status.
 *
 * Strategy → step blueprint:
 *   - swap (same chain)         : [build, sign, confirm]
 *   - bridge                    : [build, (approve), sign, confirm, settle]
 *   - bridge_then_swap          : [build, (approve), sign, confirm, settle, build dest, sign dest, confirm dest]
 *
 * We mark each step pending/active/done based on `status.kind` + `legIndex`.
 * Approvals are tracked dynamically — we only insert the "approve" step on
 * EVM legs, and we hide it again once we move past it on a flow that didn't
 * actually need an allowance bump (the executor will skip straight to
 * awaiting_signature).
 */
function deriveSteps(plan: RoutePlan, status: ExecutorStatus): Step[] {
  const steps: Step[] = [];
  const cur = status;

  const isLegDone = (legIndex: number) => {
    // A leg is done when status has moved past confirming for that leg
    if (cur.kind === "success") return true;
    if (cur.kind === "bridging") return legIndex < 0; // bridging belongs to leg 0 settle
    if ("legIndex" in cur) return cur.legIndex > legIndex;
    return false;
  };

  // Helper to score a step against the live status.
  const stepStatus = (
    matches: (s: ExecutorStatus) => boolean,
    pastWhen: (s: ExecutorStatus) => boolean,
  ): StepStatus => {
    if (cur.kind === "error") {
      // The currently-active phase is the one that errored.
      if (matches(prevNonError(cur))) return "error";
      if (pastWhen(prevNonError(cur))) return "done";
      return "pending";
    }
    if (matches(cur)) return "active";
    if (pastWhen(cur)) return "done";
    return "pending";
  };

  plan.legs.forEach((leg, i) => {
    const chainName = chainLabel(leg.chain);
    const isBridge = leg.kind === "bridge";
    const evm = !isSol(leg.chain);

    // Build step
    steps.push({
      id: `${i}-build`,
      label: isBridge
        ? `Building bridge route (${chainName})`
        : plan.legs.length > 1
          ? `Building destination swap on ${chainName}`
          : `Building swap on ${chainName}`,
      status: stepStatus(
        (s) => s.kind === "building" && s.legIndex === i,
        (s) => isAfterPhase(s, i, "build"),
      ),
    });

    // Switch chain (EVM only, non-Vision wallets typically). We surface it
    // as a dedicated step only if the executor actually emits switching_chain
    // for this leg — otherwise we just hide it.
    if (evm) {
      const switchActive = cur.kind === "switching_chain" && cur.legIndex === i;
      const switchPast =
        isAfterPhase(cur, i, "switch") ||
        // If we never saw a switch event but moved past, treat as done silently
        (isAfterPhase(cur, i, "build") && !switchActive && cur.kind !== "error");
      if (switchActive || switchPast) {
        steps.push({
          id: `${i}-switch`,
          label: `Switching wallet to ${chainName}`,
          status: switchActive ? "active" : "done",
        });
      }

      // Approve step — only show once we've actually started approving or
      // moved past it explicitly. Pre-flight we don't know if approval is
      // needed (allowance might be sufficient).
      const approveActive =
        cur.kind === "approving" && cur.legIndex === i;
      const approveTx =
        cur.kind === "approving" && cur.legIndex === i ? cur.hash : undefined;
      if (approveActive) {
        steps.push({
          id: `${i}-approve`,
          label: `Approving token spend`,
          status: "active",
          hint: approveTx ? `tx ${truncSig(approveTx)}` : "Confirm in wallet",
        });
      }
    }

    // Sign + submit step
    steps.push({
      id: `${i}-sign`,
      label: isBridge
        ? `Sign bridge tx`
        : plan.legs.length > 1
          ? `Sign destination swap`
          : `Sign swap`,
      status: stepStatus(
        (s) =>
          (s.kind === "awaiting_signature" || s.kind === "submitting") &&
          s.legIndex === i,
        (s) => isAfterPhase(s, i, "sign"),
      ),
    });

    // Confirm on-chain
    const confirmHash =
      cur.kind === "confirming" && cur.legIndex === i ? cur.hash : undefined;
    const confirmExplorer =
      cur.kind === "confirming" && cur.legIndex === i ? cur.explorer : undefined;
    steps.push({
      id: `${i}-confirm`,
      label: `Confirming on ${chainName}`,
      status: stepStatus(
        (s) => s.kind === "confirming" && s.legIndex === i,
        (s) => isAfterPhase(s, i, "confirm"),
      ),
      hint: confirmHash ? `tx ${truncSig(confirmHash)}` : undefined,
      explorerUrl: confirmExplorer,
    });

    // Bridge-settle step (only for bridge legs — we wait for LI.FI to confirm
    // the destination side has landed before we either finish or move on to
    // the next leg).
    if (isBridge) {
      const bridgingActive = cur.kind === "bridging";
      const bridgingPast =
        cur.kind === "success" ||
        (("legIndex" in cur) && cur.legIndex > i);
      const bridgeHint =
        cur.kind === "bridging"
          ? cur.estimatedSec
            ? `≈ ${Math.round(cur.estimatedSec / 60)} min on the destination chain`
            : "Waiting for destination chain to settle"
          : undefined;
      const bridgeExplorer = cur.kind === "bridging" ? cur.explorer : undefined;
      steps.push({
        id: `${i}-settle`,
        label: `Bridge settlement`,
        status: stepStatus(
          (s) => s.kind === "bridging",
          (s) => s.kind === "success" || (("legIndex" in s) && s.legIndex > i),
        ),
        hint: bridgingActive ? bridgeHint : bridgingPast ? "Funds delivered" : undefined,
        explorerUrl: bridgeExplorer,
      });
    }
  });

  return steps;
}

// Returns whichever non-error status preceded the error, falling back to a
// synthetic "idle" so step matching can still run. The executor doesn't carry
// the prior status across an error transition, so we just treat error as a
// terminal overlay applied to whatever the *last* known step was — which we
// approximate as "the phase that was active when the error happened". For
// rendering purposes the simplest approach is to keep all earlier steps
// 'done' (caller's status was past them) and mark the active one as error.
function prevNonError(s: ExecutorStatus): ExecutorStatus {
  return s.kind === "error" ? { kind: "idle" } : s;
}

type Phase = "build" | "switch" | "approve" | "sign" | "confirm" | "settle";

/** Did `s` move past `phase` of leg `legIndex`? Conservative — false when unsure. */
function isAfterPhase(s: ExecutorStatus, legIndex: number, phase: Phase): boolean {
  if (s.kind === "success") return true;
  if (s.kind === "bridging") {
    // bridging belongs to leg 0 settle, so it's strictly past confirm-leg-0
    if (phase === "build" || phase === "switch" || phase === "approve" || phase === "sign" || phase === "confirm") {
      return legIndex <= 0;
    }
    return false;
  }
  if (!("legIndex" in s)) return false;

  if (s.legIndex > legIndex) return true;
  if (s.legIndex < legIndex) return false;

  // Same leg — order phases.
  const order: Phase[] = ["build", "switch", "approve", "sign", "confirm", "settle"];
  const phaseToKinds: Record<Phase, ExecutorStatus["kind"][]> = {
    build: ["building"],
    switch: ["switching_chain"],
    approve: ["approving"],
    sign: ["awaiting_signature", "submitting"],
    confirm: ["confirming"],
    settle: ["bridging"],
  };
  const curIdx = order.findIndex((p) => phaseToKinds[p].includes(s.kind));
  const targetIdx = order.indexOf(phase);
  return curIdx > targetIdx;
}

// ---- View -----------------------------------------------------------------

const StepIcon = ({ status }: { status: StepStatus }) => {
  if (status === "active") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-up" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
  return <Circle className="h-4 w-4 text-muted-foreground/40" />;
};

export const RouteProgressModal = ({
  open,
  onOpenChange,
  plan,
  status,
  fromToken,
  toToken,
  onDone,
}: Props) => {
  // Don't render the modal at all when there's nothing meaningful to show
  // (idle / no plan). We open it the moment the executor leaves idle and
  // close it when the user dismisses success / error / cancelled.
  if (!plan) return null;

  const steps = deriveSteps(plan, status);

  const busy =
    status.kind === "building" ||
    status.kind === "approving" ||
    status.kind === "switching_chain" ||
    status.kind === "awaiting_signature" ||
    status.kind === "submitting" ||
    status.kind === "confirming" ||
    status.kind === "bridging";

  const errorMessage = status.kind === "error" ? status.message : null;
  const succeeded = status.kind === "success";
  const cancelled = status.kind === "cancelled";

  const headerLabel = (() => {
    if (plan.strategy === "swap") return succeeded ? "Swap complete" : errorMessage ? "Swap failed" : cancelled ? "Swap cancelled" : "Swapping…";
    if (plan.strategy === "bridge") return succeeded ? "Bridge complete" : errorMessage ? "Bridge failed" : cancelled ? "Bridge cancelled" : "Bridging…";
    return succeeded ? "Bridge & swap complete" : errorMessage ? "Bridge & swap failed" : cancelled ? "Cancelled" : "Bridging & swapping…";
  })();

  const subline = (() => {
    if (!toToken) return null;
    return `${fromToken.symbol} on ${chainLabel(fromToken.chainId)} → ${toToken.symbol} on ${chainLabel(toToken.chainId)}`;
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm gap-0 overflow-hidden p-0">
        <div className="border-b border-border/60 px-5 pb-3 pt-5">
          <DialogTitle className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {headerLabel}
          </DialogTitle>
          {subline && (
            <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/80">
              {subline}
            </p>
          )}
        </div>

        <div className="px-5 py-4">
          {cancelled ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <XCircle className="h-7 w-7 text-muted-foreground" />
              <p className="font-mono text-[11px] text-muted-foreground">
                No funds were moved.
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {steps.map((step, i) => {
                const isLast = i === steps.length - 1;
                const muted = step.status === "pending";
                return (
                  <li key={step.id} className="relative flex gap-3">
                    {!isLast && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute left-2 top-5 h-[calc(100%+0.25rem)] w-px",
                          step.status === "done" ? "bg-up/40" : "bg-border/60",
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
          )}

          {errorMessage && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <p className="text-[11px] leading-relaxed text-destructive/90">
                {errorMessage}
              </p>
            </div>
          )}

          {(succeeded || errorMessage || cancelled) && (
            <Button
              onClick={onDone}
              className="ease-vision mt-4 w-full font-mono text-[11px] uppercase tracking-wider"
            >
              {succeeded ? "Done" : errorMessage ? "Try again" : "Close"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
