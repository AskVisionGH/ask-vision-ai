import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { VisionLogo } from "@/components/VisionLogo";
import { SEO } from "@/components/SEO";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type Status =
  | "validating"
  | "ready"
  | "already"
  | "invalid"
  | "submitting"
  | "success"
  | "error";

const Unsubscribe = () => {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<Status>("validating");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    let cancelled = false;
    const validate = async () => {
      try {
        const url = `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(
          token,
        )}`;
        const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setStatus("invalid");
          return;
        }
        if (data?.valid === false && data?.reason === "already_unsubscribed") {
          setStatus("already");
          return;
        }
        if (data?.valid === true) {
          setStatus("ready");
          return;
        }
        setStatus("invalid");
      } catch {
        if (!cancelled) setStatus("invalid");
      }
    };
    validate();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const confirmUnsubscribe = async () => {
    if (!token || status === "submitting") return;
    setStatus("submitting");
    try {
      const { data, error } = await supabase.functions.invoke(
        "handle-email-unsubscribe",
        { body: { token } },
      );
      if (error) throw error;
      if (data?.success) {
        setStatus("success");
      } else if (data?.reason === "already_unsubscribed") {
        setStatus("already");
      } else {
        throw new Error(data?.error || "Unable to unsubscribe");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-6">
      <SEO title="Unsubscribe — Vision" description="Manage your Vision email subscription." noindex />
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-[60vh]" />
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card/60 p-8 shadow-soft backdrop-blur">
        <div className="mb-8 flex items-center gap-2">
          <VisionLogo className="h-6 w-6" />
          <span className="text-lg font-semibold tracking-tight">
            Vision<span className="font-serif-italic text-primary">.</span>
          </span>
        </div>

        {status === "validating" && (
          <p className="text-sm text-muted-foreground">
            Checking your unsubscribe link…
          </p>
        )}

        {status === "ready" && (
          <>
            <h1 className="mb-3 text-2xl font-semibold tracking-tight">
              Unsubscribe from Vision emails
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              You'll stop receiving app emails from Vision. Account-related
              messages (like password resets) will still be delivered.
            </p>
            <Button onClick={confirmUnsubscribe} className="w-full">
              Confirm unsubscribe
            </Button>
          </>
        )}

        {status === "submitting" && (
          <p className="text-sm text-muted-foreground">Unsubscribing…</p>
        )}

        {status === "success" && (
          <>
            <h1 className="mb-3 text-2xl font-semibold tracking-tight">
              You're <span className="font-serif-italic text-primary">unsubscribed</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              We've removed you from Vision app emails. You can resubscribe any
              time from your settings.
            </p>
          </>
        )}

        {status === "already" && (
          <>
            <h1 className="mb-3 text-2xl font-semibold tracking-tight">
              Already unsubscribed
            </h1>
            <p className="text-sm text-muted-foreground">
              This address is already opted out of Vision app emails.
            </p>
          </>
        )}

        {status === "invalid" && (
          <>
            <h1 className="mb-3 text-2xl font-semibold tracking-tight">
              Link not valid
            </h1>
            <p className="text-sm text-muted-foreground">
              This unsubscribe link is invalid or has expired.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <h1 className="mb-3 text-2xl font-semibold tracking-tight">
              Something went wrong
            </h1>
            <p className="text-sm text-muted-foreground">
              {errorMsg || "Please try again in a moment."}
            </p>
            <Button
              onClick={confirmUnsubscribe}
              variant="outline"
              className="mt-4 w-full"
            >
              Try again
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default Unsubscribe;
