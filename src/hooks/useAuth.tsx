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

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Subscribe FIRST so we don't miss the initial session-restoration event,
    // then hydrate from storage. Supabase's recommended ordering.
    const { data: sub } = supabase.auth.onAuthStateChange((evt, next) => {
      setSession(next);
      setLoading(false);

      // Fire a one-time branded welcome email when a user signs in for the
      // first time. Server-side idempotency (welcome-${user.id}) prevents
      // duplicate sends across devices/sessions; the localStorage flag
      // avoids unnecessary network calls for repeat sign-ins on this device.
      if (evt === "SIGNED_IN" && next?.user) {
        const user = next.user;
        const flagKey = `vision:welcome-sent:${user.id}`;
        if (typeof window !== "undefined" && !localStorage.getItem(flagKey)) {
          const name =
            (user.user_metadata?.full_name as string | undefined) ||
            (user.user_metadata?.name as string | undefined) ||
            (user.email ? user.email.split("@")[0] : undefined);
          // Fire-and-forget; failures are non-blocking.
          supabase.functions
            .invoke("send-transactional-email", {
              body: {
                templateName: "welcome",
                recipientEmail: user.email,
                idempotencyKey: `welcome-${user.id}`,
                templateData: name ? { name } : {},
              },
            })
            .then(() => {
              try {
                localStorage.setItem(flagKey, "1");
              } catch {
                /* ignore */
              }
            })
            .catch(() => {
              /* non-blocking */
            });
        }
      }
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
