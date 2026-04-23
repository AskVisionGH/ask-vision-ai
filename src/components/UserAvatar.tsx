import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { initialsFor } from "@/hooks/useProfile";

interface Props {
  name?: string | null;
  email?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}

/**
 * Profile avatar with image fallback to coloured initials.
 * Used in the sidebar footer, settings page, and onboarding.
 */
export const UserAvatar = ({ name, email, src, size = 32, className }: Props) => {
  const initials = initialsFor(name, email);
  return (
    <Avatar
      className={cn("border border-border/60", className)}
      style={{ width: size, height: size }}
    >
      {src ? <AvatarImage src={src} alt={name ?? "avatar"} /> : null}
      <AvatarFallback
        className="bg-gradient-to-br from-primary/30 to-primary/10 text-foreground"
        style={{ fontSize: Math.max(10, Math.round(size * 0.38)) }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
};
