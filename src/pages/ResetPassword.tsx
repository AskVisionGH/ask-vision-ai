import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VisionLogo } from "@/components/VisionLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Landing page for the password recovery email link.
 *
 * Supabase drops the user here with a recovery session in the URL hash. We
 * MUST let that session attach (otherwise updateUser() would silently log
 * them in without resetting), then collect a new password and call
 * supabase.auth.updateUser({ password }).
 */
const ResetPassword = () => {
  const navigate = useNavigate();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when it parses the recovery token from
    // the URL hash. We block the form until that handshake happens so we know
    // updateUser() is talking to the right session.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryReady(true);
    });
    // Edge case: if the user already has a session (e.g. they refreshed
    // after the token was consumed), still allow the reset form.
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setRecoveryReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 8) {
      toast.error("Password too short", { description: "Use at least 8 characters." });
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast.error("Couldn't update password", { description: error.message });
      return;
    }
    toast.success("Password updated", { description: "You're signed in." });
    navigate("/chat", { replace: true });
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <VisionLogo size={32} className="mb-4 drop-shadow-[0_0_24px_hsl(var(--primary-glow)/0.6)]" />
          <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
            Set a new <span className="font-serif-italic text-primary">password</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose something strong. You'll be signed in right after.
          </p>
        </div>

        {!recoveryReady ? (
          <div className="rounded-2xl border border-border bg-card/40 p-5 text-center text-xs text-muted-foreground backdrop-blur-md">
            Verifying your reset link…
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-card/40 p-5 backdrop-blur-md">
            <div className="space-y-1.5">
              <Label htmlFor="new-pw" className="text-xs uppercase tracking-wider text-muted-foreground">
                New password
              </Label>
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8+ characters"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw" className="text-xs uppercase tracking-wider text-muted-foreground">
                Confirm password
              </Label>
              <Input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat it"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full bg-primary font-medium text-primary-foreground hover:bg-primary/90 ease-vision"
            >
              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
              {submitting ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
};

export default ResetPassword;
