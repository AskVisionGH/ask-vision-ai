import { useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, MessageSquarePlus, MoreHorizontal, Pencil, Pin, PinOff, Settings as SettingsIcon, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { UserAvatar } from "@/components/UserAvatar";
import { VisionLogo } from "@/components/VisionLogo";
import { cn } from "@/lib/utils";
import type { ConversationRow } from "@/hooks/useConversations";

interface Props {
  conversations: ConversationRow[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}

export const ChatSidebar = ({
  conversations,
  activeId,
  loading,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onTogglePin,
}: Props) => {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ConversationRow | null>(null);

  const startRename = (c: ConversationRow) => {
    setRenamingId(c.id);
    setRenameValue(c.title);
  };

  const commitRename = () => {
    if (renamingId) onRename(renamingId, renameValue);
    setRenamingId(null);
  };

  return (
    <aside className="flex h-full w-full flex-col border-r border-border/60 bg-background/80 backdrop-blur-md">
      {/* Brand + new chat */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <VisionLogo size={20} />
          <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
            Vision
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onNew}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="New chat"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>

      {/* Quick links */}
      <div className="shrink-0 border-b border-border/60 px-2 py-2">
        <Link
          to="/contacts"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground ease-vision hover:bg-secondary/60 hover:text-foreground"
        >
          <Users className="h-3.5 w-3.5" />
          Contacts
        </Link>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground/60">Loading…</div>
        ) : conversations.length === 0 ? (
          <>
            <SectionHeader label="Conversations" />
            <div className="px-3 py-2 text-xs text-muted-foreground/60">
              No conversations yet.
            </div>
          </>
        ) : (
          (() => {
            const active = activeId ? conversations.find((c) => c.id === activeId) : null;
            const previous = conversations.filter((c) => c.id !== activeId);
            return (
              <>
                {active && (
                  <>
                    <SectionHeader label="Current" />
                    <ul className="mb-3 space-y-0.5">
                      {renderItem(active, true)}
                    </ul>
                  </>
                )}
                {previous.length > 0 && (
                  <>
                    <SectionHeader label={active ? "Previous" : "Conversations"} />
                    <ul className="space-y-0.5">
                      {previous.map((c) => renderItem(c, false))}
                    </ul>
                  </>
                )}
              </>
            );

            function renderItem(c: ConversationRow, isActive: boolean) {
              const isRenaming = c.id === renamingId;
              return (
                <li key={c.id} className="group relative">
                  {isRenaming ? (
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="h-8 text-xs"
                    />
                  ) : (
                    <button
                      onClick={() => onSelect(c.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ease-vision",
                        isActive
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                          isActive ? "bg-up shadow-[0_0_6px_hsl(var(--up))]" : "bg-muted-foreground/30",
                        )}
                        aria-hidden
                      />
                      <span className="truncate flex-1">{c.title}</span>
                    </button>
                  )}

                  {!isRenaming && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className={cn(
                            "absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100",
                            isActive && "opacity-100",
                          )}
                          aria-label="Conversation options"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={() => startRename(c)}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setPendingDelete(c)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            }
          })()
        )}
      </div>

      {/* User footer */}
      <div className="shrink-0 border-t border-border/60 px-3 py-3">
        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 -m-1.5 text-left ease-vision hover:bg-secondary/60"
          >
            <UserAvatar
              name={profile?.display_name}
              email={user?.email}
              src={profile?.avatar_url}
              size={32}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-foreground">
                {profile?.display_name?.trim() || user?.email || "Account"}
              </p>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Settings"
          >
            <Link to="/settings">
              <SettingsIcon className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => signOut()}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.title}" and its messages will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
};

const SectionHeader = ({ label }: { label: string }) => (
  <div className="px-3 pb-1 pt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
    {label}
  </div>
);

