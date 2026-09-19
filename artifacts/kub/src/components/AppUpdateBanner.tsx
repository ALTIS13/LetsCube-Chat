import { useCallback, useEffect, useMemo, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { useVoiceCall } from "@/hooks/useVoiceCall";
import {
  KUB_SW_UPDATE_READY_EVENT,
  restartOntoWaitingBuild,
} from "@/hooks/usePwa";
import {
  APP_UPDATE_NOTICE_SHOWN_KEY,
  parseLastShownAt,
  shouldShowUpdateNotice,
  updateAction,
} from "@/lib/pwa/appUpdateNotice";

/**
 * The offer to take a new build now, and the only place the product makes it.
 *
 * `lib/pwa/appUpdateNotice.ts` carries the argument: the update applies itself
 * at the next launch, so this is an offer rather than a request; it has no
 * «Позже», because there is nothing to postpone; it is throttled the way
 * Discord's web client throttles a build that is not marked `required`; and
 * nothing here ever reloads on its own, because a reload costs the open
 * conversation and that is not ours to spend.
 *
 * What this replaced, and why, is D-264. The card was placed at
 * `top: calc(0.75rem + safe-top)` — over the chat header — and measured at 390
 * it covered **three** header controls: the back button, the title and the
 * menu, each of whose own centre hit-tested to the card. On a phone that header
 * is the only way out of a conversation. It now sits in the band the product
 * already floats notices in (`KubFeedbackViewport` uses the same offset), below
 * the chrome and over content, which is what `kub-glass-strong` is for.
 *
 * It was also older than the material: a hand-rolled `bg-[var(--kub-cyan)]`
 * button, a hand-mixed cyan wash behind a literal `↻` glyph, and a second copy
 * of copy for a «Соединение нестабильно» state the component returned `null`
 * before it could ever render. The controls are the shared ones now.
 */

const CHECK_INTERVAL_MS = 5 * 60_000;

export function AppUpdateBanner() {
  const [pending, setPending] = useState(false);
  const [showing, setShowing] = useState(false);
  const [waitingRegistration, setWaitingRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const currentBundle = useMemo(() => getCurrentBundlePath(), []);

  const checkForUpdate = useCallback(async () => {
    if (!currentBundle) return;
    try {
      const base = import.meta.env.BASE_URL || "/";
      const indexUrl = `${base.endsWith("/") ? base : `${base}/`}index.html`;
      const response = await fetch(indexUrl, { cache: "no-store" });
      if (!response.ok) return;
      const html = await response.text();
      const nextBundle = getBundlePathFromHtml(html);
      if (nextBundle && normalizeAssetPath(nextBundle) !== normalizeAssetPath(currentBundle)) {
        setPending(true);
      }
    } catch {
      // Transient network failures during normal messaging are not deploy
      // signals. Only show the notice after index.html proves a new bundle.
    }
  }, [currentBundle]);

  // Polling the deployed document is what Discord's web client does with
  // `version.stable.json` and what both Telegram web clients do with `version`;
  // it is the only detector that works where no worker was ever registered.
  useEffect(() => {
    void checkForUpdate();
    const timer = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [checkForUpdate]);

  useEffect(() => {
    const handleUpdateReady = (event: Event) => {
      const registration = (event as CustomEvent<{ registration?: ServiceWorkerRegistration }>).detail
        ?.registration;
      if (registration) setWaitingRegistration(registration);
      setPending(true);
    };
    window.addEventListener(KUB_SW_UPDATE_READY_EVENT, handleUpdateReady);
    return () => window.removeEventListener(KUB_SW_UPDATE_READY_EVENT, handleUpdateReady);
  }, []);

  // Decided once and latched, not recomputed per render. The moment the notice
  // is shown it records the time, and a second reading of that record would
  // then say "too soon" — so a plain derived value would put the notice on
  // screen and take it away again on the next render this component happens to
  // do. `required` is always false: no web build can declare itself required
  // today, and the module comment says where that signal would come from.
  useEffect(() => {
    if (!pending || showing) return;
    const allowed = shouldShowUpdateNotice({
      pending,
      required: false,
      lastShownAt: parseLastShownAt(readStored(APP_UPDATE_NOTICE_SHOWN_KEY)),
      now: Date.now(),
    });
    if (!allowed) return;
    // The interval runs from the last time somebody was shown the notice, not
    // from the last deploy, so a week of deploys costs one notice.
    writeStored(APP_UPDATE_NOTICE_SHOWN_KEY, String(Date.now()));
    setShowing(true);
  }, [pending, showing]);

  if (!showing) return null;
  return <UpdateNotice registration={waitingRegistration} />;
}

/**
 * Split out so the call is only subscribed to while the offer is on screen.
 * `AppUpdateBanner` is mounted at the application root and renders nothing
 * almost all of the time; it should not also be a voice-state subscriber.
 */
function UpdateNotice({ registration }: { registration: ServiceWorkerRegistration | null }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const call = useVoiceCall();
  const callActive = call.phase === "connected" || call.phase === "joining" || call.phase === "reconnecting";
  const action = updateAction({ callActive, acknowledged });

  const press = () => {
    if (action === "confirm") {
      setAcknowledged(true);
      return;
    }
    restartOntoWaitingBuild(registration);
  };

  return (
    <div
      // The band the product already floats a notice in, below the chrome and
      // over content. `KubFeedbackViewport` reads the same offset; D-264 says
      // what the previous position cost.
      className="kub-glass-strong kub-menu-in fixed left-1/2 top-[calc(var(--kub-safe-top)+6.75rem)] z-[80] flex w-[calc(100vw-1.5rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-2xl border border-[color:var(--kub-border-color)] py-2 pl-3 pr-2"
      role="status"
      aria-live="polite"
      data-testid="app-update-notice"
      data-action={action}
    >
      <span className="shrink-0 text-[color:var(--kub-cyan)]" aria-hidden="true">
        <KubIcon name="rotate" size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[color:var(--kub-text)]">
          {action === "confirm" ? "Звонок прервётся" : "Готова новая версия"}
        </span>
        {/* Not `truncate`: measured at 390 and at 1440, both sentences were cut
            mid-word inside `max-w-sm`. A notice whose own sentence does not fit
            is the defect it exists to avoid, so the line wraps instead. */}
        <span className="block text-xs leading-snug text-[color:var(--kub-muted)]">
          {action === "confirm"
            ? "Обновление отключит вас от разговора"
            : "Применится при перезапуске"}
        </span>
      </span>
      <KubButton
        size="sm"
        variant={action === "confirm" ? "danger" : "primary"}
        onClick={press}
        data-testid="app-update-restart"
      >
        {action === "confirm" ? "Всё равно" : "Обновить"}
      </KubButton>
    </div>
  );
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // A browser with site data blocked has no memory of the last notice, so it
    // sees every one. That is the safe direction: the alternative is silence.
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the throttle degrades to none, never to a hidden notice.
  }
}

function getCurrentBundlePath(): string | null {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  const entry = scripts.find((script) => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(script.src));
  return entry?.getAttribute("src") ?? entry?.src ?? null;
}

function getBundlePathFromHtml(html: string): string | null {
  const match = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/);
  return match?.[1] ?? null;
}

function normalizeAssetPath(path: string): string {
  try {
    return new URL(path, window.location.origin).pathname;
  } catch {
    return path;
  }
}
