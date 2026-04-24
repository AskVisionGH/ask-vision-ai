import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing, Check, CheckCheck, Settings } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  useNotifications,
  type NotificationRow,
} from "@/hooks/useNotifications";

const categoryLabel: Record<NotificationRow["category"], string> = {
  price: "Price",
  wallet_activity: "Wallet",
  order_fills: "Order",
  news_sentiment: "News",
};

/**
 * Header bell with unread badge + dropdown list.
 *
 * - Empty state when there are no notifications.
 * - Clicking a row marks it read and (if it has a `link`) navigates there.
 * - "Mark all read" clears the dot count without removing rows.
 * - Link to Settings for users who want to manage categories / quiet hours.
 */
export const NotificationBell = () => {
  const navigate = useNavigate();
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  const handleClick = async (n: NotificationRow) => {
    if (!n.read_at) await markRead(n.id);
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label={
            unreadCount > 0
              ? `Notifications — ${unreadCount} unread`
              : "Notifications"
          }
        >
          {unreadCount > 0 ? (
            <BellRing className="h-4 w-4" />
          ) : (
            <Bell className="h-4 w-4" />
          )}
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-medium text-primary-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[22rem] max-w-[calc(100vw-1rem)] p-0"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Notifications
          </span>
          <div className="flex items-center gap-0.5">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                onClick={() => markAllRead()}
                title="Mark all read"
              >
                <CheckCheck className="h-3 w-3" />
                Mark all
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => {
                setOpen(false);
                navigate("/settings#notifications");
              }}
              title="Notification settings"
              aria-label="Notification settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <Bell className="h-5 w-5 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              You're all caught up.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Price moves, fills, and wallet activity will land here.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[22rem]">
            <ul className="divide-y divide-border/50">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={cn(
                      "ease-vision flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-secondary/60",
                      !n.read_at && "bg-secondary/30",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        n.read_at ? "bg-transparent" : "bg-primary",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-xs font-medium text-foreground">
                          {n.title}
                        </p>
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                          {categoryLabel[n.category]}
                        </span>
                      </div>
                      {n.body && (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                          {n.body}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    {!n.read_at && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          markRead(n.id);
                        }}
                        className="shrink-0 rounded p-1 text-muted-foreground/60 hover:bg-background hover:text-foreground"
                        title="Mark read"
                        aria-label="Mark read"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
};
