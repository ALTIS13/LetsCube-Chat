export const DESKTOP_UPDATE_CHANNELS = ["stable", "test"] as const;
export const DESKTOP_UPDATE_PHASES = [
  "idle",
  "checking",
  "current",
  "available",
  "critical_update_required",
  "downloading",
  "installing",
  "failed",
] as const;

export type DesktopUpdateChannel = (typeof DESKTOP_UPDATE_CHANNELS)[number];
export type DesktopUpdatePhase = (typeof DESKTOP_UPDATE_PHASES)[number];

export type DesktopUpdateSnapshot = {
  channel: DesktopUpdateChannel;
  phase: DesktopUpdatePhase;
  installedVersion: string;
  availableVersion: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  mandatory: boolean;
  errorCode: string | null;
};

export type DesktopUpdatePresentation = {
  title: string;
  description: string;
  action: "check" | "install" | null;
  blocking: boolean;
  persistent: boolean;
  progress: number | null;
};

import { getDesktopBridge } from "./desktop.ts";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const UPDATE_PHASE_SET = new Set<string>(DESKTOP_UPDATE_PHASES);
const UPDATE_CHANNEL_SET = new Set<string>(DESKTOP_UPDATE_CHANNELS);
const VERSION_REQUIRED_PHASES = new Set<DesktopUpdatePhase>([
  "available",
  "critical_update_required",
  "downloading",
  "installing",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSemVer(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && SEMVER_PATTERN.test(value);
}

function isByteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseDesktopUpdateSnapshot(value: unknown): DesktopUpdateSnapshot | null {
  if (!isRecord(value)) return null;

  const {
    channel,
    phase,
    installedVersion,
    availableVersion,
    downloadedBytes,
    totalBytes,
    mandatory,
    errorCode,
  } = value;
  if (typeof channel !== "string" || !UPDATE_CHANNEL_SET.has(channel)) return null;
  if (typeof phase !== "string" || !UPDATE_PHASE_SET.has(phase)) return null;
  if (!isSemVer(installedVersion)) return null;
  if (availableVersion !== null && !isSemVer(availableVersion)) return null;
  if (!isByteCount(downloadedBytes)) return null;
  if (totalBytes !== null && !isByteCount(totalBytes)) return null;
  if (totalBytes !== null && downloadedBytes > totalBytes) return null;
  if (typeof mandatory !== "boolean") return null;
  if (errorCode !== null && (typeof errorCode !== "string" || errorCode.length > 96)) return null;

  const typedChannel = channel as DesktopUpdateChannel;
  const typedPhase = phase as DesktopUpdatePhase;
  if (VERSION_REQUIRED_PHASES.has(typedPhase) !== (availableVersion !== null)) return null;
  const critical = typedPhase === "critical_update_required";
  if (mandatory !== critical || (critical && typedChannel !== "stable")) {
    return null;
  }

  return {
    channel: typedChannel,
    phase: typedPhase,
    installedVersion,
    availableVersion,
    downloadedBytes,
    totalBytes,
    mandatory,
    errorCode,
  };
}

export function getDesktopUpdatePresentation(
  state: DesktopUpdateSnapshot,
): DesktopUpdatePresentation {
  const version = state.availableVersion ? ` ${state.availableVersion}` : "";
  const progress = state.phase === "downloading" && state.totalBytes && state.totalBytes > 0
    ? Math.min(100, Math.round((state.downloadedBytes / state.totalBytes) * 100))
    : null;

  switch (state.phase) {
    case "idle":
      return presentation("Проверка обновлений", "Можно проверить новую версию", "check", false);
    case "checking":
      return presentation("Проверяем версию", "Сверяем доступную стабильную сборку", null, true);
    case "current":
      return state.channel === "test"
        ? presentation("Тестовый канал", `Установлена версия ${state.installedVersion}`, "check", true)
        : presentation("LETSCUBE обновлён", `Установлена версия ${state.installedVersion}`, "check", false);
    case "available":
      return presentation(`Доступна версия${version}`, "Установите её, когда будет удобно", "install", true);
    case "critical_update_required":
      return {
        ...presentation("Требуется важное обновление", `Для продолжения установите LETSCUBE${version}`, "install", true),
        blocking: true,
      };
    case "downloading":
      return {
        ...presentation("Загружаем обновление", progress === null ? "Получаем проверенный пакет" : `Загружено ${progress}%`, null, true),
        progress,
      };
    case "installing":
      return presentation("Устанавливаем обновление", "LETSCUBE перезапустится после проверки пакета", null, true);
    case "failed":
      return presentation("Не удалось обновить", "Проверьте подключение и повторите попытку", "check", true);
  }
}

export function createDesktopUpdateFailureSnapshot(
  installedVersion: unknown,
  channel: DesktopUpdateChannel = "stable",
): DesktopUpdateSnapshot {
  return {
    channel,
    phase: "failed",
    installedVersion: isSemVer(installedVersion) ? installedVersion : "0.0.0",
    availableVersion: null,
    downloadedBytes: 0,
    totalBytes: null,
    mandatory: false,
    errorCode: "desktop_update_unavailable",
  };
}

type QueuedCommand = {
  key: string;
  start: () => void;
};

const commandQueue: QueuedCommand[] = [];
const commandsInFlight = new Map<string, Promise<DesktopUpdateSnapshot | null>>();
let commandRunning = false;

export async function readDesktopUpdateSnapshot(): Promise<DesktopUpdateSnapshot | null> {
  const bridge = getDesktopBridge();
  if (!bridge) return null;
  try {
    const snapshot = parseDesktopUpdateSnapshot(await bridge.getUpdateState());
    if (!snapshot) throw new Error("desktop_update_state_invalid");
    return snapshot;
  } catch (error) {
    if (error instanceof Error && error.message === "desktop_update_state_invalid") throw error;
    throw new Error("desktop_update_state_failed");
  }
}

export function checkDesktopUpdate(): Promise<DesktopUpdateSnapshot | null> {
  return runDesktopCommand("check", "desktop_update_check_failed", (bridge) => bridge.checkUpdate());
}

export function installDesktopUpdate(): Promise<DesktopUpdateSnapshot | null> {
  return runDesktopCommand("install", "desktop_update_install_failed", (bridge) => bridge.installUpdate());
}

export function setDesktopUpdateChannel(
  channel: DesktopUpdateChannel,
): Promise<DesktopUpdateSnapshot | null> {
  if (!UPDATE_CHANNEL_SET.has(channel)) {
    return Promise.reject(new Error("desktop_update_channel_invalid"));
  }
  return runDesktopCommand(
    `channel:${channel}`,
    "desktop_update_channel_failed",
    (bridge) => bridge.setUpdateChannel(channel),
  );
}

function runDesktopCommand(
  key: string,
  errorCode: string,
  execute: (bridge: NonNullable<Window["letscubeDesktop"]>) => Promise<unknown>,
): Promise<DesktopUpdateSnapshot | null> {
  const bridge = getDesktopBridge();
  if (!bridge) return Promise.resolve(null);
  const matching = commandsInFlight.get(key);
  if (matching) return matching;

  let resolveCommand!: (value: DesktopUpdateSnapshot | null) => void;
  let rejectCommand!: (reason: Error) => void;
  const operation = new Promise<DesktopUpdateSnapshot | null>((resolve, reject) => {
    resolveCommand = resolve;
    rejectCommand = reject;
  });
  commandsInFlight.set(key, operation);

  const finish = () => {
    if (commandsInFlight.get(key) === operation) commandsInFlight.delete(key);
    commandRunning = false;
    commandQueue.shift()?.start();
  };
  commandQueue.push({
    key,
    start: () => {
      commandRunning = true;
      let nativeResult: Promise<unknown>;
      try {
        nativeResult = execute(bridge);
      } catch {
        rejectCommand(new Error(errorCode));
        finish();
        return;
      }
      nativeResult.then(
        (value) => {
          const snapshot = parseDesktopUpdateSnapshot(value);
          if (snapshot) resolveCommand(snapshot);
          else rejectCommand(new Error(errorCode));
          finish();
        },
        () => {
          rejectCommand(new Error(errorCode));
          finish();
        },
      );
    },
  });
  if (!commandRunning) commandQueue.shift()?.start();
  return operation;
}

export type DesktopUpdateStoreSnapshot = Readonly<{
  snapshot: DesktopUpdateSnapshot | null;
  commandPending: boolean;
}>;

type DesktopUpdateStoreDependencies = {
  isActive: () => boolean;
  installedVersion: () => unknown;
  read: () => Promise<unknown>;
  check: () => Promise<unknown>;
  install: () => Promise<unknown>;
  setChannel: (channel: DesktopUpdateChannel) => Promise<unknown>;
  reportError?: (error: Error, operation: string) => void;
  now?: () => number;
  scheduleInterval?: (callback: () => void, milliseconds: number) => unknown;
  cancelInterval?: (token: unknown) => void;
  scheduleTimeout?: (callback: () => void, milliseconds: number) => unknown;
  cancelTimeout?: (token: unknown) => void;
  subscribeFocus?: (callback: () => void) => () => void;
};

const ACTIVE_POLL_INTERVAL_MS = 250;
const IDLE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const ACTIVE_PHASES = new Set<DesktopUpdatePhase>(["checking", "downloading", "installing"]);

export function createDesktopUpdateStore(dependencies: DesktopUpdateStoreDependencies) {
  const listeners = new Set<() => void>();
  const now = dependencies.now ?? Date.now;
  const scheduleInterval = dependencies.scheduleInterval
    ?? ((callback: () => void, milliseconds: number) => globalThis.setInterval(callback, milliseconds));
  const cancelInterval = dependencies.cancelInterval
    ?? ((token: unknown) => globalThis.clearInterval(token as ReturnType<typeof setInterval>));
  const scheduleTimeout = dependencies.scheduleTimeout
    ?? ((callback: () => void, milliseconds: number) => globalThis.setTimeout(callback, milliseconds));
  const cancelTimeout = dependencies.cancelTimeout
    ?? ((token: unknown) => globalThis.clearTimeout(token as ReturnType<typeof setTimeout>));
  const subscribeFocus = dependencies.subscribeFocus ?? ((callback: () => void) => {
    if (typeof window === "undefined") return () => undefined;
    window.addEventListener("focus", callback);
    return () => window.removeEventListener("focus", callback);
  });

  let view: DesktopUpdateStoreSnapshot = Object.freeze({ snapshot: null, commandPending: false });
  let refreshInFlight: Promise<DesktopUpdateSnapshot | null> | null = null;
  let activePollToken: unknown = null;
  let idleCheckToken: unknown = null;
  let removeFocusListener: (() => void) | null = null;
  let consumers = 0;
  let pendingCommands = 0;
  let lastAutomaticCheckAt = 0;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const clearActivePoll = () => {
    if (activePollToken === null) return;
    cancelInterval(activePollToken);
    activePollToken = null;
  };

  const clearIdleCheck = () => {
    if (idleCheckToken === null) return;
    cancelTimeout(idleCheckToken);
    idleCheckToken = null;
  };

  const syncSchedules = () => {
    const phase = view.snapshot?.phase;
    if (consumers === 0 || !dependencies.isActive()) {
      clearActivePoll();
      clearIdleCheck();
      return;
    }
    if (phase && ACTIVE_PHASES.has(phase)) {
      clearIdleCheck();
      if (activePollToken === null) {
        activePollToken = scheduleInterval(() => void refresh("active_poll"), ACTIVE_POLL_INTERVAL_MS);
      }
      return;
    }
    clearActivePoll();
    if (phase === "idle" || phase === "current") {
      if (idleCheckToken === null) {
        const remaining = Math.max(1_000, IDLE_CHECK_INTERVAL_MS - (now() - lastAutomaticCheckAt));
        idleCheckToken = scheduleTimeout(() => {
          idleCheckToken = null;
          void check();
        }, remaining);
      }
      return;
    }
    clearIdleCheck();
  };

  const publish = (snapshot: DesktopUpdateSnapshot | null, commandPending = pendingCommands > 0) => {
    if (view.snapshot === snapshot && view.commandPending === commandPending) return;
    view = Object.freeze({ snapshot, commandPending });
    syncSchedules();
    emit();
  };

  const accept = (value: unknown) => {
    const parsed = parseDesktopUpdateSnapshot(value);
    if (!parsed) throw new Error("desktop_update_response_invalid");
    publish(parsed);
    return parsed;
  };

  const fail = (error: unknown, operation: string) => {
    const safeError = error instanceof Error && /^desktop_update_[a-z_]+$/.test(error.message)
      ? new Error(error.message)
      : new Error("desktop_update_operation_failed");
    dependencies.reportError?.(safeError, operation);
    const fallback = createDesktopUpdateFailureSnapshot(
      dependencies.installedVersion(),
      view.snapshot?.channel ?? "stable",
    );
    publish(fallback);
    return fallback;
  };

  const refresh = (operation = "state") => {
    if (!dependencies.isActive()) return Promise.resolve(null);
    if (refreshInFlight) return refreshInFlight;
    const current = Promise.resolve()
      .then(() => dependencies.read())
      .then(accept)
      .catch((error) => fail(error, operation));
    refreshInFlight = current;
    void current.then(
      () => {
        if (refreshInFlight === current) refreshInFlight = null;
      },
      () => {
        if (refreshInFlight === current) refreshInFlight = null;
      },
    );
    return current;
  };

  const run = async (operation: string, command: () => Promise<unknown>) => {
    if (!dependencies.isActive()) return null;
    pendingCommands += 1;
    publish(view.snapshot, true);
    try {
      return accept(await command());
    } catch (error) {
      return fail(error, operation);
    } finally {
      pendingCommands = Math.max(0, pendingCommands - 1);
      publish(view.snapshot, pendingCommands > 0);
    }
  };

  const runCheckCommand = async () => {
    clearIdleCheck();
    const result = await dependencies.check();
    lastAutomaticCheckAt = now();
    return result;
  };

  const check = () => run("check", runCheckCommand);

  const install = () => run("install", dependencies.install);

  const setChannel = (channel: DesktopUpdateChannel) => run("channel", async () => {
    accept(await dependencies.setChannel(channel));
    return runCheckCommand();
  });

  const handleFocus = async () => {
    const current = await refresh("focus");
    if (
      current
      && (current.phase === "idle" || current.phase === "current")
      && now() - lastAutomaticCheckAt >= IDLE_CHECK_INTERVAL_MS
    ) {
      await check();
    }
  };

  const acquire = () => {
    consumers += 1;
    if (consumers === 1 && dependencies.isActive()) {
      removeFocusListener = subscribeFocus(() => void handleFocus());
      void refresh("initial").then((initial) => {
        if (initial?.phase === "idle" && now() - lastAutomaticCheckAt >= IDLE_CHECK_INTERVAL_MS) {
          void check();
        }
      });
    }
    syncSchedules();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      consumers = Math.max(0, consumers - 1);
      if (consumers === 0) {
        removeFocusListener?.();
        removeFocusListener = null;
      }
      syncSchedules();
    };
  };

  return Object.freeze({
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => view,
    getServerSnapshot: () => view,
    acquire,
    refresh,
    check,
    install,
    setChannel,
  });
}

function presentation(
  title: string,
  description: string,
  action: DesktopUpdatePresentation["action"],
  persistent: boolean,
): DesktopUpdatePresentation {
  return { title, description, action, blocking: false, persistent, progress: null };
}
