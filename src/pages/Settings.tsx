import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Camera, Trash2, UserMinus } from "lucide-react";
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
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";
import { cn } from "@/lib/utils";

const Settings = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, loading, updateProfile, uploadAvatar } = useProfile();

  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [experience, setExperience] = useState<CryptoExperience | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [risk, setRisk] = useState<RiskTolerance | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.display_name ?? "");
    setAvatarUrl(profile.avatar_url);
    setExperience(profile.experience);
    setInterests(profile.interests ?? []);
    setRisk(profile.risk_tolerance);
  }, [profile]);

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

  const save = async () => {
    setSaving(true);
    const ok = await updateProfile({
      display_name: name.trim() || null,
      experience,
      interests,
      risk_tolerance: risk,
    });
    setSaving(false);
    if (ok) toast.success("Profile saved");
    else toast.error("Couldn't save profile");
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      <div className="relative z-10 mx-auto max-w-2xl">
        <button
          onClick={() => navigate("/chat")}
          className="mb-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground ease-vision"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to chat
        </button>

        <div className="mb-8">
          <h1 className="text-2xl font-light tracking-tight sm:text-3xl">
            <span className="font-serif-italic text-primary">Settings</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tweak how Vision talks with you. Changes save when you hit Save.
          </p>
        </div>

        {loading ? (
          <div className="text-xs text-muted-foreground/70">Loading…</div>
        ) : (
          <div className="space-y-6">
            {/* Profile basics */}
            <section className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md">
              <h2 className="mb-4 text-sm font-medium text-foreground">Profile</h2>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative"
                  disabled={savingAvatar}
                  aria-label="Change profile picture"
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
                    htmlFor="name"
                    className="text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    Display name
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    maxLength={60}
                  />
                </div>
              </div>
              {savingAvatar && (
                <p className="mt-2 text-xs text-muted-foreground">Uploading…</p>
              )}
              <p className="mt-3 text-xs text-muted-foreground/70">
                Signed in as <span className="text-foreground">{user?.email}</span>
              </p>
            </section>

            {/* Experience */}
            <section className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md">
              <h2 className="mb-4 text-sm font-medium text-foreground">Experience level</h2>
              <div className="grid gap-2 sm:grid-cols-3">
                {EXPERIENCE_OPTIONS.map((opt) => {
                  const active = experience === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() =>
                        setExperience(active ? null : opt.value)
                      }
                      className={cn(
                        "rounded-xl border px-3 py-3 text-left ease-vision",
                        active
                          ? "border-primary/60 bg-primary/10"
                          : "border-border bg-card/30 hover:border-primary/30",
                      )}
                    >
                      <div className="text-sm font-medium text-foreground">{opt.label}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {opt.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Interests */}
            <section className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md">
              <h2 className="mb-4 text-sm font-medium text-foreground">Interests</h2>
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
            </section>

            {/* Risk */}
            <section className="rounded-2xl border border-border bg-card/40 p-6 backdrop-blur-md">
              <h2 className="mb-4 text-sm font-medium text-foreground">Risk tone</h2>
              <div className="grid gap-2 sm:grid-cols-3">
                {RISK_OPTIONS.map((opt) => {
                  const active = risk === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setRisk(active ? null : opt.value)}
                      className={cn(
                        "rounded-xl border px-3 py-3 text-left ease-vision",
                        active
                          ? "border-primary/60 bg-primary/10"
                          : "border-border bg-card/30 hover:border-primary/30",
                      )}
                    >
                      <div className="text-sm font-medium text-foreground">{opt.label}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {opt.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={async () => {
                  // Onboarding redirects to /chat if already completed, so we
                  // have to flip the flag back off before navigating.
                  await updateProfile({ onboarding_completed: false });
                  navigate("/onboarding");
                }}
                className="text-xs text-muted-foreground/70 hover:text-foreground ease-vision"
              >
                Re-run onboarding
              </button>
              <Button
                onClick={save}
                disabled={saving}
                className="rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90 ease-vision"
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

export default Settings;
