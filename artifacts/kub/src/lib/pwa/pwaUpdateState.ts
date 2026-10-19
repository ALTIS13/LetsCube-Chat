export const PWA_UPDATE_RECEIPT_KEY = "letscube:pwa-update:restart";
export const PWA_UPDATE_TIMEOUT_MS = 10_000;
export const PWA_UPDATE_SUCCESS_MS = 4_200;

export type PwaUpdatePhase = "idle" | "checking" | "current" | "ready" | "updating" | "updated" | "failed";
export type PwaUpdateFailure = "check" | "restart" | "unchanged" | "blocked" | "call";
export type PwaUpdateSnapshot = {
  phase: PwaUpdatePhase;
  available: boolean;
  registration: ServiceWorkerRegistration | null;
  targetEntry: string | null;
  failure: PwaUpdateFailure | null;
  notice: boolean;
};
type RestartOptions = { beforeReload: () => boolean; onFailure: () => void };
// The exact live call snapshot is a RAM-only permission, never a boolean or receipt field.
type CallConfirmation = object | null;
type Ports = {
  entry: string | null;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  check: (signal: AbortSignal) => Promise<{ entry: string; registration: ServiceWorkerRegistration | null; waiting: boolean }>;
  restart: (registration: ServiceWorkerRegistration | null, options: RestartOptions) => () => void;
  guard: (confirmedCall: CallConfirmation) => PwaUpdateFailure | null;
  beforeRestart: () => void;
};

/** UI state only: worker registration, handoff and notification protocols stay in usePwa. */
export function createPwaUpdateState(ports: Ports) {
  let state: PwaUpdateSnapshot = { phase: "idle", available: false, registration: null, targetEntry: null, failure: null, notice: false };
  const listeners = new Set<() => void>();
  let operation = 0;
  let checkInFlight: Promise<void> | null = null;
  let abortCheck: (() => void) | null = null;
  let restartCleanup: (() => void) | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let successTimer: ReturnType<typeof setTimeout> | null = null;
  const publish = (next: Partial<PwaUpdateSnapshot>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const removeReceipt = () => { try { ports.storage?.removeItem(PWA_UPDATE_RECEIPT_KEY); } catch { /* Site storage can be blocked. */ } };
  const clearRestart = () => {
    restartCleanup?.(); restartCleanup = null;
    if (restartTimer !== null) clearTimeout(restartTimer);
    restartTimer = null;
  };
  const failRestart = (failure: PwaUpdateFailure = "restart") => {
    clearRestart(); removeReceipt();
    publish({ phase: "failed", failure, notice: true });
  };

  // Consumed once per document. A controllerchange is not proof that the page's
  // JavaScript changed; only the entry loaded by the next document proves that.
  try {
    const raw = ports.storage?.getItem(PWA_UPDATE_RECEIPT_KEY);
    removeReceipt();
    if (raw) {
      const receipt = JSON.parse(raw);
      if (typeof receipt.from === "string" && typeof receipt.at === "number" &&
        Date.now() - receipt.at >= 0 && Date.now() - receipt.at < 10 * 60_000 && ports.entry) {
        const changed = ports.entry !== receipt.from && (!receipt.target || ports.entry === receipt.target);
        state = { ...state, phase: changed ? (receipt.quiet ? "current" : "updated") : "failed",
          available: !changed, failure: changed ? null : "unchanged", notice: !changed || !receipt.quiet };
      }
    }
  } catch { /* An unusable receipt must never claim success or prevent startup. */ }

  const dismissSuccess = () => {
    if (successTimer !== null) clearTimeout(successTimer);
    successTimer = null;
    if (state.phase === "updated") publish({ phase: "current", notice: false });
  };
  const successDeadline = Date.now() + PWA_UPDATE_SUCCESS_MS;
  const scheduleSuccess = () => { successTimer = setTimeout(dismissSuccess, Math.max(0, successDeadline - Date.now())); };
  if (state.phase === "updated") scheduleSuccess();

  function announce(registration: ServiceWorkerRegistration) {
    if (state.phase === "updating") return;
    dismissSuccess();
    publish({ phase: "ready", available: true, registration, failure: null });
  }

  function check(manual = true): Promise<void> {
    if (checkInFlight) return checkInFlight;
    if (state.phase === "updating") return Promise.resolve();
    const generation = ++operation, previous = state;
    const controller = new AbortController();
    if (manual || state.phase === "idle") publish({ phase: "checking", failure: null });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      abortCheck = () => { controller.abort(); reject(new Error("PWA_CHECK_ENDED")); };
      timer = setTimeout(abortCheck, PWA_UPDATE_TIMEOUT_MS);
    });
    const task = Promise.race([ports.check(controller.signal), timeout]).then(result => {
      if (generation !== operation) return;
      const available = state.available || result.entry !== ports.entry || result.waiting;
      publish({ phase: state.phase === "updated" ? "updated" : available ? "ready" : "current", available,
        registration: result.registration ?? state.registration,
        targetEntry: result.entry !== ports.entry ? result.entry : state.targetEntry, failure: null });
    }).catch(() => {
      if (generation !== operation) return;
      if (manual) publish({ phase: "failed", failure: "check" });
      else if (state.phase === "checking") publish({ ...previous, phase: previous.phase === "idle" ? "idle" : previous.phase });
    }).finally(() => {
      clearTimeout(timer);
      if (checkInFlight === task) { abortCheck = null; checkInFlight = null; }
    });
    checkInFlight = task;
    return checkInFlight;
  }

  function apply({ confirmedCall = null, quiet = false }: { confirmedCall?: CallConfirmation; quiet?: boolean } = {}) {
    if (!state.available || state.phase === "updating" || state.phase === "checking") return;
    const refused = ports.guard(confirmedCall);
    if (refused) { publish({ phase: "failed", failure: refused, notice: !quiet }); return; }
    ++operation;
    abortCheck?.();
    publish({ phase: "updating", failure: null, notice: !quiet });
    restartTimer = setTimeout(() => failRestart(), PWA_UPDATE_TIMEOUT_MS);
    try {
      restartCleanup = ports.restart(state.registration, {
        beforeReload: () => {
          const lateRefusal = ports.guard(confirmedCall);
          if (lateRefusal) { failRestart(lateRefusal); return false; }
          try { ports.storage?.setItem(PWA_UPDATE_RECEIPT_KEY, JSON.stringify({ from: ports.entry, target: state.targetEntry, at: Date.now(), quiet })); }
          catch { /* Reload remains possible, but success cannot be asserted next boot. */ }
          ports.beforeRestart();
          return true;
        },
        onFailure: () => failRestart(),
      });
    } catch { failRestart(); }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (state.phase === "updated" && successTimer === null) scheduleSuccess();
      return () => { listeners.delete(listener); };
    },
    announce, check, apply,
    dispose() {
      ++operation; abortCheck?.(); clearRestart();
      abortCheck = null; checkInFlight = null;
      if (successTimer !== null) clearTimeout(successTimer);
      successTimer = null;
    },
  };
}
