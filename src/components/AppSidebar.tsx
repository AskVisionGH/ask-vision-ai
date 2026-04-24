import { Link } from "react-router-dom";
import {
  ArrowLeftRight,
  Bell,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Repeat,
  Settings as SettingsIcon,
  Shield,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { VisionLogo } from "@/components/VisionLogo";
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
 * Bridge lives at `/trade?tab=bridge` — we use <Link state> so it doesn't do a
 * full page reload and Trade picks up the tab change via its `location.search`
 * effect.
 */
interface Props {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  /** location.pathname — used to highlight the active entry. */
  activePath: string;
  /** For the Trade page: which sub-tab is active. Used to highlight Bridge vs Trade. */
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
  const isTradePath = activePath === "/trade";
  const isBridgeActive = isTradePath && activeTradeTab === "bridge";
  const isTradeActive = isTradePath && !isBridgeActive;

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
          <IconLink
            to="/chat"
            icon={<MessageSquare className="h-4 w-4" />}
            label="Chat"
            active={activePath === "/chat"}
          />
          <IconLink
            to="/trade"
            icon={<Repeat className="h-4 w-4" />}
            label="Trade"
            active={isTradeActive}
          />
          <IconLink
            to="/trade?tab=bridge"
            icon={<ArrowLeftRight className="h-4 w-4" />}
            label="Bridge"
            active={isBridgeActive}
          />
          <IconLink
            to="/tracked-wallets"
            icon={<Radar className="h-4 w-4" />}
            label="Tracking"
            active={activePath === "/tracked-wallets"}
          />
          <IconLink
            to="/contacts"
            icon={<Users className="h-4 w-4" />}
            label="Contacts"
            active={activePath === "/contacts"}
          />
        </div>
        {isAdmin && (
          <div className="mt-1.5 flex flex-col items-center">
            <IconLink
              to="/admin"
              icon={<Shield className="h-4 w-4" />}
              label="Admin"
              active={activePath === "/admin"}
            />
          </div>
        )}
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

      <div className="shrink-0 px-2 py-2">
        <NavRow
          to="/chat"
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label="Chat"
          active={activePath === "/chat"}
        />
        <NavRow
          to="/trade"
          icon={<Repeat className="h-3.5 w-3.5" />}
          label="Trade"
          active={isTradeActive}
        />
        <NavRow
          to="/trade?tab=bridge"
          icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
          label="Bridge"
          active={isBridgeActive}
        />
        <NavRow
          to="/tracked-wallets"
          icon={<Radar className="h-3.5 w-3.5" />}
          label="Tracking"
          active={activePath === "/tracked-wallets"}
        />
        <NavRow
          to="/contacts"
          icon={<Users className="h-3.5 w-3.5" />}
          label="Contacts"
          active={activePath === "/contacts"}
        />
        <button
          type="button"
          disabled
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground/50 ease-vision cursor-not-allowed"
          aria-label="Alerts (coming soon)"
        >
          <Bell className="h-3.5 w-3.5" />
          <span>Alerts</span>
          <span className="ml-auto rounded-full border border-border/60 bg-secondary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            Soon
          </span>
        </button>
        {isAdmin && (
          <NavRow
            to="/admin"
            icon={<Shield className="h-3.5 w-3.5" />}
            label="Admin"
            active={activePath === "/admin"}
          />
        )}
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
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) => (
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
    {label}
  </Link>
);

const IconLink = ({
  to,
  icon,
  label,
  active = false,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) => (
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
