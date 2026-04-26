import {
  ArrowLeftRight,
  Bell,
  MessageSquare,
  Radar,
  Repeat,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for the primary nav items rendered in both
 * `AppSidebar` (used on every page except Chat) and `ChatSidebar` (Chat page).
 *
 * Keeping these in one place prevents the two sidebars from drifting apart
 * — e.g. items appearing in different orders, or one sidebar missing an
 * entry that was added to the other.
 *
 * If you add/remove/reorder a nav item, do it HERE only.
 */
export type AppNavItem = {
  /** Stable id used for active highlighting + React keys. */
  id: "chat" | "trade" | "bridge" | "tracking" | "alerts" | "contacts" | "admin";
  /** Route to navigate to. */
  to: string;
  /** Visible label. */
  label: string;
  icon: LucideIcon;
  /** Coming-soon items render greyed out and ignore clicks. */
  disabled?: boolean;
  /** Optional pill rendered to the right of the label (e.g. "Soon"). */
  badge?: string;
  /** Admin-only items are filtered out for non-admins. */
  adminOnly?: boolean;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { id: "chat", to: "/chat", label: "Chat", icon: MessageSquare },
  { id: "trade", to: "/trade?tab=trade", label: "Trade", icon: Repeat },
  { id: "bridge", to: "/trade?tab=bridge", label: "Bridge", icon: ArrowLeftRight },
  {
    id: "tracking",
    to: "/tracked-wallets",
    label: "Tracking",
    icon: Radar,
    disabled: true,
    badge: "Soon",
  },
  { id: "alerts", to: "/alerts", label: "Alerts", icon: Bell },
  { id: "contacts", to: "/contacts", label: "Contacts", icon: Users },
  { id: "admin", to: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

/**
 * Returns the nav items the current viewer should see, with admin-only
 * entries filtered out for non-admins.
 */
export const getAppNavItems = (isAdmin: boolean): AppNavItem[] =>
  APP_NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

/**
 * Resolve which nav item is "active" for the current route. Used by both
 * sidebars to keep highlighting logic identical.
 *
 * - On `/trade`, the active item depends on the `tab` query param so Trade
 *   and Bridge highlight independently.
 * - Otherwise we match on pathname.
 */
export const getActiveNavId = (
  pathname: string,
  activeTradeTab?: string | null,
): AppNavItem["id"] | null => {
  if (pathname === "/chat") return "chat";
  if (pathname === "/trade") {
    return activeTradeTab === "bridge" ? "bridge" : "trade";
  }
  if (pathname === "/alerts") return "alerts";
  if (pathname === "/contacts") return "contacts";
  if (pathname === "/admin") return "admin";
  if (pathname === "/tracked-wallets") return "tracking";
  return null;
};
