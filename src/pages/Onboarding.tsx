import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Camera, Check, ChevronLeft, Languages, Mail, Sparkles } from "lucide-react";
import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS, type LanguageCode } from "@/lib/languages";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  CryptoExperience,
  RiskTolerance,
  useProfile,
} from "@/hooks/useProfile";
import {
  EXPERIENCE_OPTIONS,
  INTEREST_OPTIONS,
  RISK_OPTIONS,
} from "@/lib/profile-options";
import { isWalletSyntheticEmail } from "@/lib/wallet-email";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/UserAvatar";
import { VisionLogo } from "@/components/VisionLogo";
import { cn } from "@/lib/utils";

// "email" is conditionally injected right after "welcome" for wallet-only
// accounts that signed in via SIWS and don't yet have a real inbox attached.
type Step = "welcome" | "email" | "experience" | "interests" | "risk" | "language";

const STEP_LABELS: Record<Step, string> = {
  welcome: "About you",
  email: "Email",
  experience: "Experience",
  interests: "Interests",
  risk: "Risk",
  language: "Language",
};

const Onboarding = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // When the user re-runs onboarding from Settings we skip the "welcome"
  // step (display name + avatar) — they've already set those, and the
  // intent of re-running is to update preferences, not rename themselves.
  const isRerun = searchParams.get("rerun") === "1";
  const { user } = useAuth();
  const { profile, loading, updateProfile, uploadAvatar } = useProfile();

  const [step, setStep] = useState<Step>(isRerun ? "experience" : "welcome");
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [experience, setExperience] = useState<CryptoExperience | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [risk, setRisk] = useState<RiskTolerance | null>(null);
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wallet-only signups have a synthetic `<wallet>@wallet.vision.local` email
  // attached to the auth user. We surface a dedicated step asking them to
  // attach a real inbox so they can receive welcome / receipt / alert emails.
  const needsRealEmail = isWalletSyntheticEmail(user?.email);
  const [email, setEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  // Once we successfully kick off Supabase's confirm-link flow we mark this
  // step "satisfied" locally so the user can move on without waiting for the
  // confirmation click — the address change finalizes whenever they click it.
  const [emailSubmitted, setEmailSubmitted] = useState(false);

  // Hydrate any existing values so re-running onboarding pre-fills.
  useEffect(() => {
    if (!profile) return;
    setName(profile.display_name ?? "");
    setAvatarUrl(profile.avatar_url);
    setExperience(profile.experience);
    setInterests(profile.interests ?? []);
    setRisk(profile.risk_tolerance);
    setLanguage((profile.language as LanguageCode) ?? DEFAULT_LANGUAGE);
  }, [profile]);

  // If they already finished onboarding, send them straight to chat.
  useEffect(() => {
    if (!loading && profile?.onboarding_completed) {
      navigate("/chat", { replace: true });
    }
  }, [loading, profile, navigate]);

  // Step list is dynamic: only show the email step when we actually need one.
  const steps = useMemo<Step[]>(() => {
    const base: Step[] = isRerun
      ? ["experience", "interests", "risk"]
      : ["welcome", "experience", "interests", "risk"];
    // Inject the email step right after welcome (or at the start on rerun)
    // for wallet-only users who still need to attach a real inbox.
    if (!needsRealEmail) return base;
    if (isRerun) return ["email", ...base];
    return ["welcome", "email", "experience", "interests", "risk"];
  }, [needsRealEmail, isRerun]);
  const stepIndex = steps.indexOf(step);
  const isLast = stepIndex === steps.length - 1;
  const progress = ((stepIndex + 1) / steps.length) * 100;

  // Brief fade between steps so the transition feels intentional rather than snappy.
  const advance = (next: Step | "finish") => {
    setTransitioning(true);
    window.setTimeout(() => {
      if (next === "finish") {
        void finish();
      } else {
        setStep(next);
      }
      setTransitioning(false);
    }, 150);
  };

  // Display name is required to start using the app — enforce minimum 2 chars
  // after trimming so we don't accept whitespace-only or single-char inputs.
  const trimmedName = name.trim();
  const isNameValid = trimmedName.length >= 2 && trimmedName.length <= 60;

  const submitEmail = async (): Promise<boolean> => {
    const target = email.trim().toLowerCase();
    if (!target.includes("@") || target.length < 5) {
      toast.error("Enter a valid email");
      return false;
    }
    setSavingEmail(true);
    // Supabase emails the new address with a confirm link; once clicked it
    // becomes the user's primary email and our welcome trigger fires.
    const { error } = await supabase.auth.updateUser(
      { email: target },
      { emailRedirectTo: `${window.location.origin}/chat` },
    );
    setSavingEmail(false);
    if (error) {
      toast.error("Couldn't save email", { description: error.message });
      return false;
    }
    setEmailSubmitted(true);
    toast.success("Confirm your email", {
      description: `We sent a confirmation link to ${target}.`,
    });
    return true;
  };

  const goNext = async () => {
    // Persist the per-step value so partial onboarding still saves.
    if (step === "welcome") {
      if (!isNameValid) return; // guard — button is also disabled
      await updateProfile({ display_name: trimmedName });
    } else if (step === "email") {
      // Skip the API call if the user already kicked off the confirm flow.
      if (!emailSubmitted) {
        const ok = await submitEmail();
        if (!ok) return;
      }
    } else if (step === "experience") {
      await updateProfile({ experience });
    } else if (step === "interests") {
      await updateProfile({ interests });
    }
    if (isLast) {
      advance("finish");
    } else {
      advance(steps[stepIndex + 1]);
    }
  };

  const goBack = () => {
    if (stepIndex > 0) advance(steps[stepIndex - 1]);
  };

  const finish = async () => {
    setFinishing(true);
    const ok = await updateProfile({
      risk_tolerance: risk,
      onboarding_completed: true,
    });
    setFinishing(false);
    if (!ok) {
      toast.error("Couldn't save profile", { description: "Please try again." });
      return;
    }
    toast.success("You're all set");
    navigate("/chat", { replace: true });
  };

  const [skipping, setSkipping] = useState(false);
  const skipAll = async () => {
    if (skipping || finishing) return;
    // Display name is the only required field — require it even when skipping
    // the rest of onboarding so every account has something to show.
    if (!isNameValid) {
      toast.error("Pick a display name first", {
        description: "It's the only thing we need before you head in.",
      });
      return;
    }
    // Wallet-only accounts must attach a real email — they can't skip past it
    // without giving us a way to reach them.
    if (needsRealEmail && !emailSubmitted) {
      toast.error("Add an email first", {
        description: "We need somewhere to send receipts and alerts.",
      });
      setStep("email");
      return;
    }
    setSkipping(true);
    const ok = await updateProfile({
      display_name: trimmedName,
      onboarding_completed: true,
    });
    if (!ok) {
      setSkipping(false);
      toast.error("Couldn't skip", {
        description: "Please try again or finish the steps.",
      });
      return;
    }
    navigate("/chat", { replace: true });
  };

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image too large", { description: "Max 5 MB." });
      return;
    }
    setSavingAvatar(true);
    const url = await uploadAvatar(file);
    setSavingAvatar(false);
    if (url) {
      setAvatarUrl(url);
      toast.success("Profile picture updated");
    } else {
      toast.error("Upload failed");
    }
  };

  const toggleInterest = (value: string) => {
    setInterests((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  // Disable Continue when the current step requires a choice but none made.
  const isEmailValid = email.trim().includes("@") && email.trim().length >= 5;
  const canContinue = (() => {
    if (transitioning || finishing || savingAvatar || savingEmail) return false;
    if (step === "welcome") return isNameValid;
    if (step === "email") return emailSubmitted || isEmailValid;
    if (step === "experience") return experience !== null;
    if (step === "risk") return risk !== null;
    return true;
  })();

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[40vh] w-[2px] -translate-x-1/2 beam animate-pulse-glow"
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-xl">
        {/* Brand + skip */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <VisionLogo size={20} />
            <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
              Vision
            </span>
          </div>
          <button
            onClick={skipAll}
            disabled={skipping || finishing}
            className="text-xs text-muted-foreground/70 hover:text-foreground ease-vision disabled:opacity-50"
          >
            {skipping ? "Skipping…" : "Skip for now"}
          </button>
        </div>

        {/* Progress: smooth bar + numbered step */}
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70">
          <span>
            Step {stepIndex + 1} of {steps.length} · {STEP_LABELS[step]}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="mb-8 h-0.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full bg-primary transition-all duration-500 ease-vision"
            style={{ width: `${progress}%`, boxShadow: "0 0 12px hsl(var(--primary-glow) / 0.5)" }}
          />
        </div>

        <div className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md sm:p-8">
          <div
            className={cn(
              "transition-opacity duration-150 ease-vision",
              transitioning ? "opacity-0" : "opacity-100 animate-fade-up",
            )}
          >
            {step === "welcome" && (
              <div className="space-y-6">
                <div>
                  <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-widest text-primary">
                    <Sparkles className="h-3 w-3" />
                    Let's set you up
                  </div>
                  <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
                    Welcome to <span className="font-serif-italic text-primary">Vision</span>
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    A few quick questions so I know how to talk with you. Just your name is required — the rest is optional.
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="group relative"
                    aria-label="Upload profile picture"
                    disabled={savingAvatar}
                  >
                    <UserAvatar
                      name={name}
                      email={user?.email}
                      src={avatarUrl}
                      size={72}
                    />
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70 opacity-0 transition-opacity group-hover:opacity-100">
                      <Camera className="h-4 w-4 text-foreground" />
                    </span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onFileChange}
                  />
                  <div className="flex-1 space-y-1.5">
                    <Label
                      htmlFor="display-name"
                      className="text-xs uppercase tracking-wider text-muted-foreground"
                    >
                      What should I call you? <span className="text-primary">*</span>
                    </Label>
                    <Input
                      id="display-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      maxLength={60}
                      required
                      aria-required="true"
                    />
                    <p className="text-[11px] text-muted-foreground/70">
                      Required — at least 2 characters.
                    </p>
                  </div>
                </div>
                {savingAvatar && (
                  <p className="text-xs text-muted-foreground">Uploading…</p>
                )}
              </div>
            )}

            {step === "email" && (
              <div className="space-y-6">
                <div>
                  <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-widest text-primary">
                    <Mail className="h-3 w-3" />
                    One more thing
                  </div>
                  <h2 className="text-xl font-light tracking-tight sm:text-2xl">
                    Where can we <span className="font-serif-italic text-primary">reach</span> you?
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    You signed in with a wallet — we still need an email for receipts,
                    price alerts, and account recovery. We'll send a quick confirmation link.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="onboarding-email"
                    className="text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    Email <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="onboarding-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      // Editing after a submit means they want to send a new
                      // confirm link — clear the satisfied flag so Continue
                      // re-triggers the API call.
                      if (emailSubmitted) setEmailSubmitted(false);
                    }}
                    placeholder="you@example.com"
                    disabled={savingEmail}
                  />
                  {emailSubmitted ? (
                    <p className="text-[11px] text-primary">
                      Confirmation link sent. Check your inbox — you can keep going in the meantime.
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/70">
                      We never share this. Used only for product emails you've enabled.
                    </p>
                  )}
                </div>
              </div>
            )}

            {step === "experience" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-light tracking-tight sm:text-2xl">
                    How well do you know <span className="font-serif-italic text-primary">crypto</span>?
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This shapes how much I explain vs. how fast I move.
                  </p>
                </div>

                <div className="space-y-2">
                  {EXPERIENCE_OPTIONS.map((opt) => {
                    const active = experience === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setExperience(opt.value)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left ease-vision",
                          active
                            ? "border-primary/60 bg-primary/10"
                            : "border-border bg-card/30 hover:border-primary/30 hover:bg-card",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                            active
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {active && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">
                            {opt.label}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {opt.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === "interests" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-light tracking-tight sm:text-2xl">
                    What are you <span className="font-serif-italic text-primary">into</span>?
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Pick anything that fits — I'll lean into these in conversations.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {INTEREST_OPTIONS.map((opt) => {
                    const active = interests.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        onClick={() => toggleInterest(opt.value)}
                        className={cn(
                          "rounded-full border px-4 py-2 text-xs ease-vision",
                          active
                            ? "border-primary/60 bg-primary/15 text-foreground"
                            : "border-border bg-card/30 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {interests.length > 0 && (
                  <p className="text-[11px] text-muted-foreground/70">
                    {interests.length} selected
                  </p>
                )}
              </div>
            )}

            {step === "risk" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-light tracking-tight sm:text-2xl">
                    How should I frame <span className="font-serif-italic text-primary">risk</span>?
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Affects how loud I am about downsides. Not financial advice either way.
                  </p>
                </div>

                <div className="space-y-2">
                  {RISK_OPTIONS.map((opt) => {
                    const active = risk === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setRisk(opt.value)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left ease-vision",
                          active
                            ? "border-primary/60 bg-primary/10"
                            : "border-border bg-card/30 hover:border-primary/30 hover:bg-card",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                            active
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {active && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">
                            {opt.label}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {opt.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer nav */}
          <div className="mt-8 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={goBack}
              disabled={stepIndex === 0 || transitioning}
              className="text-muted-foreground"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
            <Button
              type="button"
              onClick={goNext}
              disabled={!canContinue}
              className="rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90 ease-vision shadow-glow"
            >
              {isLast ? (finishing ? "Finishing…" : "Finish") : "Continue"}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
};

export default Onboarding;
