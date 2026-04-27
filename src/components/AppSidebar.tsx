import { Link } from "react-router-dom";
import {
  LogOut,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { VisionLogo } from "@/components/VisionLogo";
import { getActiveNavId, getAppNavItems } from "@/lib/app-nav";
import { cn } from "@/lib/utils";

/**
 * Shared lightweight nav sidebar used on every page EXCEPT:
 *   - Chat (uses the richer ChatSidebar with conversation list)
 *   - Admin (internal page, standalone tabs)
 *
 * Has two variants via `collapsed`:
 *   - expanded (w-64) with labels
 *   - icon-only rail (w-14) for desktop collapse
 *
 * Active highlighting matches the `activePath` prop (supply `location.pathname`).
 * Cross-chain swaps are handled inside the Swap tab via the unified router.
 */
interface Props {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  /** location.pathname — used to highlight the active entry. */
  activePath: string;
  /** For the Trade page: which sub-tab is active. Reserved for future per-tab highlighting. */
  activeTradeTab?: string | null;
  isAdmin: boolean;
  user: { email?: string | null } | null;
  profile: { display_name?: string | null; avatar_url?: string | null } | null;
  onSignOut: () => void | Promise<unknown>;
}

export const AppSidebar = ({
  collapsed,
  onToggleCollapsed,
  activePath,
  activeTradeTab = null,
  isAdmin,
  user,
  profile,
  onSignOut,
}: Props) => {
  const navItems = getAppNavItems(isAdmin);
  const activeId = getActiveNavId(activePath, activeTradeTab);

  if (collapsed) {
    return (
      <aside className="flex h-full w-full flex-col items-center border-r border-border/60 bg-background/80 py-3 backdrop-blur-md">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapsed}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <div className="mt-3 flex flex-col items-center gap-1.5">
          {navItems.map(({ id, to, label, icon: Icon, disabled }) => (
            <IconLink
              key={id}
              to={to}
              icon={<Icon className="h-4 w-4" />}
              label={disabled ? `${label} (soon)` : label}
              active={activeId === id}
              disabled={disabled}
            />
          ))}
        </div>
        <div className="mt-auto flex flex-col items-center gap-1.5">
          <IconLink
            to="/settings"
            icon={<SettingsIcon className="h-4 w-4" />}
            label="Settings"
            active={activePath === "/settings"}
          />
          <button
            onClick={() => onSignOut()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <Link to="/settings" className="mt-1" aria-label="Account">
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
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
        <Link to="/chat" className="flex items-center gap-2">
          <VisionLogo size={20} />
          <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
            Vision
          </span>
        </Link>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="New chat"
            title="New chat"
          >
            <Link to="/chat">
              <MessageSquarePlus className="h-4 w-4" />
            </Link>
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

      {/* Spacer matches ChatSidebar's search bar height so the nav doesn't
          jump vertically when switching between Chat and other pages. */}
      <div className="shrink-0 border-b border-border/60 px-3 py-2" aria-hidden>
        <div className="h-8" />
      </div>

      <div className="shrink-0 px-2 py-2">
        {navItems.map(({ id, to, label, icon: Icon, disabled, badge }) => (
          <NavRow
            key={id}
            to={to}
            icon={<Icon className="h-3.5 w-3.5" />}
            label={label}
            active={activeId === id}
            disabled={disabled}
            badge={badge}
          />
        ))}
      </div>

      <div className="flex-1" />

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
            onClick={() => onSignOut()}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
};

const NavRow = ({
  to,
  icon,
  label,
  active = false,
  disabled = false,
  badge,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  badge?: string;
}) => {
  if (disabled) {
    return (
      <div
        className="ease-vision flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground/50"
        aria-disabled="true"
        title={`${label} — coming soon`}
      >
        {icon}
        <span>{label}</span>
        {badge && (
          <span className="ml-auto rounded-full border border-border/60 bg-secondary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {badge}
          </span>
        )}
      </div>
    );
  }
  return (
    <Link
      to={to}
      className={cn(
        "ease-vision flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
      {badge && (
        <span className="ml-auto rounded-full border border-border/60 bg-secondary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
          {badge}
        </span>
      )}
    </Link>
  );
};

const IconLink = ({
  to,
  icon,
  label,
  active = false,
  disabled = false,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) => {
  if (disabled) {
    return (
      <div
        className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground/40"
        aria-disabled="true"
        title={`${label} — coming soon`}
      >
        {icon}
      </div>
    );
  }
  return (
    <Link
      to={to}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md ease-vision",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
      aria-label={label}
      title={label}
    >
      {icon}
    </Link>
  );
};
