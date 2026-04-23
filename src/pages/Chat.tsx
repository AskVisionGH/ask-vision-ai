import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { VisionLogo } from "@/components/VisionLogo";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

/**
 * Chat shell — placeholder for step 2.
 * Step 1 only proves: wallet connect → routed here.
 */
const Chat = () => {
  const { connected } = useWallet();
  const navigate = useNavigate();

  useEffect(() => {
    if (!connected) navigate("/");
  }, [connected, navigate]);

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      <header className="relative z-10 flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <VisionLogo size={20} />
          <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
            Vision
          </span>
        </div>
        <ConnectWalletButton size="default" />
      </header>

      <main className="relative z-10 mx-auto flex max-w-3xl flex-col items-center justify-center px-6 py-24 text-center">
        <p className="font-serif-italic text-2xl text-primary">Connected.</p>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          Chat interface ships in step 2. For now, this confirms the wallet handshake works end-to-end.
        </p>
      </main>
    </div>
  );
};

export default Chat;
