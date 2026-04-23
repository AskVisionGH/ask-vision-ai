import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";
import { VisionLogo } from "@/components/VisionLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const Auth = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate("/chat", { replace: true });
  }, [loading, session, navigate]);

  const submit = async (e: FormEvent) => {
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

  const signInWithGoogle = async () => {
    if (oauthLoading) return;
    setOauthLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/chat`,
      });
      if (result.error) throw result.error;
      // If `result.redirected` was true, browser is already navigating away.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't open Google sign-in";
      toast.error("Google sign-in failed", { description: msg });
      setOauthLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <VisionLogo size={36} className="mb-4 drop-shadow-[0_0_24px_hsl(var(--primary-glow)/0.6)]" />
          <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
            Sign in to <span className="font-serif-italic text-primary">Vision</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your conversations and history, kept across devices.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2 bg-secondary">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>

            {(["signin", "signup"] as const).map((m) => (
              <TabsContent key={m} value={m} className="mt-5">
                <form onSubmit={submit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor={`email-${m}`} className="text-xs uppercase tracking-wider text-muted-foreground">
                      Email
                    </Label>
                    <Input
                      id={`email-${m}`}
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@domain.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`pw-${m}`} className="text-xs uppercase tracking-wider text-muted-foreground">
                      Password
                    </Label>
                    <Input
                      id={`pw-${m}`}
                      type="password"
                      autoComplete={m === "signup" ? "new-password" : "current-password"}
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={m === "signup" ? "8+ characters" : "••••••••"}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={submitting}
                    className={cn(
                      "w-full rounded-full bg-primary font-medium text-primary-foreground hover:bg-primary/90 ease-vision",
                    )}
                  >
                    {submitting ? "…" : m === "signup" ? "Create account" : "Sign in"}
                  </Button>
                </form>
              </TabsContent>
            ))}
          </Tabs>

          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground/60">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={signInWithGoogle}
            disabled={oauthLoading}
            className="w-full rounded-full border-border bg-secondary font-medium text-foreground hover:bg-muted ease-vision"
          >
            {oauthLoading ? "Opening Google…" : "Continue with Google"}
          </Button>
        </div>

        <p className="mt-6 text-center font-mono text-[10px] tracking-widest uppercase text-muted-foreground/50">
          askvision.ai
        </p>
      </div>
    </main>
  );
};

export default Auth;
