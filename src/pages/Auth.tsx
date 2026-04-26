import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAccount, useSignMessage, useDisconnect as useEvmDisconnect } from "wagmi";
import { toast } from "sonner";
import { Apple, Copy, ExternalLink, Mail, ShieldAlert, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";
import { signInWithSolana } from "@/lib/siws";
import { signInWithEthereum } from "@/lib/siwe";
import { useWalletPicker } from "@/components/WalletPicker";
import { VisionLogo } from "@/components/VisionLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import { detectInAppBrowser, type InAppBrowserInfo } from "@/lib/in-app-browser";
import { evmChainBadge, solanaBadge } from "@/lib/chain-badge";

const GoogleGlyph = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
    <path
      fill="#EA4335"
      d="M12 11v3.2h4.5c-.2 1.2-1.5 3.6-4.5 3.6-2.7 0-4.9-2.2-4.9-5s2.2-5 4.9-5c1.5 0 2.6.6 3.2 1.2l2.2-2.1C15.9 5.6 14.1 5 12 5 7.6 5 4 8.6 4 13s3.6 8 8 8c4.6 0 7.7-3.2 7.7-7.8 0-.5-.1-.9-.1-1.2H12z"
    />
  </svg>
);

const Auth = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const { publicKey, signMessage, connected, disconnect } = useWallet();
  // EVM side via wagmi — used for SIWE.
  const {
    address: evmAddress,
    isConnected: evmConnected,
    chainId: evmChainId,
  } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect: evmDisconnect } = useEvmDisconnect();
  const { open: openWalletPicker, Picker } = useWalletPicker();

  const [tab, setTab] = useState<"email" | "wallet">("email");
  // Inside the wallet tab the user picks which chain to sign with — Solana
  // (SIWS / ed25519) or Ethereum (SIWE / personal_sign). Both produce a
  // wallet-only Supabase account that can later be linked to an email.
  const [walletChain, setWalletChain] = useState<"solana" | "evm">("solana");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [walletSigning, setWalletSigning] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  // When the user clicks the single "Sign in with wallet" pill while
  // disconnected, we open the modal and remember the intent so we can
  // auto-trigger signing the moment a wallet connects.
  const [pendingSign, setPendingSign] = useState(false);
  const [inApp, setInApp] = useState<InAppBrowserInfo>({ isInApp: false, app: null, label: null });

  useEffect(() => {
    setInApp(detectInAppBrowser());
  }, []);

  useEffect(() => {
    if (!loading && session) navigate("/chat", { replace: true });
  }, [loading, session, navigate]);

  const copyAuthUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied", { description: "Paste it into Safari or Chrome." });
    } catch {
      toast.error("Couldn't copy link", { description: "Long-press the address bar to copy it manually." });
    }
  };

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/chat` },
        });
        if (error) throw error;
        toast.success("Account created", { description: "Signing you in…" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(mode === "signup" ? "Signup failed" : "Sign-in failed", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const sendResetEmail = async () => {
    if (sendingReset) return;
    const target = email.trim();
    if (!target) {
      toast.error("Enter your email first", {
        description: "We'll send the reset link there.",
      });
      return;
    }
    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSendingReset(false);
    if (error) {
      toast.error("Couldn't send reset email", { description: error.message });
      return;
    }
    toast.success("Check your inbox", {
      description: `We sent a reset link to ${target}.`,
    });
  };

  const signInWithProvider = async (provider: "google" | "apple") => {
    if (oauthLoading) return;
    setOauthLoading(provider);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: `${window.location.origin}/chat`,
      });
      if (result.error) throw result.error;
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Couldn't open ${provider} sign-in`;
      toast.error(`${provider === "google" ? "Google" : "Apple"} sign-in failed`, { description: msg });
      setOauthLoading(null);
    }
  };

  const runWalletSignature = async () => {
    setWalletSigning(true);
    try {
      if (walletChain === "solana") {
        if (!publicKey || !signMessage) return;
        const result = await signInWithSolana({
          walletAddress: publicKey.toBase58(),
          signMessage: (msg) => signMessage(msg),
        });
        if (result.error) {
          toast.error("Wallet sign-in failed", { description: result.error });
        } else {
          toast.success("Signed in with Solana wallet");
        }
      } else {
        if (!evmAddress) return;
        const result = await signInWithEthereum({
          walletAddress: evmAddress,
          chainId: evmChainId ?? 1,
          signMessage: (message) => signMessageAsync({ account: evmAddress as `0x${string}`, message }),
        });
        if (result.error) {
          toast.error("Wallet sign-in failed", { description: result.error });
        } else {
          toast.success("Signed in with Ethereum wallet");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't complete signature";
      toast.error("Wallet sign-in failed", { description: msg });
    } finally {
      setWalletSigning(false);
    }
  };

  const signWithWallet = () => {
    const isReady =
      walletChain === "solana"
        ? connected && publicKey && signMessage
        : evmConnected && evmAddress;
    if (!isReady) {
      // Open the wallet picker, then auto-sign once a wallet connects.
      setPendingSign(true);
      openWalletPicker();
      return;
    }
    void runWalletSignature();
  };

  // Once a wallet finishes connecting after the user clicked the pill,
  // immediately ask for a signature so it's a single-click flow end-to-end.
  // We watch BOTH chains and let `walletChain` decide which one to drive.
  useEffect(() => {
    if (!pendingSign) return;
    if (walletChain === "solana" && connected && publicKey && signMessage) {
      setPendingSign(false);
      void runWalletSignature();
      return;
    }
    if (walletChain === "evm" && evmConnected && evmAddress) {
      setPendingSign(false);
      void runWalletSignature();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSign, walletChain, connected, publicKey, signMessage, evmConnected, evmAddress]);

  // If the user toggles the chain selector to one where they're not connected,
  // clear stale signing state. Doesn't disconnect the other chain — multi-chain.
  useEffect(() => {
    setPendingSign(false);
  }, [walletChain]);


  return (
    <main className="relative grid min-h-screen grid-cols-1 overflow-hidden bg-background text-foreground lg:grid-cols-2">
      <SEO
        title="Sign in to Vision"
        description="Sign in or create your Vision account. The AI crypto assistant — swap, send, and explore on-chain through one conversation."
        canonicalPath="/auth"
      />
      {/* Left: branded panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border/60 p-10 lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[60vh] w-[2px] -translate-x-1/2 beam animate-pulse-glow"
          aria-hidden
        />

        <div className="relative z-10 flex items-center gap-2">
          <VisionLogo size={22} />
          <span className="font-mono text-sm tracking-widest uppercase text-muted-foreground">
            Vision
          </span>
        </div>

        <div className="relative z-10 max-w-sm">
          <h2 className="text-3xl font-light leading-tight tracking-tight sm:text-4xl">
            Ask anything.{" "}
            <span className="font-serif-italic text-primary">Unlock everything.</span>
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Sign in to keep your conversations, contacts, and on-chain history
            in sync across every device.
          </p>
        </div>

        <p className="relative z-10 font-mono text-[10px] tracking-widest uppercase text-muted-foreground/50">
          askvision.ai
        </p>
      </aside>

      {/* Right: auth form */}
      <section className="relative flex items-center justify-center overflow-hidden px-6 py-10 sm:px-10">
        <div className="pointer-events-none absolute inset-0 bg-aurora opacity-60 lg:hidden" aria-hidden />

        <div className="relative z-10 w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <VisionLogo size={32} className="mb-4 drop-shadow-[0_0_24px_hsl(var(--primary-glow)/0.6)] lg:hidden" />
            <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
              {mode === "signup" ? (
                <>
                  Create your <span className="font-serif-italic text-primary">Vision</span> account
                </>
              ) : (
                <>
                  Welcome <span className="font-serif-italic text-primary">back</span>
                </>
              )}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose how you'd like to sign in.
            </p>
          </div>

          {inApp.isInApp && (
            <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium leading-snug text-foreground">
                    Sign-in works best in your normal browser
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {inApp.label ? `${inApp.label}'s` : "This"} built-in browser
                    doesn't support Google sign-in. Tap a button below to
                    continue in Safari or Chrome — you'll only need to do this once.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <a
                      href={window.location.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-500/30 bg-background/40 px-3 text-xs font-medium text-foreground hover:bg-background/60 ease-vision"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open in my browser
                    </a>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={copyAuthUrl}
                      className="h-8 gap-1.5 rounded-full border-amber-500/30 bg-background/40 text-xs text-foreground hover:bg-background/60"
                    >
                      <Copy className="h-3 w-3" />
                      Copy link instead
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="grid w-full grid-cols-2 bg-secondary">
              <TabsTrigger value="email" className="gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                Email
              </TabsTrigger>
              <TabsTrigger value="wallet" className="gap-1.5">
                <Wallet className="h-3.5 w-3.5" />
                Wallet
              </TabsTrigger>
            </TabsList>

            {/* Email tab */}
            <TabsContent value="email" className="mt-5 space-y-4">
              {/* OAuth buttons */}
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => signInWithProvider("google")}
                  disabled={!!oauthLoading}
                  className="w-full justify-center gap-2 rounded-full border-border bg-secondary font-medium text-foreground hover:bg-muted ease-vision"
                >
                  <GoogleGlyph />
                  {oauthLoading === "google" ? "Opening Google…" : "Continue with Google"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => signInWithProvider("apple")}
                  disabled={!!oauthLoading}
                  className="w-full justify-center gap-2 rounded-full border-border bg-secondary font-medium text-foreground hover:bg-muted ease-vision"
                >
                  <Apple className="h-4 w-4" />
                  {oauthLoading === "apple" ? "Opening Apple…" : "Continue with Apple"}
                </Button>
              </div>

              <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground/60">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>

              {/* Email form */}
              <div className="flex gap-1 rounded-full bg-secondary p-1 text-xs">
                {(["signin", "signup"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex-1 rounded-full py-1.5 ease-vision",
                      mode === m
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "signin" ? "Sign in" : "Sign up"}
                  </button>
                ))}
              </div>

              <form onSubmit={submitEmail} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pw" className="text-xs uppercase tracking-wider text-muted-foreground">
                      Password
                    </Label>
                    {mode === "signin" && (
                      <button
                        type="button"
                        onClick={sendResetEmail}
                        disabled={sendingReset}
                        className="text-[11px] text-muted-foreground hover:text-foreground ease-vision disabled:opacity-50"
                      >
                        {sendingReset ? "Sending…" : "Forgot password?"}
                      </button>
                    )}
                  </div>
                  <Input
                    id="pw"
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "8+ characters" : "••••••••"}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-full bg-primary font-medium text-primary-foreground hover:bg-primary/90 ease-vision"
                >
                  {submitting ? "…" : mode === "signup" ? "Create account" : "Sign in"}
                </Button>
              </form>
            </TabsContent>

            {/* Wallet tab — pick a chain (Solana / Ethereum) then sign with
                that wallet. Uses SIWS for SOL and SIWE for EVM. */}
            <TabsContent value="wallet" className="mt-5">
              <div className="rounded-2xl border border-border bg-card/40 p-5 backdrop-blur-md">
                {/* Chain selector */}
                <div className="mb-4 flex gap-1 rounded-full bg-secondary p-1 text-xs">
                  {(["solana", "evm"] as const).map((c) => {
                    const badge = c === "solana" ? solanaBadge() : evmChainBadge(1);
                    const isActive = walletChain === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setWalletChain(c)}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 ease-vision",
                          isActive
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", badge.dotClass)} aria-hidden />
                        {c === "solana" ? "Solana" : "Ethereum"}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Wallet className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {walletChain === "solana"
                        ? "Sign in with your Solana wallet"
                        : "Sign in with your Ethereum wallet"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      You'll sign a one-time message — no transaction, no gas.
                      Your wallet address becomes your identity.
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={signWithWallet}
                  disabled={walletSigning || pendingSign}
                  className="mt-4 w-full rounded-full bg-primary font-medium text-primary-foreground hover:bg-primary/90 ease-vision"
                >
                  {walletSigning
                    ? "Waiting for signature…"
                    : pendingSign
                      ? "Choose a wallet…"
                      : walletChain === "solana" && connected && publicKey
                        ? `Sign in as ${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
                        : walletChain === "evm" && evmConnected && evmAddress
                          ? `Sign in as ${evmAddress.slice(0, 6)}…${evmAddress.slice(-4)}`
                          : "Sign in with wallet"}
                </Button>

                {walletChain === "solana" && connected && publicKey && (
                  <button
                    onClick={() => disconnect()}
                    className="mt-2 w-full text-center text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground ease-vision"
                  >
                    Use a different wallet
                  </button>
                )}
                {walletChain === "evm" && evmConnected && evmAddress && (
                  <button
                    onClick={() => evmDisconnect()}
                    className="mt-2 w-full text-center text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground ease-vision"
                  >
                    Use a different wallet
                  </button>
                )}

                <p className="mt-3 text-center text-[10px] text-muted-foreground/70">
                  {walletChain === "solana"
                    ? "Phantom, Solflare, Backpack, Coinbase, Trust & more"
                    : "MetaMask, Rabby, Rainbow, WalletConnect & more"}
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <p className="mt-8 text-center font-mono text-[10px] tracking-widest uppercase text-muted-foreground/50 lg:text-left">
            By continuing you agree to our terms.
          </p>
          {Picker}
        </div>
      </section>
    </main>
  );
};

export default Auth;
