import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";

/**
 * Desktop-only gate.
 *
 * While the app is in v1/beta, we restrict access to desktop viewports so we
 * can focus on the build without having to maintain the mobile experience.
 * Anything narrower than `MIN_DESKTOP_WIDTH` gets a friendly block screen
 * instead of the app.
 */
const MIN_DESKTOP_WIDTH = 1024; // matches Tailwind `lg` breakpoint

function checkIsDesktop(): boolean {
  if (typeof window === "undefined") return true; // SSR-safe default
  return window.innerWidth >= MIN_DESKTOP_WIDTH;
}

export const DesktopOnlyGate = ({ children }: { children: React.ReactNode }) => {
  const [isDesktop, setIsDesktop] = useState<boolean>(checkIsDesktop);

  useEffect(() => {
    const onResize = () => setIsDesktop(checkIsDesktop());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  if (isDesktop) return <>{children}</>;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Monitor className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">
          Desktop only — for now
        </h1>
        <p className="mb-2 text-sm text-muted-foreground">
          Vision is in private beta and is currently desktop-only while we
          polish the experience.
        </p>
        <p className="text-sm text-muted-foreground">
          Please open <span className="font-medium text-foreground">app.askvision.ai</span>{" "}
          on a desktop or laptop to continue.
        </p>
        <p className="mt-6 text-xs text-muted-foreground">
          A mobile experience is coming soon.
        </p>
      </div>
    </main>
  );
};

export default DesktopOnlyGate;
