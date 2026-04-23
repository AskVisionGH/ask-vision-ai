import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type Mode = "wipe" | "full";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  userEmail: string;
  /** Called after the server confirms success. Caller should sign out / redirect. */
  onConfirmed: (mode: Mode) => void;
}

const COPY: Record<Mode, { title: string; warning: string; cta: string }> = {
  wipe: {
    title: "Clear all your data",
    warning:
      "This wipes your conversations, contacts, profile, and connected wallets — but keeps your account so you can sign in fresh. Cannot be undone.",
    cta: "Clear my data",
  },
  full: {
    title: "Delete your account",
    warning:
      "This permanently deletes your account and everything tied to it: conversations, contacts, profile, wallets. Cannot be undone.",
    cta: "Delete my account",
  },
};

export const DeleteAccountDialog = ({
  open,
  onOpenChange,
  mode,
  userEmail,
  onConfirmed,
}: Props) => {
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const matches = confirm.trim().toLowerCase() === userEmail.toLowerCase();
  const copy = COPY[mode];

  const handleClose = (next: boolean) => {
    if (submitting) return; // don't let them dismiss mid-flight
    if (!next) setConfirm("");
    onOpenChange(next);
  };

  const submit = async () => {
    if (!matches || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { confirmEmail: confirm.trim(), mode },
      });
      if (error || !data?.ok) {
        const msg = (data as any)?.error ?? error?.message ?? "Couldn't complete the request";
        toast.error("Something went wrong", { description: msg });
        setSubmitting(false);
        return;
      }
      onConfirmed(mode);
    } catch (e) {
      toast.error("Network error", {
        description: e instanceof Error ? e.message : "Try again in a moment.",
      });
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <DialogTitle className="text-left">{copy.title}</DialogTitle>
          <DialogDescription className="text-left">{copy.warning}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="confirm-email" className="text-xs uppercase tracking-wider text-muted-foreground">
            Type your email to confirm
          </Label>
          <Input
            id="confirm-email"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={userEmail}
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            className={cn(
              "font-mono text-sm",
              confirm && !matches && "border-destructive/60",
            )}
          />
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleClose(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={submit}
            disabled={!matches || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Working…
              </>
            ) : (
              copy.cta
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
