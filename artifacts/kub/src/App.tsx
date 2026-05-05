import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LoginForm } from "@/components/auth/LoginForm";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { MainLayout } from "@/components/layout/MainLayout";
import { useUser } from "@/hooks/useUser";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useBanState } from "@/hooks/useBanState";
import { createClient } from "@/lib/supabase/client";
import { IframeAuthBanner } from "@/components/IframeAuthBanner";
import { BannedScreen } from "@/components/BannedScreen";
import { AdminLayout } from "@/pages/admin/AdminLayout";
import { TasksPage } from "@/pages/tasks/TasksPage";
import NotFound from "@/pages/not-found";
import { ThemeSync } from "@/hooks/useTheme";
import { KubLogo } from "@/components/kub";
import { mapPgError } from "@/lib/errors";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function AuthCallback() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    const finish = async () => {
      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }
        setLocation("/");
      } catch (err: unknown) {
        setError(mapPgError(err));
        setTimeout(() => setLocation("/login?error=auth_failed"), 1500);
      }
    };
    finish();
  }, [setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center kub-grid-bg">
      <div className="flex flex-col items-center gap-4 text-center">
        <KubLogo size={64} withGlow />
        <div className="flex items-center gap-2 text-sm text-[color:var(--kub-text)]">
          {!error && (
            <span className="inline-flex h-2 w-2 rounded-full bg-[var(--kub-cyan)] kub-pulse" />
          )}
          {error ?? "Входим…"}
        </div>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center kub-grid-bg">
      <div className="flex flex-col items-center gap-4">
        <KubLogo size={56} withGlow />
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] font-semibold text-[color:var(--kub-cyan)]">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--kub-cyan)] kub-pulse" />
          Загрузка
        </div>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { user, loading } = useUser();
  const userId = user?.id ?? null;
  const [location] = useLocation();
  const banState = useBanState();

  // Keep the user's online_at fresh while a session exists.
  useHeartbeat();

  // Browser notification permission prompt — once on first authenticated load.
  useEffect(() => {
    if (
      userId &&
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }
  }, [userId]);

  if (loading) return <LoadingScreen />;

  const isAuthRoute =
    location.startsWith("/login") ||
    location.startsWith("/register") ||
    location.startsWith("/auth");

  // Auth callback always renders so it can exchange the code, regardless of session state.
  if (location.startsWith("/auth/callback")) {
    return <AuthCallback />;
  }

  if (!user && !isAuthRoute) {
    return <Redirect to="/login" />;
  }

  if (user && isAuthRoute) {
    return <Redirect to="/" />;
  }

  // If the signed-in user has an active ban, show the full-screen overlay
  // and nothing else.  An auto sign-out timer inside BannedScreen will then
  // bounce them back to /login.
  if (user && banState.banned && banState.ban) {
    return <BannedScreen ban={banState.ban} />;
  }

  return (
    <Switch>
      <Route path="/login" component={LoginForm} />
      <Route path="/register" component={RegisterForm} />
      <Route path="/admin/:rest*" component={AdminLayout} />
      <Route path="/admin" component={AdminLayout} />
      <Route path="/tasks" component={TasksPage} />
      <Route path="/" component={MainLayout} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeSync />
        <IframeAuthBanner />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRoutes />
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
