import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Camera, Check, ChevronLeft } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/UserAvatar";
import { VisionLogo } from "@/components/VisionLogo";
import { cn } from "@/lib/utils";

const STEPS = ["welcome", "experience", "interests", "risk"] as const;
type Step = (typeof STEPS)[number];

const Onboarding = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, loading, updateProfile, uploadAvatar } = useProfile();

  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [experience, setExperience] = useState<CryptoExperience | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [risk, setRisk] = useState<RiskTolerance | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hydrate any existing values so re-running onboarding pre-fills.
  useEffect(() => {
    if (!profile) return;
    setName(profile.display_name ?? "");
    setAvatarUrl(profile.avatar_url);
    setExperience(profile.experience);
    setInterests(profile.interests ?? []);
    setRisk(profile.risk_tolerance);
  }, [profile]);

  // If they already finished onboarding, send them straight to chat.
  useEffect(() => {
    if (!loading && profile?.onboarding_completed) {
      navigate("/chat", { replace: true });
    }
  }, [loading, profile, navigate]);

  const stepIndex = STEPS.indexOf(step);
  const isLast = stepIndex === STEPS.length - 1;

  const goNext = async () => {
    // Persist the per-step value so partial onboarding still saves.
    if (step === "welcome") {
      await updateProfile({ display_name: name.trim() || null });
    } else if (step === "experience") {
      await updateProfile({ experience });
    } else if (step === "interests") {
      await updateProfile({ interests });
    }
    if (isLast) {
      await finish();
    } else {
      setStep(STEPS[stepIndex + 1]);
    }
  };

  const goBack = () => {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1]);
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

  const skipAll = async () => {
    await updateProfile({ onboarding_completed: true });
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

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      <div className="relative z-10 w-full max-w-xl">
        {/* Progress + brand */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <VisionLogo size={20} />
            <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
              Vision
            </span>
          </div>
          <button
            onClick={skipAll}
            className="text-xs text-muted-foreground/70 hover:text-foreground ease-vision"
          >
            Skip for now
          </button>
        </div>

        <div className="mb-8 flex gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-0.5 flex-1 rounded-full ease-vision",
                i <= stepIndex ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md sm:p-8">
          {step === "welcome" && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
                  Welcome to <span className="font-serif-italic text-primary">Vision</span>
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  A few quick questions so I know how to talk with you. All optional.
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
                    size={64}
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
                    What should I call you?
                  </Label>
                  <Input
                    id="display-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    maxLength={60}
                  />
                </div>
              </div>
              {savingAvatar && (
                <p className="text-xs text-muted-foreground">Uploading…</p>
              )}
            </div>
          )}

          {step === "experience" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-light tracking-tight sm:text-2xl">
                  How well do you know crypto?
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
                  What are you into?
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
            </div>
          )}

          {step === "risk" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-light tracking-tight sm:text-2xl">
                  How should I frame risk?
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

          {/* Footer nav */}
          <div className="mt-8 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={goBack}
              disabled={stepIndex === 0}
              className="text-muted-foreground"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
            <Button
              type="button"
              onClick={goNext}
              disabled={finishing || savingAvatar}
              className="rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90 ease-vision"
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
