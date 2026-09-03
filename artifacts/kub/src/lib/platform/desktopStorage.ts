/**
 * The web half of the desktop storage bridge: where the WebView2 profile lives,
 * how much of it is cache, and the two settings the person can change.
 *
 * Everything the shell hands back is treated as an untrusted payload and parsed
 * before it reaches React, exactly as `desktopUpdates.ts` does. The pure parts —
 * the parser, the formatter, the error mapping and the limit ladder — import
 * nothing the Node test runner cannot resolve, so they are covered directly by
 * `tests/unit/desktop-storage.test.mts`.
 */

/** The error codes `setStorageLocation` and the other commands reject with. */
export const DESKTOP_STORAGE_ERROR_CODES = [
  "not_absolute",
  "not_a_directory",
  "not_writable",
  "inside_current_profile",
  "system_directory",
  "storage_unavailable",
  "storage_write_failed",
  "unauthorized",
] as const;

export type DesktopStorageErrorCode = (typeof DESKTOP_STORAGE_ERROR_CODES)[number];

/** What a rejection collapses to when it carries anything we do not recognise. */
export const DESKTOP_STORAGE_GENERIC_ERROR = "desktop_storage_failed";

export type DesktopStorageState = {
  /** Absolute path of the profile that is in use right now. */
  location: string;
  isDefaultLocation: boolean;
  /** The whole profile, cache included. */
  totalBytes: number;
  /** The part of it that can be downloaded again. */
  cacheBytes: number;
  cacheLimitBytes: number;
  minCacheLimitBytes: number;
  maxCacheLimitBytes: number;
  /** A move recorded for the next launch, or `null` when none is pending. */
  pendingLocation: string | null;
};

import { getDesktopBridge } from "./desktop.ts";

const ERROR_CODE_SET = new Set<string>(DESKTOP_STORAGE_ERROR_CODES);

// Long enough for a `\\?\`-prefixed Windows path, still bounded: an unbounded
// string from the bridge would end up rendered into the settings panel.
const MAX_LOCATION_LENGTH = 4_096;

const ERROR_MESSAGES: Record<DesktopStorageErrorCode, string> = {
  not_absolute: "Укажите полный путь к папке — например, D:\\LETSCUBE",
  not_a_directory: "По этому пути находится файл, а не папка",
  not_writable: "В эту папку не удалось записать. Выберите другую или проверьте права доступа",
  inside_current_profile: "Нельзя выбрать папку внутри текущего хранилища",
  system_directory: "Системные папки Windows использовать нельзя",
  storage_unavailable: "Не удалось прочитать хранилище. Перезапустите приложение",
  storage_write_failed: "Не удалось сохранить настройку. Попробуйте ещё раз",
  unauthorized: "Действие недоступно в этом окне",
};

const GENERIC_ERROR_MESSAGE = "Не удалось выполнить действие. Попробуйте ещё раз";

const BYTE_UNITS = ["Б", "КБ", "МБ", "ГБ", "ТБ"] as const;
const BYTES_PER_UNIT = 1024;

// Binary steps, because the shell's own minimum and maximum are binary
// (128 MiB and 20 GiB). A decimal ladder would render the maximum as "21,5 ГБ".
const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

/**
 * The offered cache sizes, before they are bounded by what the shell reports.
 * Kept here rather than in the component so the same list can be asserted.
 */
const CACHE_LIMIT_LADDER = [
  128 * MEBIBYTE,
  512 * MEBIBYTE,
  1 * GIBIBYTE,
  2 * GIBIBYTE,
  5 * GIBIBYTE,
  10 * GIBIBYTE,
  20 * GIBIBYTE,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isByteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isLocationPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_LOCATION_LENGTH;
}

export function isDesktopStorageErrorCode(value: unknown): value is DesktopStorageErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

/**
 * Reduces whatever a rejected bridge call carried to a known code.
 *
 * Tauri rejects with the bare `Err(String)`, but a thrown `Error`, an object or
 * a string we have never seen are all equally possible, and any of them could
 * carry a path or an internal detail. Only the recognised vocabulary survives.
 */
export function toDesktopStorageErrorCode(
  reason: unknown,
): DesktopStorageErrorCode | typeof DESKTOP_STORAGE_GENERIC_ERROR {
  const raw = typeof reason === "string"
    ? reason
    : reason instanceof Error
      ? reason.message
      : "";
  return isDesktopStorageErrorCode(raw) ? raw : DESKTOP_STORAGE_GENERIC_ERROR;
}

/** The sentence shown to the person for a code. Never renders the code itself. */
export function describeDesktopStorageError(code: unknown): string {
  return isDesktopStorageErrorCode(code) ? ERROR_MESSAGES[code] : GENERIC_ERROR_MESSAGE;
}

/**
 * Human byte sizes in Russian.
 *
 * Anything that is not a real, non-negative number renders as `0 Б` rather than
 * `NaN Б`: this feeds a settings row, and a broken number there is worse than a
 * conservative one.
 */
export function formatStorageBytes(bytes: unknown): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0 Б";

  let value = bytes;
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit += 1;
  }
  // 1 048 575 B is 1023.999… KB, which rounds to "1024 КБ" — a unit that should
  // have carried. Round first, then carry if rounding pushed it over.
  if (unit < BYTE_UNITS.length - 1 && Math.round(value * 10) / 10 >= BYTES_PER_UNIT) {
    value /= BYTES_PER_UNIT;
    unit += 1;
  }

  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
  return `${formatted} ${BYTE_UNITS[unit]}`;
}

export function parseDesktopStorageState(value: unknown): DesktopStorageState | null {
  if (!isRecord(value)) return null;

  // The shell serialises the Rust struct field names as-is, so the wire is
  // snake_case and this is the one place that knows it.
  const {
    location,
    is_default_location: isDefaultLocation,
    total_bytes: totalBytes,
    cache_bytes: cacheBytes,
    cache_limit_bytes: cacheLimitBytes,
    min_cache_limit_bytes: minCacheLimitBytes,
    max_cache_limit_bytes: maxCacheLimitBytes,
    pending_location: pendingLocation,
  } = value;

  if (!isLocationPath(location)) return null;
  if (typeof isDefaultLocation !== "boolean") return null;
  if (!isByteCount(totalBytes) || !isByteCount(cacheBytes)) return null;
  if (!isByteCount(cacheLimitBytes)) return null;
  if (!isByteCount(minCacheLimitBytes) || !isByteCount(maxCacheLimitBytes)) return null;
  if (pendingLocation !== null && !isLocationPath(pendingLocation)) return null;

  // Cache is a subset of the profile, so it can never exceed it.
  if (cacheBytes > totalBytes) return null;
  // The limit selector relies on these: without them the radio group could end
  // up with no checked option, or with a range it cannot render.
  if (minCacheLimitBytes > maxCacheLimitBytes) return null;
  if (cacheLimitBytes < minCacheLimitBytes || cacheLimitBytes > maxCacheLimitBytes) return null;

  return {
    location,
    isDefaultLocation,
    totalBytes,
    cacheBytes,
    cacheLimitBytes,
    minCacheLimitBytes,
    maxCacheLimitBytes,
    pendingLocation,
  };
}

/**
 * The cache sizes to offer for a given state.
 *
 * The shell owns the bounds, so the ladder is filtered by them rather than
 * hard-coded against today's values, and the currently stored limit is always
 * included — otherwise a limit written by an older build would leave the group
 * with nothing checked.
 */
export function getCacheLimitOptions(state: DesktopStorageState): number[] {
  const options = new Set<number>([
    state.minCacheLimitBytes,
    state.maxCacheLimitBytes,
    state.cacheLimitBytes,
  ]);
  for (const step of CACHE_LIMIT_LADDER) {
    if (step > state.minCacheLimitBytes && step < state.maxCacheLimitBytes) options.add(step);
  }
  return [...options].sort((first, second) => first - second);
}

/**
 * Whether a typed path is absolute the way `Path::is_absolute` means on Windows.
 *
 * There is no native folder picker behind this bridge — the person types or
 * pastes a path — so the obvious mistake (`Загрузки`, `.\data`) is caught here
 * instead of after a round trip. It matches the shell's own rule, so it can only
 * reject what the shell would reject with `not_absolute` anyway.
 */
export function isAbsoluteWindowsPath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LOCATION_LENGTH) return false;
  // A drive letter with a separator, or a UNC/verbatim prefix with two segments.
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/.test(trimmed);
}

async function requestDesktopStorage(
  execute: (bridge: NonNullable<Window["letscubeDesktop"]>) => Promise<unknown>,
): Promise<DesktopStorageState | null> {
  const bridge = getDesktopBridge();
  if (!bridge) return null;

  let payload: unknown;
  try {
    payload = await execute(bridge);
  } catch (reason) {
    throw new Error(toDesktopStorageErrorCode(reason));
  }

  const state = parseDesktopStorageState(payload);
  if (!state) throw new Error(DESKTOP_STORAGE_GENERIC_ERROR);
  return state;
}

export function readDesktopStorageState(): Promise<DesktopStorageState | null> {
  return requestDesktopStorage((bridge) => bridge.getStorageState());
}

export function setDesktopStorageLocation(
  location: string | null,
): Promise<DesktopStorageState | null> {
  if (location !== null && !isAbsoluteWindowsPath(location)) {
    return Promise.reject(new Error("not_absolute"));
  }
  const normalized = location === null ? null : location.trim();
  return requestDesktopStorage((bridge) => bridge.setStorageLocation(normalized));
}

export function setDesktopCacheLimit(bytes: number): Promise<DesktopStorageState | null> {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    return Promise.reject(new Error(DESKTOP_STORAGE_GENERIC_ERROR));
  }
  return requestDesktopStorage((bridge) => bridge.setCacheLimit(bytes));
}

export function clearDesktopCache(): Promise<DesktopStorageState | null> {
  return requestDesktopStorage((bridge) => bridge.clearCache());
}

export type DesktopStorageStoreSnapshot = Readonly<{
  state: DesktopStorageState | null;
  /** Already translated: the component never sees a code. */
  errorMessage: string | null;
  commandPending: boolean;
}>;

type DesktopStorageStoreDependencies = {
  isActive: () => boolean;
  read: () => Promise<DesktopStorageState | null>;
  setLocation: (location: string | null) => Promise<DesktopStorageState | null>;
  setCacheLimit: (bytes: number) => Promise<DesktopStorageState | null>;
  clearCache: () => Promise<DesktopStorageState | null>;
  reportError?: (error: Error, operation: string) => void;
};

/**
 * A small external store, in the shape `useDesktopUpdate` established.
 *
 * There is no polling here: nothing changes the profile behind the settings
 * panel's back, and the sizes are re-read after every command and on focus.
 */
export function createDesktopStorageStore(dependencies: DesktopStorageStoreDependencies) {
  const listeners = new Set<() => void>();
  const empty: DesktopStorageStoreSnapshot = Object.freeze({
    state: null,
    errorMessage: null,
    commandPending: false,
  });

  let view = empty;
  let refreshInFlight: Promise<DesktopStorageState | null> | null = null;
  let consumers = 0;
  let pendingCommands = 0;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const publish = (
    state: DesktopStorageState | null,
    errorMessage: string | null,
    commandPending = pendingCommands > 0,
  ) => {
    if (
      view.state === state
      && view.errorMessage === errorMessage
      && view.commandPending === commandPending
    ) {
      return;
    }
    view = Object.freeze({ state, errorMessage, commandPending });
    emit();
  };

  const accept = (state: DesktopStorageState | null) => {
    // `null` means the bridge is gone (browser build). Keep whatever is shown.
    if (state) publish(state, null);
    return state;
  };

  const fail = (error: unknown, operation: string) => {
    const code = toDesktopStorageErrorCode(error);
    dependencies.reportError?.(new Error(code), operation);
    // The failed command does not invalidate the sizes already on screen, so the
    // last good state stays and the message is added beside it.
    publish(view.state, describeDesktopStorageError(code));
    return null;
  };

  const refresh = (operation = "state") => {
    if (!dependencies.isActive()) return Promise.resolve(null);
    if (refreshInFlight) return refreshInFlight;
    const current = Promise.resolve()
      .then(() => dependencies.read())
      .then(accept)
      .catch((error) => fail(error, operation));
    refreshInFlight = current;
    void current.finally(() => {
      if (refreshInFlight === current) refreshInFlight = null;
    });
    return current;
  };

  const run = async (
    operation: string,
    command: () => Promise<DesktopStorageState | null>,
  ): Promise<DesktopStorageState | null> => {
    if (!dependencies.isActive()) return null;
    pendingCommands += 1;
    // Drop the previous message as the retry starts, so a stale one is never
    // read as the result of the command now running.
    publish(view.state, null, true);
    try {
      return accept(await command());
    } catch (error) {
      return fail(error, operation);
    } finally {
      pendingCommands = Math.max(0, pendingCommands - 1);
      publish(view.state, view.errorMessage, pendingCommands > 0);
    }
  };

  return Object.freeze({
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => view,
    getServerSnapshot: () => view,
    acquire() {
      consumers += 1;
      if (consumers === 1) void refresh("initial");
      let released = false;
      return () => {
        if (released) return;
        released = true;
        consumers = Math.max(0, consumers - 1);
      };
    },
    refresh,
    setLocation: (location: string | null) =>
      run("location", () => dependencies.setLocation(location)),
    setCacheLimit: (bytes: number) => run("cache_limit", () => dependencies.setCacheLimit(bytes)),
    clearCache: () => run("clear_cache", () => dependencies.clearCache()),
    /** Clears a message the person has read, without touching the state. */
    dismissError: () => publish(view.state, null),
  });
}
