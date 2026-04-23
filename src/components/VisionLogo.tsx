import { cn } from "@/lib/utils";

interface VisionLogoProps {
  className?: string;
  size?: number;
}

/** White triangle mark — Vision brand. */
export const VisionLogo = ({ className, size = 28 }: VisionLogoProps) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-foreground", className)}
      aria-label="Vision"
    >
      <path
        d="M16 4 L28 26 L4 26 Z"
        fill="currentColor"
      />
    </svg>
  );
};
