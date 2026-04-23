import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { VisionLogo } from "@/components/VisionLogo";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

const Index = () => {
  const { connected } = useWallet();
  const navigate = useNavigate();

  useEffect(() => {
    if (connected) navigate("/chat");
  }, [connected, navigate]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Aurora glow */}
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      {/* Vertical beam behind triangle */}
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
        <span className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground">
          v1 · solana
        </span>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-96px)] max-w-2xl flex-col items-center justify-center px-6 text-center">
        <div className="animate-fade-up">
          <div className="mb-10 flex justify-center">
            <VisionLogo size={56} className="drop-shadow-[0_0_24px_hsl(var(--primary-glow)/0.6)]" />
          </div>

          <h1 className="text-4xl font-light leading-tight tracking-tight sm:text-5xl">
            Talk to crypto.{" "}
            <span className="font-serif-italic text-primary">Naturally.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
            Vision turns plain English into on-chain action. Swap, send, and explore Solana — through one conversation.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4">
            <ConnectWalletButton />
            <p className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground/70">
              Phantom · Solflare · Backpack
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 pb-6 text-center sm:px-10">
        <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/50">
          askvision.ai
        </p>
      </footer>
    </main>
  );
};

export default Index;
