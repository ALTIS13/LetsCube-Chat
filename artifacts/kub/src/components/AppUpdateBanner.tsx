import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { useVoiceCall, voiceCallSnapshot } from "@/hooks/useVoiceCall";
import { voiceRingsSnapshot } from "@/hooks/useVoiceRing";
import {
  KUB_SW_UPDATE_READY_EVENT,
  restartOntoWaitingBuild,
} from "@/hooks/usePwa";
import { useAppStore } from "@/store/app.store";
import {
  APP_UPDATE_NOTICE_SHOWN_KEY,
  APP_UPDATE_QUIET_RESTART_KEY,
  parseLastShownAt,
  shouldRestartQuietly,
  shouldShowUpdateNotice,
  updateAction,
} from "@/lib/pwa/appUpdateNotice";

/**
 * A new build reaching a running session, and the two ways it can.
 *
 * `lib/pwa/appUpdateNotice.ts` carries the argument. In short: an update is a
 * reload, so a tab held open across a deploy never takes one — which is the
 * defect the owner reported, running a two-commit-old bundle while the new one
 * was live. There are two answers and this component is both of them.
 *
 * **Quietly, where the reload costs nothing.** No call, no conversation open,
 * and the tab either hidden or untouched for long enough. Then it reloads
 * itself and says nothing, because there is nothing to say: the page comes back
 * where it already was.
 *
 * **An offer, everywhere else.** The pill, throttled to one an hour — our own
 * deploy cadence, not Discord's stable channel; the measurement is in the
 * module. It has no «Позже», because there is nothing to postpone.
 *
 * What the pill replaced, and why, is D-264. The card was placed at
 * `top: calc(0.75rem + safe-top)` — over the chat header — and measured at 390
 * it covered **three** header controls: the back button, the title and the
 * menu, each of whose own centre hit-tested to the card. On a phone that header
 * is the only way out of a conversation. It now sits in the band the product
 * already floats notices in (`KubFeedbackViewport` uses the same offset), below
 * the chrome and over content, which is what `kub-glass-strong` is for.
 */

const CHECK_INTERVAL_MS = 5 * 60_000;

/**
 * How often the quiet conditions are re-read while a build is pending.
 *
 * They are read from snapshots rather than subscribed to, so this is the whole
 * cost of watching them, and it only runs while there is something to apply.
 */
const QUIET_PROBE_INTERVAL_MS = 15_000;

export function AppUpdateBanner() {
  const [pending, setPending] = useState(false);
  const [waitingRegistration, setWaitingRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const currentBundle = useMemo(() => getCurrentBundlePath(), []);
  const stillness = useStillness();

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

  if (!pending) return null;
  return <PendingUpdate registration={waitingRegistration} stillness={stillness} />;
}

/**
 * What to do about a build that is waiting, decided once it is waiting.
 *
 * Split out so that a session with nothing pending — which is almost every
 * session, almost all of the time — runs no probe, keeps no timer and
 * subscribes to nothing.
 */
function PendingUpdate({
  registration,
  stillness,
}: {
  registration: ServiceWorkerRegistration | null;
  stillness: Stillness;
}) {
  const [showing, setShowing] = useState(false);
  const restarting = useRef(false);

  // The quiet path, tried first and then again while it stays unavailable.
  useEffect(() => {
    const attempt = () => {
      if (restarting.current) return;
      const now = Date.now();
      const call = voiceCallSnapshot();
      const callBusy =
        call.phase === "connected" ||
        call.phase === "joining" ||
        call.phase === "reconnecting" ||
        voiceRingsSnapshot().length > 0;
      const conversationOpen = useAppStore.getState().selectedChatId !== null;
      // A tab that is doing something is not a still tab: while anything vetoes
      // the restart, both clocks start again from now, so the window is
      // measured from the moment the last of them cleared rather than from
      // whenever the tab happened to go quiet. Without this, leaving a call in
      // a hidden tab would be followed by an immediate reload.
      if (callBusy || conversationOpen) stillness.busy(now);
      const rest = stillness.read(now);
      if (
        !shouldRestartQuietly({
          pending: true,
          callBusy,
          conversationOpen,
          hiddenSince: rest.hiddenSince,
          lastInteractionAt: rest.lastInteractionAt,
          lastQuietRestartAt: parseLastShownAt(readStored(sessionStore, APP_UPDATE_QUIET_RESTART_KEY)),
          now,
        })
      ) {
        return;
      }
      restarting.current = true;
      // Written before the reload, and to `sessionStorage`, so it belongs to
      // this tab and survives the navigation. A restart that does not take —
      // mid-rollover, two replicas, a stale proxy — must not become a loop.
      writeStored(sessionStore, APP_UPDATE_QUIET_RESTART_KEY, String(now));
      restartOntoWaitingBuild(registration);
    };
    attempt();
    const timer = window.setInterval(attempt, QUIET_PROBE_INTERVAL_MS);
    const onVisibility = () => attempt();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [registration, stillness]);

  // Decided once and latched, not recomputed per render. The moment the notice
  // is shown it records the time, and a second reading of that record would
  // then say "too soon" — so a plain derived value would put the notice on
  // screen and take it away again on the next render this component happens to
  // do. `required` is always false: no web build can declare itself required
  // today, and the module comment says where that signal would come from.
  useEffect(() => {
    if (showing || restarting.current) return;
    const allowed = shouldShowUpdateNotice({
      pending: true,
      required: false,
      lastShownAt: parseLastShownAt(readStored(localStore, APP_UPDATE_NOTICE_SHOWN_KEY)),
      now: Date.now(),
    });
    if (!allowed) return;
    // The interval runs from the last time somebody was shown the notice, not
    // from the last deploy, so an hour of deploys costs one notice.
    writeStored(localStore, APP_UPDATE_NOTICE_SHOWN_KEY, String(Date.now()));
    setShowing(true);
  }, [showing]);

  if (!showing) return null;
  return <UpdateNotice registration={registration} />;
}

/**
 * Split out so the call is only subscribed to while the offer is on screen.
 * Everything above this reads the call from a snapshot, which costs no render.
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

type Stillness = {
  /** How long this tab has been hidden and untouched, as of `now`. */
  read: (now: number) => { hiddenSince: number | null; lastInteractionAt: number };
  /** Something is going on: start both clocks again. */
  busy: (now: number) => void;
};

/**
 * How long nobody has been using this tab.
 *
 * Refs and passive listeners, never state: this is mounted at the application
 * root for the whole session and must not cost a render. A tab that is already
 * hidden when the session starts counts as hidden from that moment rather than
 * from whenever it actually went away — the conservative direction, since the
 * only thing this is ever used to justify is reloading.
 */
function useStillness(): Stillness {
  const hiddenSince = useRef<number | null>(null);
  const lastInteractionAt = useRef(Date.now());

  useEffect(() => {
    if (typeof document === "undefined") return;
    hiddenSince.current = document.visibilityState === "hidden" ? Date.now() : null;
    const onVisibility = () => {
      const now = Date.now();
      hiddenSince.current = document.visibilityState === "hidden" ? now : null;
      lastInteractionAt.current = now;
    };
    const onInteraction = () => {
      lastInteractionAt.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    for (const name of ["pointerdown", "keydown", "touchstart", "wheel"] as const) {
      document.addEventListener(name, onInteraction, { passive: true, capture: true });
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const name of ["pointerdown", "keydown", "touchstart", "wheel"] as const) {
        document.removeEventListener(name, onInteraction, { capture: true });
      }
    };
  }, []);

  return useMemo<Stillness>(
    () => ({
      read: () => ({ hiddenSince: hiddenSince.current, lastInteractionAt: lastInteractionAt.current }),
      busy: (now: number) => {
        lastInteractionAt.current = now;
        if (hiddenSince.current !== null) hiddenSince.current = now;
      },
    }),
    [],
  );
}

type Store = "local" | "session";
const localStore: Store = "local";
const sessionStore: Store = "session";

function storage(store: Store): globalThis.Storage | null {
  try {
    return store === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readStored(store: Store, key: string): string | null {
  try {
    return storage(store)?.getItem(key) ?? null;
  } catch {
    // A browser with site data blocked has no memory of the last notice, so it
    // sees every one. That is the safe direction: the alternative is silence.
    // It also has no memory of the last quiet restart — where the safe
    // direction is the other way, which is why the loop guard is only ever the
    // second line of defence behind the conditions themselves.
    return null;
  }
}

function writeStored(store: Store, key: string, value: string): void {
  try {
    storage(store)?.setItem(key, value);
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
