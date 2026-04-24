import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletContextProvider } from "@/providers/WalletContextProvider";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useWalletAutoLink } from "@/hooks/useWalletAutoLink";
import Index from "./pages/Index.tsx";
import Auth from "./pages/Auth.tsx";
import Chat from "./pages/Chat.tsx";
import SharedChat from "./pages/SharedChat.tsx";
import Onboarding from "./pages/Onboarding.tsx";
import Settings from "./pages/Settings.tsx";
import Contacts from "./pages/Contacts.tsx";
import TrackedWallets from "./pages/TrackedWallets.tsx";
import Admin from "./pages/Admin.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const FullScreenLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
  </div>
);

const ProtectedRoute = ({
  children,
  requireOnboarding = true,
}: {
  children: JSX.Element;
  requireOnboarding?: boolean;
}) => {
  const { session, loading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  if (loading) return <FullScreenLoader />;
  if (!session) return <Navigate to="/auth" replace />;
  if (requireOnboarding) {
    if (profileLoading) return <FullScreenLoader />;
    if (profile && !profile.onboarding_completed) {
      return <Navigate to="/onboarding" replace />;
    }
  }
  return children;
};

const AppRoutes = () => {
  // Persist (user, wallet) link any time a wallet is connected while signed in.
  useWalletAutoLink();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/shared/:shareId" element={<SharedChat />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/shared/:shareId" element={<SharedChat />} />
              <Route
                path="/onboarding"
                element={
                  <ProtectedRoute requireOnboarding={false}>
                    <Onboarding />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chat"
                element={
                  <ProtectedRoute>
                    <Chat />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute requireOnboarding={false}>
                    <Settings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/contacts"
                element={
                  <ProtectedRoute>
                    <Contacts />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tracked-wallets"
                element={
                  <ProtectedRoute>
                    <TrackedWallets />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requireOnboarding={false}>
                    <Admin />
                  </ProtectedRoute>
                }
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </WalletContextProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
