import { formatDistanceToNow } from "date-fns";
import { Bell, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  price: "Price",
  wallet_activity: "Wallet",
  order_fills: "Orders",
  news_sentiment: "News",
};

/**
 * Bell with an unread-count dot + dropdown list of the latest 50 alerts.
 * Live-updates via Supabase realtime. Portaled content (per project memory).
 */
export const AlertBell = () => {
  const { items, unreadCount, markAllRead, markRead } = useNotifications();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-muted-foreground hover:text-foreground"
          aria-label={
            unreadCount > 0
              ? `Alerts (${unreadCount} unread)`
              : "Alerts"
          }
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        sideOffset={8}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-foreground">
            Notifications
            {unreadCount > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-px font-mono text-[10px] text-primary">
                {unreadCount}
              </span>
            )}
          </span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground ease-vision"
            >
              <Check className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground/70">
            No notifications yet.
            <br />
            Enable alerts in{" "}
            <Link
              to="/settings#notifications"
              className="text-primary hover:underline"
            >
              settings
            </Link>
            .
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const unread = !n.read_at;
                const body = (
                  <div
                    className={cn(
                      "px-3 py-2.5 ease-vision hover:bg-secondary/40",
                      unread && "bg-primary/[0.04]",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {unread && (
                        <span className="mt-1 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs font-medium text-foreground">
                            {n.title}
                          </p>
                          <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                            {CATEGORY_LABEL[n.category] ?? n.category}
                          </span>
                        </div>
                        {n.body && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {n.body}
                          </p>
                        )}
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">
                          {formatDistanceToNow(new Date(n.created_at), {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        to={n.link}
                        onClick={() => unread && void markRead(n.id)}
                        className="block"
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => unread && void markRead(n.id)}
                        className="block w-full text-left"
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
};
