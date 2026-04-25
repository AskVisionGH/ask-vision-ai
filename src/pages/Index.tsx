import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { VisionLogo } from "@/components/VisionLogo";
import { ChatPreview } from "@/components/ChatPreview";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";

const Index = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && session) navigate("/chat", { replace: true });
  }, [loading, session, navigate]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <SEO
        title="Vision — Ask Anything, Unlock Everything"
        description="The AI crypto assistant. Vision turns plain English into on-chain action — swap, send, track wallets, and explore markets through one conversation."
        canonicalPath="/"
      />
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[60vh] w-[2px] -translate-x-1/2 beam animate-pulse-glow"
        aria-hidden
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <div className="flex items-center gap-2">
          <VisionLogo size={22} />
          <span className="font-mono text-sm tracking-widest uppercase text-muted-foreground">
            Vision
          </span>
        </div>
        <div className="flex items-center gap-5">
          <button
            onClick={() => navigate("/auth")}
            className="font-mono text-xs tracking-widest uppercase text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </button>
          <span className="hidden font-mono text-[11px] tracking-widest uppercase text-muted-foreground sm:inline">
            v1
          </span>
        </div>
      </header>

      {/* Single-screen hero */}
      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-96px)] max-w-3xl flex-col items-center justify-center px-6 text-center">
        <div className="animate-fade-up">
          <div className="mb-8 flex justify-center">
            <VisionLogo size={56} className="drop-shadow-[0_0_24px_hsl(var(--primary-glow)/0.6)]" />
          </div>

          <h1 className="text-4xl font-light leading-tight tracking-tight sm:text-6xl">
            Ask anything.{" "}
            <span className="font-serif-italic text-primary">Unlock everything.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
            Vision turns plain English into on-chain action. Swap, send, and explore — all through one conversation.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3">
            <Button
              size="lg"
              onClick={() => navigate("/auth")}
              className="rounded-full bg-primary px-10 font-medium text-primary-foreground hover:bg-primary/90 ease-vision shadow-glow"
            >
              Get started
            </Button>
            <p className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground/70">
              Email · Google · Apple · Wallet
            </p>
          </div>

          {/* Subtle live preview */}
          <div className="mt-12">
            <ChatPreview />
          </div>
        </div>
      </section>

      <footer className="relative z-10 px-6 pb-6 text-center sm:px-10">
        <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/50">
          askvision.ai
        </p>
      </footer>
    </main>
  );
};

export default Index;
