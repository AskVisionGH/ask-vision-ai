import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type CryptoExperience = "new" | "intermediate" | "advanced";
export type RiskTolerance = "cautious" | "balanced" | "aggressive";

export interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  experience: CryptoExperience | null;
  interests: string[];
  risk_tolerance: RiskTolerance | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export type ProfileUpdate = Partial<
  Pick<
    Profile,
    | "display_name"
    | "avatar_url"
    | "experience"
    | "interests"
    | "risk_tolerance"
    | "onboarding_completed"
  >
>;

interface ProfileContextValue {
  profile: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  updateProfile: (patch: ProfileUpdate) => Promise<boolean>;
  uploadAvatar: (file: File) => Promise<string | null>;
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

const useProvideProfile = (): ProfileContextValue => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      setLoading(false);
      return;
    }

    setProfile((data as Profile | null) ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const updateProfile = useCallback(
    async (patch: ProfileUpdate): Promise<boolean> => {
      if (!userId) return false;

      const { data, error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("user_id", userId)
        .select("*")
        .single();

      if (error || !data) return false;
      setProfile(data as Profile);
      return true;
    },
    [userId],
  );

  const uploadAvatar = useCallback(
    async (file: File): Promise<string | null> => {
      if (!userId) return null;
      const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) return null;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = pub.publicUrl;
      await updateProfile({ avatar_url: url });
      return url;
    },
    [userId, updateProfile],
  );

  return useMemo(
    () => ({ profile, loading, refresh, updateProfile, uploadAvatar }),
    [profile, loading, refresh, updateProfile, uploadAvatar],
  );
};

export const ProfileProvider = ({ children }: { children: ReactNode }) => {
  const value = useProvideProfile();
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
};

/** Loads the current user's profile and exposes update + avatar-upload helpers. */
export const useProfile = () => {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside <ProfileProvider>");
  return ctx;
};

/** Returns 1-2 letter initials from a name or email for the fallback avatar. */
export const initialsFor = (name?: string | null, email?: string | null): string => {
  const source = (name && name.trim()) || (email && email.split("@")[0]) || "?";
  const parts = source.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

/** Display name to show in greetings — falls back to email local part. */
export const displayNameFor = (
  profile: Profile | null,
  email?: string | null,
): string => {
  if (profile?.display_name?.trim()) return profile.display_name.trim();
  if (email) return email.split("@")[0];
  return "there";
};
