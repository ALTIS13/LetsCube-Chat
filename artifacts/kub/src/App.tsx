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
import { getAuthCallbackErrorMessage, getAuthCallbackExceptionMessage } from "@/lib/authRedirect";
import {
  PASSWORD_RECOVERY_LINK_INVALID_MESSAGE,
  clearPasswordRecoveryFlow,
  isPasswordRecoveryFlow,
  isPasswordRecoveryUrl,
  markPasswordRecoveryFlow,
} from "@/lib/authRecovery";

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
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const isRecovery =
      isPasswordRecoveryUrl(url.searchParams) ||
      isPasswordRecoveryUrl(hashParams) ||
      isPasswordRecoveryFlow();
    if (isRecovery) {
      markPasswordRecoveryFlow();
    }
    const callbackError =
      getAuthCallbackErrorMessage(url.searchParams) ||
      getAuthCallbackErrorMessage(hashParams);

    if (callbackError) {
      setError(callbackError);
      return;
    }

    const code = url.searchParams.get("code");

    const finish = async () => {
      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (isRecovery) {
            setRecoveryMode(true);
            cleanAuthCallbackUrl();
            return;
          }
          setLocation("/");
          return;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (isRecovery) {
          if (data.session) {
            setRecoveryMode(true);
            cleanAuthCallbackUrl();
          } else {
            clearPasswordRecoveryFlow();
            setError(PASSWORD_RECOVERY_LINK_INVALID_MESSAGE);
          }
          return;
        }
        if (data.session) {
          setLocation("/");
          return;
        }

        setLocation("/login?confirmed=1");
      } catch (err: unknown) {
        setError(getAuthCallbackExceptionMessage(err));
      }
    };
    finish();
  }, [setLocation]);

  const handlePasswordUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      setError("Пароль должен быть не короче 8 символов.");
      return;
    }
    if (newPassword !== repeatPassword) {
      setError("Пароли не совпадают.");
      return;
    }
    setSavingPassword(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      clearPasswordRecoveryFlow();
      await supabase.auth.signOut();
      setLocation("/login?password_reset=1");
    } catch (err: unknown) {
      setError(getAuthCallbackExceptionMessage(err));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center kub-grid-bg">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 px-4 text-center">
        <KubLogo size={64} withGlow />
        {recoveryMode ? (
          <form onSubmit={handlePasswordUpdate} className="w-full rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-5 text-left shadow-2xl">
            <h1 className="mb-2 text-lg font-bold text-[color:var(--kub-text)]">Новый пароль</h1>
            <p className="mb-4 text-sm text-[color:var(--kub-muted)]">
              Введите новый пароль для аккаунта.
            </p>
            <div className="space-y-3">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                placeholder="Новый пароль"
                className="h-11 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
              />
              <input
                type="password"
                value={repeatPassword}
                onChange={(e) => setRepeatPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                placeholder="Повторите пароль"
                className="h-11 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
              />
              {error && <p className="text-xs text-[color:var(--kub-danger)]">{error}</p>}
              <button
                type="submit"
                disabled={savingPassword}
                className="h-10 w-full rounded-lg bg-[var(--kub-cyan)] px-4 text-sm font-semibold text-[color:var(--kub-bg)] transition-colors hover:bg-[var(--kub-cyan-hover)] disabled:opacity-60"
              >
                {savingPassword ? "Сохраняем..." : "Сменить пароль"}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2 text-sm text-[color:var(--kub-text)]">
            {!error && (
              <span className="inline-flex h-2 w-2 rounded-full bg-[var(--kub-cyan)] kub-pulse" />
            )}
            {error ?? "Входим..."}
          </div>
        )}
        {error && !recoveryMode && (
          <button
            type="button"
            onClick={() => setLocation("/login?auth_error=confirmation_link")}
            className="h-10 px-4 rounded-lg text-sm font-semibold transition-colors bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] hover:bg-[var(--kub-cyan-hover)]"
          >
            Перейти ко входу
          </button>
        )}
      </div>
    </div>
  );
}

function cleanAuthCallbackUrl() {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const basePath = baseUrl === "/" ? "" : `/${baseUrl.replace(/^\/+|\/+$/g, "")}`;
  window.history.replaceState(null, "", `${basePath}/auth/callback`);
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

  // Supabase may consume the recovery hash before React reads the URL. The
  // PASSWORD_RECOVERY event sets a sessionStorage flag; while it is present,
  // keep the user in the password update screen instead of entering the app.
  if (user && isPasswordRecoveryFlow()) {
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
