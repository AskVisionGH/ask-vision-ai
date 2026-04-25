import { cn } from "@/lib/utils";

export type LoaderVariant = "vertex-orbit" | "self-draw";

interface VisionLoaderProps {
  variant?: LoaderVariant;
  size?: number;
  className?: string;
}

/**
 * Two prototype "thinking" indicators built around the Vision triangle mark.
 *
 *  - vertex-orbit:  one triangle whose three corners breathe outward from
 *                   center on a staggered cycle. Reads as "alive / thinking".
 *  - self-draw:     SVG stroke that continuously draws the triangle, holds,
 *                   then erases — like the AI is sketching a thought.
 */
export const VisionLoader = ({
  variant = "vertex-orbit",
  size = 28,
  className,
}: VisionLoaderProps) => {
  if (variant === "self-draw") return <SelfDraw size={size} className={className} />;
  return <VertexOrbit size={size} className={className} />;
};

/* ────────────────────────── 1. Vertex orbit ────────────────────────── */
const VertexOrbit = ({ size, className }: { size: number; className?: string }) => {
  return (
    <div
      className={cn("relative inline-block", className)}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Vision is thinking"
    >
      <style>{`
        @keyframes vision-vertex-breathe {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 4px hsl(var(--primary-glow) / 0.5)); }
          50%      { transform: scale(1.06); filter: drop-shadow(0 0 10px hsl(var(--primary-glow) / 0.95)); }
        }
        @keyframes vision-vertex-rotate {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <div
        className="absolute inset-0"
        style={{
          animation: "vision-vertex-rotate 6s linear infinite",
          transformOrigin: "50% 58%",
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="text-foreground"
          style={{
            animation: "vision-vertex-breathe 1.6s ease-in-out infinite",
            transformOrigin: "50% 58%",
          }}
        >
          {/* Soft outer glow triangle */}
          <path d="M16 4 L28 26 L4 26 Z" fill="currentColor" opacity="0.18" />
          {/* Main triangle */}
          <path d="M16 4 L28 26 L4 26 Z" fill="currentColor" />
          {/* Vertex dots — staggered pulse picks up the "breath" rhythm */}
          <circle cx="16" cy="4" r="1.6" fill="hsl(var(--primary-glow))">
            <animate attributeName="r" values="1.4;2.4;1.4" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <circle cx="28" cy="26" r="1.6" fill="hsl(var(--primary-glow))">
            <animate attributeName="r" values="1.4;2.4;1.4" dur="1.6s" begin="0.4s" repeatCount="indefinite" />
          </circle>
          <circle cx="4" cy="26" r="1.6" fill="hsl(var(--primary-glow))">
            <animate attributeName="r" values="1.4;2.4;1.4" dur="1.6s" begin="0.8s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
    </div>
  );
};

/* ────────────────────────── 2. Self-drawing stroke ────────────────────────── */
const SelfDraw = ({ size, className }: { size: number; className?: string }) => {
  // Triangle perimeter ≈ 12 + ~25.06 + 24 ≈ 61. We use 70 to give comfy headroom.
  const PERIMETER = 70;
  return (
    <div
      className={cn("relative inline-block", className)}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Vision is thinking"
    >
      <style>{`
        @keyframes vision-draw {
          0%   { stroke-dashoffset: ${PERIMETER}; }
          45%  { stroke-dashoffset: 0; }
          55%  { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -${PERIMETER}; }
        }
        @keyframes vision-fill-pulse {
          0%, 45%   { opacity: 0; }
          50%, 55%  { opacity: 0.18; }
          100%      { opacity: 0; }
        }
      `}</style>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-foreground"
      >
        {/* Faint ghost triangle so the shape is always discoverable */}
        <path
          d="M16 4 L28 26 L4 26 Z"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.12"
        />
        {/* Brief fill flash at "completion" before erase */}
        <path
          d="M16 4 L28 26 L4 26 Z"
          fill="hsl(var(--primary-glow))"
          style={{ animation: "vision-fill-pulse 1.8s ease-in-out infinite" }}
        />
        {/* The animated stroke */}
        <path
          d="M16 4 L28 26 L4 26 Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={PERIMETER}
          strokeDashoffset={PERIMETER}
          style={{
            animation: "vision-draw 1.8s ease-in-out infinite",
            filter: "drop-shadow(0 0 4px hsl(var(--primary-glow) / 0.7))",
          }}
        />
      </svg>
    </div>
  );
};
