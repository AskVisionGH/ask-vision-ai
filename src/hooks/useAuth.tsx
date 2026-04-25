import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
AuthContext.displayName = "AuthContext";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // One-time cleanup: previous versions tracked welcome-email sends in
    // localStorage. The trigger now lives server-side, so these flags are
    // dead weight. Sweep them once per browser.
    if (typeof window !== "undefined") {
      try {
        const cleaned = localStorage.getItem("vision:welcome-flags-cleaned");
        if (!cleaned) {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith("vision:welcome-sent:")) {
              localStorage.removeItem(key);
            }
          }
          localStorage.setItem("vision:welcome-flags-cleaned", "1");
        }
      } catch {
        /* storage may be disabled */
      }
    }

    // Subscribe FIRST so we don't miss the initial session-restoration event,
    // then hydrate from storage. Supabase's recommended ordering.
    // NOTE: The welcome email is sent server-side by a database trigger on
    // auth.users (handles email signup, OAuth, AND wallet users who later
    // confirm an email), so no client-side trigger is needed here.
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, next) => {
      setSession(next);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
