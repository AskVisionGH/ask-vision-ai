import { useEffect, useState } from "react";
import { Check, Copy, Eye, Link2Off, Loader2, Pencil } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { ConversationRow, ShareMode } from "@/hooks/useConversations";

interface Props {
  conversation: ConversationRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Enables sharing with the chosen mode. Returns the share id. */
  onEnableShare: (mode: ShareMode) => Promise<string | null>;
  /** Updates the mode for an already-shared conversation. */
  onChangeMode: (mode: ShareMode) => Promise<boolean>;
  /** Disables sharing entirely. */
  onUnshare: () => Promise<void>;
}

/**
 * Lets the owner choose between read-only and importable sharing, copy the
 * link, or stop sharing entirely. Mode changes regenerate nothing — the share
 * URL stays the same so previously-pasted links keep working.
 */
export const ShareConversationDialog = ({
  conversation,
  open,
  onOpenChange,
  onEnableShare,
  onChangeMode,
  onUnshare,
}: Props) => {
  const initialMode: ShareMode = conversation?.share_mode ?? "read_only";
  const [mode, setMode] = useState<ShareMode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  // Sync the local selection whenever a different conversation is opened.
  useEffect(() => {
    if (open) {
      setMode(conversation?.share_mode ?? "read_only");
      setJustCopied(false);
    }
  }, [open, conversation?.id, conversation?.share_mode]);

  const isShared = !!conversation?.share_id;
  const shareUrl = isShared
    ? `${window.location.origin}/shared/${conversation!.share_id}`
    : null;

  const copyToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1800);
      toast.success("Share link copied");
    } catch {
      toast.success("Share link ready", { description: url });
    }
  };

  const handlePrimary = async () => {
    if (!conversation) return;
    setBusy(true);
    try {
      if (!isShared) {
        const id = await onEnableShare(mode);
        if (!id) {
          toast.error("Couldn't create share link");
          return;
        }
        await copyToClipboard(`${window.location.origin}/shared/${id}`);
      } else if (mode !== conversation.share_mode) {
        const ok = await onChangeMode(mode);
        if (!ok) {
          toast.error("Couldn't update share settings");
          return;
        }
        toast.success(
          mode === "importable"
            ? "Viewers can now import this chat"
            : "Set to read-only",
        );
      } else if (shareUrl) {
        await copyToClipboard(shareUrl);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnshare = async () => {
    setBusy(true);
    try {
      await onUnshare();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel = !isShared
    ? "Create link"
    : mode !== conversation?.share_mode
      ? "Save changes"
      : justCopied
        ? "Copied"
        : "Copy link";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share conversation</DialogTitle>
          <DialogDescription>
            Choose how people who open the link can interact with it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <ModeOption
            active={mode === "read_only"}
            onSelect={() => setMode("read_only")}
            icon={<Eye className="h-4 w-4" />}
            title="Read-only"
            description="Anyone with the link can view the messages but can't copy them into their own chat."
          />
          <ModeOption
            active={mode === "importable"}
            onSelect={() => setMode("importable")}
            icon={<Pencil className="h-4 w-4" />}
            title="Importable"
            description="Viewers can also import the conversation into their own account and continue it from there."
          />
        </div>

        {shareUrl && (
          <div className="rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 font-mono text-[11px] text-muted-foreground break-all">
            {shareUrl}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {isShared && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleUnshare}
              disabled={busy}
              className="mr-auto text-muted-foreground hover:text-destructive"
            >
              <Link2Off className="mr-1.5 h-3.5 w-3.5" />
              Stop sharing
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handlePrimary} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : justCopied && primaryLabel === "Copied" ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : isShared && mode === conversation?.share_mode ? (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            ) : null}
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface ModeOptionProps {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}

const ModeOption = ({ active, onSelect, icon, title, description }: ModeOptionProps) => (
  <button
    type="button"
    onClick={onSelect}
    className={cn(
      "flex items-start gap-3 rounded-lg border p-3 text-left ease-vision",
      active
        ? "border-primary/60 bg-primary/5"
        : "border-border/60 hover:border-border hover:bg-secondary/40",
    )}
  >
    <div
      className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
        active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
      )}
    >
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        {description}
      </p>
    </div>
    <div
      className={cn(
        "mt-1 h-3.5 w-3.5 shrink-0 rounded-full border",
        active
          ? "border-primary bg-primary"
          : "border-border/80",
      )}
      aria-hidden
    >
      {active && <Check className="h-3 w-3 text-primary-foreground" />}
    </div>
  </button>
);
