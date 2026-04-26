import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftRight,
  Bell,
  GripVertical,
  Link2,
  Link2Off,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Radar,
  Repeat,
  Search,
  Settings as SettingsIcon,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useProfile } from "@/hooks/useProfile";
import { UserAvatar } from "@/components/UserAvatar";
import { VisionLogo } from "@/components/VisionLogo";
import { cn } from "@/lib/utils";
import type { ConversationRow } from "@/hooks/useConversations";

interface Props {
  conversations: ConversationRow[];
  activeId: string | null;
  loading: boolean;
  /** Conversations matching the user's search query, by id. Empty/null = no filter. */
  searchHits: Set<string> | null;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onReorderPinned: (orderedIds: string[]) => void;
  onShare: (c: ConversationRow) => void;
  onUnshare: (c: ConversationRow) => void;
  /** When true, renders a narrow icon-only rail. */
  collapsed?: boolean;
  /** Toggle collapse state (desktop only). */
  onToggleCollapsed?: () => void;
}

interface RowProps {
  conversation: ConversationRow;
  isActive: boolean;
  isRenaming: boolean;
  renameValue: string;
  onSelect: (id: string) => void;
  onStartRename: (c: ConversationRow) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onChangeRename: (v: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onRequestDelete: (c: ConversationRow) => void;
  onShare: (c: ConversationRow) => void;
  onUnshare: (c: ConversationRow) => void;
  draggable?: boolean;
}

const ConversationRowItem = ({
  conversation: c,
  isActive,
  isRenaming,
  renameValue,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onChangeRename,
  onTogglePin,
  onRequestDelete,
  onShare,
  onUnshare,
  draggable = false,
}: RowProps) => {
  const sortable = useSortable({ id: c.id, disabled: !draggable });
  const style = draggable
    ? {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.5 : 1,
      }
    : undefined;

  const isShared = !!c.share_id;

  return (
    <li
      ref={draggable ? sortable.setNodeRef : undefined}
      style={style}
      className="group relative"
    >
      {isRenaming ? (
        <Input
          autoFocus
          value={renameValue}
          onChange={(e) => onChangeRename(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onCancelRename();
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
          {draggable ? (
            <button
              type="button"
              {...sortable.attributes}
              {...sortable.listeners}
              onClick={(e) => e.stopPropagation()}
              className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 cursor-grab active:cursor-grabbing"
              aria-label="Drag to reorder"
              tabIndex={-1}
            >
              <GripVertical className="h-3 w-3" />
            </button>
          ) : (
            <span
              className={cn(
                "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                isActive
                  ? "bg-up shadow-[0_0_6px_hsl(var(--up))]"
                  : "bg-muted-foreground/30",
              )}
              aria-hidden
            />
          )}
          <span className="truncate flex-1">{c.title}</span>
          {isShared && (
            <Link2
              className="h-3 w-3 flex-shrink-0 text-primary/70"
              aria-label="Shared"
            />
          )}
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
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onTogglePin(c.id, !c.pinned)}>
              {c.pinned ? (
                <>
                  <PinOff className="mr-2 h-3.5 w-3.5" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="mr-2 h-3.5 w-3.5" />
                  Pin
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStartRename(c)}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onShare(c)}>
              <Link2 className="mr-2 h-3.5 w-3.5" />
              {isShared ? "Manage share…" : "Share…"}
            </DropdownMenuItem>
            {isShared && (
              <DropdownMenuItem onClick={() => onUnshare(c)}>
                <Link2Off className="mr-2 h-3.5 w-3.5" />
                Stop sharing
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onRequestDelete(c)}
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
};

export const ChatSidebar = ({
  conversations,
  activeId,
  loading,
  searchHits,
  searchQuery,
  onSearchQueryChange,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onTogglePin,
  onReorderPinned,
  onShare,
  onUnshare,
  collapsed = false,
  onToggleCollapsed,
}: Props) => {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { isAdmin } = useIsAdmin();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ConversationRow | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const startRename = (c: ConversationRow) => {
    setRenamingId(c.id);
    setRenameValue(c.title);
  };

  const commitRename = () => {
    if (renamingId) onRename(renamingId, renameValue);
    setRenamingId(null);
  };

  // Apply the search filter: match title client-side, content via the parent's
  // server-side `searchHits` set. Either match counts.
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const titleMatch = c.title.toLowerCase().includes(q);
      const contentMatch = searchHits?.has(c.id) ?? false;
      return titleMatch || contentMatch;
    });
  }, [conversations, searchQuery, searchHits]);

  const isSearching = searchQuery.trim().length > 0;
  const active = activeId ? conversations.find((c) => c.id === activeId) : null;
  const pinned = filtered.filter((c) => c.pinned && c.id !== activeId);
  const previous = filtered.filter((c) => !c.pinned && c.id !== activeId);
  // When searching, the "current" conversation is only shown if it matches.
  const showActiveSection = !isSearching && active;

  const handleDragEnd = (e: DragEndEvent) => {
    const { active: dragged, over } = e;
    if (!over || dragged.id === over.id) return;
    const oldIndex = pinned.findIndex((c) => c.id === dragged.id);
    const newIndex = pinned.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(pinned, oldIndex, newIndex);
    onReorderPinned(reordered.map((c) => c.id));
  };

  const rowProps = (c: ConversationRow, isActive: boolean) => ({
    conversation: c,
    isActive,
    isRenaming: c.id === renamingId,
    renameValue,
    onSelect,
    onStartRename: startRename,
    onCommitRename: commitRename,
    onCancelRename: () => setRenamingId(null),
    onChangeRename: setRenameValue,
    onTogglePin,
    onRequestDelete: setPendingDelete,
    onShare,
    onUnshare,
  });

  const noResults = isSearching && filtered.length === 0;

  if (collapsed) {
    return (
      <aside className="flex h-full w-full flex-col items-center border-r border-border/60 bg-background/80 py-3 backdrop-blur-md">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapsed}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <div className="mt-3 flex flex-col items-center gap-1.5">
          {getAppNavItems(isAdmin).map(({ id, to, label, icon: Icon, disabled }) => {
            const isActive = id === "chat";
            if (disabled) {
              return (
                <div
                  key={id}
                  className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground/40"
                  aria-disabled="true"
                  title={`${label} — coming soon`}
                >
                  <Icon className="h-4 w-4" />
                </div>
              );
            }
            return (
              <Link
                key={id}
                to={to}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md ease-vision",
                  isActive
                    ? "bg-secondary text-foreground hover:bg-secondary/80"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
                aria-label={label}
                title={label}
              >
                <Icon className="h-4 w-4" />
              </Link>
            );
          })}
          <Button
            variant="ghost"
            size="icon"
            onClick={onNew}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="New chat"
            title="New chat"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-auto flex flex-col items-center gap-1.5">
          <Link
            to="/settings"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>
          <button
            onClick={() => signOut()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <Link
            to="/settings"
            className="mt-1"
            aria-label="Account"
            title={profile?.display_name?.trim() || user?.email || "Account"}
          >
            <UserAvatar
              name={profile?.display_name}
              email={user?.email}
              src={profile?.avatar_url}
              size={28}
            />
          </Link>
        </div>
      </aside>
    );
  }

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
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onNew}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="New chat"
            title="New chat"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
          {onToggleCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleCollapsed}
              className="hidden h-8 w-8 text-muted-foreground hover:text-foreground md:inline-flex"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search conversations…"
            className="h-8 border-border/60 bg-secondary/40 pl-8 pr-7 text-xs placeholder:text-muted-foreground/50"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchQueryChange("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="shrink-0 border-b border-border/60 px-2 py-2">
        <Link
          to="/chat"
          className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs text-foreground ease-vision"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Chat
        </Link>
        <Link
          to="/trade"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground ease-vision hover:bg-secondary/60 hover:text-foreground"
        >
          <Repeat className="h-3.5 w-3.5" />
          Trade
        </Link>
        <Link
          to="/trade?tab=bridge"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground ease-vision hover:bg-secondary/60 hover:text-foreground"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Bridge
        </Link>
        <div
          className="ease-vision flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground/50"
          aria-disabled="true"
          title="Tracking — coming soon"
        >
          <Radar className="h-3.5 w-3.5" />
          <span>Tracking</span>
          <span className="ml-auto rounded-full border border-border/60 bg-secondary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            Soon
          </span>
        </div>
        <Link
          to="/contacts"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground ease-vision hover:bg-secondary/60 hover:text-foreground"
        >
          <Users className="h-3.5 w-3.5" />
          Contacts
        </Link>
        <Link
          to="/alerts"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground ease-vision hover:bg-secondary/60 hover:text-foreground"
        >
          <Bell className="h-3.5 w-3.5" />
          Alerts
        </Link>
        {isAdmin ? (
          <Link
            to="/admin"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground ease-vision hover:bg-secondary/60 hover:text-foreground"
          >
            <Shield className="h-3.5 w-3.5" />
            Admin
          </Link>
        ) : null}
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
        ) : noResults ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground/60">
            No matches for "{searchQuery.trim()}"
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <SectionHeader label={isSearching ? "Pinned · matches" : "Pinned"} />
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={pinned.map((c) => c.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="mb-3 space-y-0.5">
                      {pinned.map((c) => (
                        <ConversationRowItem
                          key={c.id}
                          {...rowProps(c, false)}
                          draggable={!isSearching}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </>
            )}
            {(showActiveSection || previous.length > 0) && (
              <>
                <SectionHeader label={isSearching ? "Matches" : "Conversations"} />
                {showActiveSection && (
                  <>
                    <SubSectionHeader label="Current" />
                    <ul className="mb-2 space-y-0.5">
                      <ConversationRowItem {...rowProps(active!, true)} />
                    </ul>
                  </>
                )}
                {previous.length > 0 && (
                  <>
                    {!isSearching && showActiveSection && (
                      <SubSectionHeader label="Previous" />
                    )}
                    <ul className="space-y-0.5">
                      {previous.map((c) => (
                        <ConversationRowItem key={c.id} {...rowProps(c, false)} />
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </>
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

const SubSectionHeader = ({ label }: { label: string }) => (
  <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
    {label}
  </div>
);
