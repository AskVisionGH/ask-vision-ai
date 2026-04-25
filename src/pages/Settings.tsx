import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bell,
  Camera,
  KeyRound,
  Languages,
  Mail,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserMinus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS, type LanguageCode } from "@/lib/languages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/UserAvatar";
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";
import { Link } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";


const Settings = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { profile, loading, updateProfile, uploadAvatar } = useProfile();
  const [deleteDialog, setDeleteDialog] = useState<null | "wipe" | "full">(null);

  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [saving, setSaving] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Security: change password / change email — kept local so the form clears
  // after a successful update and doesn't leak between sessions.
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [updatingEmail, setUpdatingEmail] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.display_name ?? "");
    setAvatarUrl(profile.avatar_url);
    setLanguage((profile.language as LanguageCode) ?? DEFAULT_LANGUAGE);
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

  const save = async () => {
    setSaving(true);
    const ok = await updateProfile({
      display_name: name.trim() || null,
      language,
    });
    setSaving(false);
    if (ok) toast.success("Profile saved");
    else toast.error("Couldn't save profile");
  };

  const updatePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (updatingPassword) return;
    if (newPassword.length < 8) {
      toast.error("Password too short", { description: "Use at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    setUpdatingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setUpdatingPassword(false);
    if (error) {
      toast.error("Couldn't update password", { description: error.message });
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Password updated");
  };

  const updateEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (updatingEmail) return;
    const target = newEmail.trim().toLowerCase();
    if (!target || !target.includes("@")) {
      toast.error("Enter a valid email");
      return;
    }
    if (target === user?.email?.toLowerCase()) {
      toast.error("That's already your email");
      return;
    }
    setUpdatingEmail(true);
    // Supabase sends a confirmation link to BOTH the old and new addresses.
    // The change only takes effect once both are confirmed.
    const { error } = await supabase.auth.updateUser(
      { email: target },
      { emailRedirectTo: `${window.location.origin}/chat` },
    );
    setUpdatingEmail(false);
    if (error) {
      toast.error("Couldn't update email", { description: error.message });
      return;
    }
    setNewEmail("");
    toast.success("Confirm the change", {
      description: `We sent a confirmation link to ${target} and your current email.`,
    });
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
            {/* Profile basics — always visible */}
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
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={save}
                  disabled={saving}
                  size="sm"
                  className="rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/90 ease-vision"
                >
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </section>

            {/* All other settings — collapsed into dropdowns */}
            <Accordion type="multiple" className="space-y-3">
              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/40 p-5 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex items-start gap-2">
                  <Bell className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <h2 className="text-sm font-medium text-foreground">Alerts</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Manage triggers, devices, and preferences on the Alerts page.
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <Link to="/alerts">Manage alerts</Link>
                </Button>
              </div>

              <AccordionItem
                value="language"
                className="rounded-2xl border border-border bg-card/40 px-6 backdrop-blur-md"
              >
                <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline [&[data-state=open]]:pb-3">
                  <span className="flex items-center gap-2">
                    <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                    Language
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-5">
                  <p className="mb-4 text-xs text-muted-foreground">
                    Vision will reply in this language and use it as a hint when transcribing voice messages.
                  </p>
                  <Select value={language} onValueChange={(v) => setLanguage(v as LanguageCode)}>
                    <SelectTrigger className="w-full sm:w-72">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <span className="flex items-center gap-2">
                            <span>{opt.label}</span>
                            {opt.value !== "auto" && (
                              <span className="text-xs text-muted-foreground">— {opt.native}</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                value="security"
                className="rounded-2xl border border-border bg-card/40 px-6 backdrop-blur-md"
              >
                <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline [&[data-state=open]]:pb-3">
                  <span className="flex items-center gap-2">
                    <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                    Security
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-5">
                  {/* Change password */}
                  <form onSubmit={updatePassword} className="space-y-3">
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Change password
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="new-password" className="text-[11px] text-muted-foreground">
                          New password
                        </Label>
                        <Input
                          id="new-password"
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="8+ characters"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="confirm-password" className="text-[11px] text-muted-foreground">
                          Confirm
                        </Label>
                        <Input
                          id="confirm-password"
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Repeat it"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        disabled={updatingPassword || !newPassword || !confirmPassword}
                      >
                        {updatingPassword ? "Updating…" : "Update password"}
                      </Button>
                    </div>
                  </form>

                  <div className="my-5 h-px bg-border" />

                  {/* Change email */}
                  <form onSubmit={updateEmail} className="space-y-3">
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Change email
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      We'll email a confirmation link to both your current and new
                      address. The change takes effect once both are confirmed.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="new-email" className="text-[11px] text-muted-foreground">
                          New email
                        </Label>
                        <Input
                          id="new-email"
                          type="email"
                          autoComplete="email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          placeholder={user?.email ?? "you@domain.com"}
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        disabled={updatingEmail || !newEmail}
                        className="shrink-0"
                      >
                        <Mail className="mr-1.5 h-3.5 w-3.5" />
                        {updatingEmail ? "Sending…" : "Send confirmation"}
                      </Button>
                    </div>
                  </form>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                value="onboarding"
                className="rounded-2xl border border-border bg-card/40 px-6 backdrop-blur-md"
              >
                <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline [&[data-state=open]]:pb-3">
                  <span className="flex items-center gap-2">
                    <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                    Re-run onboarding
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      Walk through the intro flow again to reset your preferences.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        // Onboarding redirects to /chat if already completed, so we
                        // have to flip the flag back off before navigating.
                        await updateProfile({ onboarding_completed: false });
                        navigate("/onboarding");
                      }}
                      className="shrink-0"
                    >
                      Re-run
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                value="danger"
                className="rounded-2xl border border-destructive/30 bg-destructive/[0.04] px-6 backdrop-blur-md"
              >
                <AccordionTrigger className="py-4 text-sm font-medium text-destructive hover:no-underline [&[data-state=open]]:pb-3">
                  <span className="flex items-center gap-2">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Danger zone
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-5">
                  <p className="mb-3 text-xs text-muted-foreground">
                    Irreversible actions. Take a breath before clicking.
                  </p>
                  <div className="space-y-3">
                    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          Clear my data
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Wipes all chats, contacts, profile, and connected wallets — but keeps your sign-in.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteDialog("wipe")}
                        className="shrink-0"
                      >
                        Clear data
                      </Button>
                    </div>

                    <div className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                          <UserMinus className="h-3.5 w-3.5" />
                          Delete account
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Permanently deletes your account and everything tied to it.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteDialog("full")}
                        className="shrink-0"
                      >
                        Delete account
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
      </div>

      {user?.email && (
        <DeleteAccountDialog
          open={deleteDialog !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteDialog(null);
          }}
          mode={deleteDialog ?? "wipe"}
          userEmail={user.email}
          onConfirmed={async (mode) => {
            setDeleteDialog(null);
            if (mode === "full") {
              toast.success("Account deleted");
              await signOut();
              navigate("/auth", { replace: true });
            } else {
              toast.success("Your data has been cleared");
              // Keep them signed in — push them through onboarding fresh.
              navigate("/onboarding", { replace: true });
            }
          }}
        />
      )}
    </main>
  );
};

export default Settings;
