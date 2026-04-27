import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { PrivyProvider } from "@privy-io/react-auth";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletContextProvider } from "@/providers/WalletContextProvider";
import { EvmWalletProvider } from "@/providers/EvmWalletProvider";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProfileProvider, useProfile } from "@/hooks/useProfile";
import { useWalletAutoLink } from "@/hooks/useWalletAutoLink";
import { WalletMergePrompt } from "@/components/WalletMergePrompt";
import { PRIVY_APP_ID, privyConfig } from "@/lib/privyConfig";
import Index from "./pages/Index.tsx";
import Auth from "./pages/Auth.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import Unsubscribe from "./pages/Unsubscribe.tsx";
import Chat from "./pages/Chat.tsx";
import SharedChat from "./pages/SharedChat.tsx";
import Onboarding from "./pages/Onboarding.tsx";
import Settings from "./pages/Settings.tsx";
import Contacts from "./pages/Contacts.tsx";
// TrackedWallets page kept in the codebase for future re-enable; route is hidden for now.
import Admin from "./pages/Admin.tsx";
import Trade from "./pages/Trade.tsx";
import Alerts from "./pages/Alerts.tsx";
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
  // Persist (user, wallet) link any time a wallet is connected while signed in,
  // and surface a merge dialog if the wallet already belongs to another account.
  const walletLink = useWalletAutoLink();
  return (
    <>
      <WalletMergePrompt
        candidate={walletLink.mergeCandidate}
        merging={walletLink.merging}
        onAccept={walletLink.acceptMerge}
        onDismiss={walletLink.dismissMerge}
      />
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/unsubscribe" element={<Unsubscribe />} />
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
      {/* Tracked-wallets page is hidden behind a "soon" tag in the nav.
          Backend + page code are kept intact; just block the route for now. */}
      <Route path="/tracked-wallets" element={<Navigate to="/chat" replace />} />
      <Route
        path="/trade"
        element={
          <ProtectedRoute>
            <Trade />
          </ProtectedRoute>
        }
      />
      <Route
        path="/alerts"
        element={
          <ProtectedRoute>
            <Alerts />
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
    </>
  );
};

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
        <AuthProvider>
          <ProfileProvider>
            <WalletContextProvider>
              <EvmWalletProvider queryClient={queryClient}>
              <TooltipProvider>
                <Toaster />
                <Sonner />
                <BrowserRouter>
                  <AppRoutes />
                </BrowserRouter>
              </TooltipProvider>
              </EvmWalletProvider>
            </WalletContextProvider>
          </ProfileProvider>
        </AuthProvider>
      </PrivyProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
