import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, lazy, Suspense } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LoginForm } from "@/components/auth/LoginForm";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { MainLayout } from "@/components/layout/MainLayout";
import { useUser } from "@/hooks/useUser";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { usePushForegroundSession } from "@/hooks/usePushForegroundSession";
import { useBanState } from "@/hooks/useBanState";
import { usePushNotificationNavigation } from "@/hooks/usePush";
import { isNativeApp, supportsBrowserPush } from "@/lib/platform/capabilities";
import { isDesktopShell } from "@/lib/platform/desktop";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { IframeAuthBanner } from "@/components/IframeAuthBanner";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";
import { PwaRuntime } from "@/components/PwaRuntime";
import { AppDialogs } from "@/components/AppDialogs";
import { GlobalSearchPalette } from "@/components/search/GlobalSearchPalette";
import { BannedScreen } from "@/components/BannedScreen";
import { AdminLayout } from "@/pages/admin/AdminLayout";
import { TasksPage } from "@/pages/tasks/TasksPage";
import { BotsPage } from "@/pages/bots/BotsPage";
import { PUBLIC_PREVIEW_CAPTURE_PATH } from "@/lib/publicPreviewFixture";
import { BotDocsPage } from "@/pages/public/BotDocsPage";
import { DownloadPage } from "@/pages/public/DownloadPage";
import { PrivacyPage } from "@/pages/public/PrivacyPage";
import { PublicHomePage } from "@/pages/public/PublicHomePage";
import { SupportPage } from "@/pages/public/SupportPage";
import NotFound from "@/pages/not-found";
import { ThemeSync } from "@/hooks/useTheme";
import { KubBrandLogo, KubButton, KubIcon, KubInput, KubLogo, KubPanel } from "@/components/kub";
import { kubBrandAsset } from "@/components/kub/brandAssets";
import { clearMonitoringUser, reportError, setMonitoringUser } from "@/lib/monitoring";
import { getAuthCallbackErrorMessage, getAuthCallbackExceptionMessage } from "@/lib/authRedirect";
import { establishAuthCallbackSession } from "@/lib/authCallback";
import { useAndroidAppLinks } from "@/hooks/useAndroidAppLinks";
import {
  PASSWORD_RECOVERY_LINK_INVALID_MESSAGE,
  isPasswordRecoveryUrl,
} from "@/lib/authRecovery";
import { isAuthRoute, isPublicRoute } from "@/lib/publicRoutes";
import { decideRootExperience } from "@/lib/publicHomeRouting";

export const queryClient = new QueryClient({
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
      isPasswordRecoveryUrl(hashParams);
    const callbackError =
      getAuthCallbackErrorMessage(url.searchParams) ||
      getAuthCallbackErrorMessage(hashParams);
    cleanAuthCallbackUrl();

    if (callbackError) {
      setError(callbackError);
      return;
    }

    const finish = async () => {
      try {
        const result = await establishAuthCallbackSession(supabase.auth, url);
        if (result.kind === "recovery") {
          setRecoveryMode(true);
          return;
        }
        if (result.kind === "session") {
          setLocation("/", { replace: true });
          return;
        }
        if (isRecovery) {
          setError(PASSWORD_RECOVERY_LINK_INVALID_MESSAGE);
          return;
        }
        setLocation("/login?confirmed=1", { replace: true });
      } catch (err: unknown) {
        reportError(err, {
          category: "auth_callback",
          recovery: isRecovery,
          hasCode: Boolean(url.searchParams.get("code") || hashParams.get("code")),
        });
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
      await supabase.auth.signOut();
      setLocation("/login?password_reset=1", { replace: true });
    } catch (err: unknown) {
      reportError(err, { category: "password_recovery_update" });
      setError(getAuthCallbackExceptionMessage(err));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 kub-grid-bg kub-auth-shell">
      <img
        src={kubBrandAsset("letscube-mascot-primary.png")}
        alt=""
        aria-hidden="true"
        loading="eager"
        decoding="async"
        className="kub-auth-mascot"
      />
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-4 text-center" data-testid="password-recovery-shell">
        <div className="flex flex-col items-center gap-3">
          <KubBrandLogo
            variant="vertical"
            tone="light"
            className="h-24 w-56 justify-center"
            imgClassName="max-h-24"
            alt="LETSCUBE"
          />
          <p className="text-sm text-[color:var(--kub-muted)]">
            Защищённый мессенджер
          </p>
        </div>
        {recoveryMode ? (
          <form onSubmit={handlePasswordUpdate} className="w-full">
            <KubPanel glow="soft" padded={false} className="w-full overflow-hidden text-left">
              <div className="border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/50 px-3 py-2">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--kub-cyan)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--kub-cyan)] kub-pulse" />
                  Восстановление доступа
                </div>
              </div>
              <div className="space-y-4 p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]">
                    <KubIcon name="lock" size={18} />
                  </span>
                  <div className="min-w-0">
                    <h1 className="text-lg font-bold text-[color:var(--kub-text)]">Новый пароль</h1>
                    <p className="mt-1 text-sm leading-relaxed text-[color:var(--kub-muted)]">
                      Ссылка из письма уже подтверждена. Введите новый пароль, код из письма вводить не нужно.
                    </p>
                  </div>
                </div>
                <KubInput
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Новый пароль"
                  leftIcon={<KubIcon name="lock" size={16} />}
                />
                <KubInput
                  type="password"
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Повторите пароль"
                  leftIcon={<KubIcon name="shield" size={16} />}
                />
                {error && <p className="text-xs text-[color:var(--kub-danger)]">{error}</p>}
                <KubButton
                  type="submit"
                  loading={savingPassword}
                  fullWidth
                  size="lg"
                  leftIcon={<KubIcon name="checkCircle" size={16} />}
                >
                  Сменить пароль
                </KubButton>
              </div>
            </KubPanel>
          </form>
        ) : (
          <KubPanel glow="soft" className="w-full text-center">
            <div className="mb-3 flex justify-center">
              <KubLogo size={48} withGlow />
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-[color:var(--kub-text)]">
            {!error && (
              <span className="inline-flex h-2 w-2 rounded-full bg-[var(--kub-cyan)] kub-pulse" />
            )}
            {error ?? "Входим..."}
            </div>
          </KubPanel>
        )}
        {error && !recoveryMode && (
          <KubButton
            type="button"
            onClick={() => setLocation("/login?auth_error=confirmation_link", { replace: true })}
            size="md"
          >
            Перейти ко входу
          </KubButton>
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

function LoadingScreen({
  error,
  onRetry,
  onSignOut,
}: {
  error?: string | null;
  onRetry?: () => void;
  onSignOut?: () => void | Promise<void>;
}) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (error) {
      setSlow(true);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 12000);
    return () => window.clearTimeout(timer);
  }, [error]);
  return (
    <div className="min-h-screen flex items-center justify-center kub-grid-bg">
      <div className="flex max-w-sm flex-col items-center gap-4 px-5 text-center">
        <KubLogo size={56} withGlow />
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] font-semibold text-[color:var(--kub-cyan)]">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--kub-cyan)] kub-pulse" />
          Загрузка
        </div>
        {(error || slow) && (
          <div className="w-full rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-4 shadow-xl">
            <p className="text-sm font-semibold text-[color:var(--kub-text)]">
              {error ? "Не удалось загрузить профиль" : "Загрузка длится дольше обычного"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[color:var(--kub-muted)]">
              {error ?? "Проверьте соединение. Можно повторить запрос, не обновляя страницу."}
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="h-9 rounded-lg bg-[var(--kub-cyan)] px-3 text-xs font-semibold text-[color:var(--kub-bg)] hover:brightness-110"
                >
                  Повторить
                </button>
              )}
              {onSignOut && (
                <button
                  type="button"
                  onClick={() => void onSignOut()}
                  className="h-9 rounded-lg px-3 text-xs font-semibold text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)]"
                >
                  Выйти
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimeConfigurationScreen() {
  return (
    <main className="min-h-screen flex items-center justify-center kub-grid-bg px-5">
      <section className="w-full max-w-sm rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-5 text-center shadow-2xl">
        <div className="mb-4 flex justify-center">
          <KubLogo size={56} withGlow />
        </div>
        <h1 className="text-lg font-semibold text-[color:var(--kub-text)]">
          Подключение к серверу не настроено
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[color:var(--kub-muted)]">
          Эта сборка приложения создана без публичных параметров подключения. Соберите APK заново с настройками Supabase или обратитесь к администратору.
        </p>
      </section>
    </main>
  );
}

function AppRoutes() {
  const { user, loading, loadingError, retry, signOut } = useUser();
  const userId = user?.id ?? null;
  const [location] = useLocation();
  const banState = useBanState();
  const authRoute = isAuthRoute(location);
  const rootExperience = location === "/"
    ? decideRootExperience({
      loading: loading || Boolean(loadingError),
      authenticated: Boolean(user),
      nativeShell: isNativeApp() || isDesktopShell(),
    })
    : null;

  // Keep the user's online_at fresh while a session exists.
  useHeartbeat();
  usePushForegroundSession();
  usePushNotificationNavigation();

  useEffect(() => {
    if (userId) {
      setMonitoringUser({ id: userId });
      return () => clearMonitoringUser();
    }
    clearMonitoringUser();
    return undefined;
  }, [userId]);

  // Browser notification permission prompt — once on first authenticated load.
  useEffect(() => {
    if (
      userId &&
      supportsBrowserPush() &&
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }
  }, [userId]);

  // Auth callback always renders so it can exchange the code, regardless of session state.
  if (location.startsWith("/auth/callback")) {
    return <AuthCallback />;
  }

  if (location === "/") {
    if (rootExperience === "loading") {
      return <LoadingScreen error={loadingError} onRetry={retry} onSignOut={user ? signOut : undefined} />;
    }
    if (rootExperience === "public_home") {
      return <PublicHomePage />;
    }
    if (rootExperience === "login") {
      return <Redirect to="/login" />;
    }
  }

  if (loading || loadingError) {
    return <LoadingScreen error={loadingError} onRetry={retry} onSignOut={user ? signOut : undefined} />;
  }

  if (!user && !authRoute) {
    return <Redirect to="/login" />;
  }

  if (user && authRoute) {
    return <Redirect to="/" />;
  }

  // If the signed-in user has an active ban, show the full-screen overlay
  // and nothing else.  An auto sign-out timer inside BannedScreen will then
  // bounce them back to /login.
  if (user && banState.banned && banState.ban) {
    return <BannedScreen ban={banState.ban} />;
  }

  return (
    <>
      {user && <GlobalSearchPalette />}
      <Switch>
        <Route path="/login" component={LoginForm} />
        <Route path="/register" component={RegisterForm} />
        <Route path="/admin/:rest*" component={AdminLayout} />
        <Route path="/admin" component={AdminLayout} />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/bots" component={BotsPage} />
        <Route path="/" component={MainLayout} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

/**
 * DEV-only capture surface for the public product previews.
 *
 * Both halves of the gate are required: `import.meta.env.DEV` and an explicit
 * `VITE_PUBLIC_PREVIEW_FIXTURE=1`. A query flag can never reach it.
 *
 * The gate is spelled out here rather than called as a function on purpose.
 * `lazy()` is not annotated as pure, so calling it at module scope keeps its
 * dynamic import alive: an earlier revision guarded only the branch, and the
 * chunk was still emitted and published. Vite replaces these `import.meta.env`
 * reads before bundling, so the binding folds to `null` in production and the
 * chunk is never created. `isPublicPreviewCaptureEnabled()` remains the runtime
 * rule and the page itself re-checks it.
 */
const PublicPreviewCapturePage =
  import.meta.env.DEV && import.meta.env.VITE_PUBLIC_PREVIEW_FIXTURE === "1"
    ? lazy(() => import("@/pages/public/PublicPreviewCapturePage"))
    : null;

function RootRoutes() {
  const [location] = useLocation();

  if (PublicPreviewCapturePage && location === PUBLIC_PREVIEW_CAPTURE_PATH) {
    return (
      <Suspense fallback={null}>
        <PublicPreviewCapturePage />
      </Suspense>
    );
  }

  if (isPublicRoute(location)) {
    return (
      <Switch>
        <Route path="/bots/docs" component={BotDocsPage} />
        <Route path="/download" component={DownloadPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/support" component={SupportPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  if (!isSupabaseConfigured()) {
    return <RuntimeConfigurationScreen />;
  }

  return <AppRoutes />;
}

function AndroidAppLinkListener() {
  useAndroidAppLinks();
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeSync />
        <PwaRuntime />
        <IframeAuthBanner />
        <AppUpdateBanner />
        <AppDialogs />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AndroidAppLinkListener />
          <RootRoutes />
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
