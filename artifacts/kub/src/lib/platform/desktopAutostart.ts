/**
 * The web half of the Windows autostart bridge: whether LETSCUBE starts when
 * the person signs in to Windows, and whether that launch opens a window or
 * waits in the tray.
 *
 * A closed application cannot ring for an incoming call and should not. The
 * answer is to let it be running, and Windows is the one shell here that can
 * both ring and retract the ring, so this setting is worth more on Windows than
 * it would be anywhere else. It exists on Windows and nowhere else, which is
 * why every reader below answers "unavailable" rather than "off" outside it —
 * the two are different facts and a control must never be drawn on the first.
 *
 * Everything the shell hands back is an untrusted payload and is parsed before
 * it reaches React, exactly as `desktopStorage.ts` does. The pure parts — the
 * parser, the error mapping, the two summaries and the rule about what the
 * second switch means while the first is off — import nothing the Node test
 * runner cannot resolve, so `tests/unit/desktop-autostart.test.mts` reaches
 * every branch of them directly.
 */

/** The codes the two autostart commands reject with. */
export const DESKTOP_AUTOSTART_ERROR_CODES = [
  "autostart_unavailable",
  "autostart_write_failed",
  "autostart_path_unsupported",
  "unauthorized",
] as const;

export type DesktopAutostartErrorCode = (typeof DESKTOP_AUTOSTART_ERROR_CODES)[number];

/** What a rejection collapses to when it carries anything we do not recognise. */
export const DESKTOP_AUTOSTART_GENERIC_ERROR = "autostart_failed";

export type DesktopAutostartState = {
  /** Windows will start LETSCUBE at the next sign-in. */
  enabled: boolean;
  /** That launch carries the flag that keeps it in the tray. */
  startMinimized: boolean;
  /** A sign-in entry under our name exists, whatever it points at. */
  entryPresent: boolean;
  /** Its program is the executable that is running now. */
  entryMatchesInstall: boolean;
  /** The entry is there and Windows has switched it off in «Автозагрузка». */
  blockedByWindows: boolean;
};

export type DesktopAutostartRequest = {
  enabled: boolean;
  startMinimized: boolean;
};

import { getDesktopBridge } from "./desktop.ts";

const ERROR_CODE_SET = new Set<string>(DESKTOP_AUTOSTART_ERROR_CODES);

const ERROR_MESSAGES: Record<DesktopAutostartErrorCode, string> = {
  autostart_unavailable:
    "Не удалось прочитать автозапуск Windows. Перезапустите приложение",
  autostart_write_failed:
    "Windows не дал изменить автозапуск. Попробуйте ещё раз или измените его в «Диспетчере задач»",
  autostart_path_unsupported:
    "Не удалось определить путь к приложению. Переустановите LETSCUBE",
  unauthorized: "Действие недоступно в этом окне",
};

const GENERIC_ERROR_MESSAGE = "Не удалось изменить автозапуск. Попробуйте ещё раз";

export function isDesktopAutostartErrorCode(value: unknown): value is DesktopAutostartErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

/**
 * Reduces whatever a rejected bridge call carried to a known code.
 *
 * Tauri rejects with the bare `Err(&str)`, but a thrown `Error`, an object or a
 * string we have never seen are all equally possible, and any of them could
 * carry a filesystem path. Only the recognised vocabulary survives.
 */
export function toDesktopAutostartErrorCode(
  reason: unknown,
): DesktopAutostartErrorCode | typeof DESKTOP_AUTOSTART_GENERIC_ERROR {
  const raw = typeof reason === "string"
    ? reason
    : reason instanceof Error
      ? reason.message
      : "";
  return isDesktopAutostartErrorCode(raw) ? raw : DESKTOP_AUTOSTART_GENERIC_ERROR;
}

export function describeDesktopAutostartError(
  code: DesktopAutostartErrorCode | typeof DESKTOP_AUTOSTART_GENERIC_ERROR,
): string {
  return isDesktopAutostartErrorCode(code) ? ERROR_MESSAGES[code] : GENERIC_ERROR_MESSAGE;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * The shell's payload, or `null` when it is not one.
 *
 * `serde` writes the Rust struct as-is, so the wire is snake_case. Every field
 * is required: a partial answer is a shell that does not speak this protocol,
 * and guessing the missing halves would put a switch on screen over a state
 * nobody measured.
 */
export function parseDesktopAutostartState(payload: unknown): DesktopAutostartState | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const {
    enabled,
    start_minimized: startMinimized,
    entry_present: entryPresent,
    entry_matches_install: entryMatchesInstall,
    blocked_by_windows: blockedByWindows,
  } = record;

  if (
    !isBoolean(enabled)
    || !isBoolean(startMinimized)
    || !isBoolean(entryPresent)
    || !isBoolean(entryMatchesInstall)
    || !isBoolean(blockedByWindows)
  ) {
    return null;
  }

  return { enabled, startMinimized, entryPresent, entryMatchesInstall, blockedByWindows };
}

/**
 * Whether the running shell knows how to answer about autostart.
 *
 * The web application updates the moment it is deployed; the desktop shell
 * updates when somebody installs a new one. So there is always a window in
 * which a current page runs inside an older shell whose bridge has neither of
 * these methods. Without this check the call throws, every Windows user in that
 * window is told «не удалось», and the honest answer — that this shell cannot
 * do it yet — is never given. Absent means absent, exactly as in a browser: the
 * section renders nothing.
 */
export function isDesktopAutostartAvailable(): boolean {
  const bridge = getDesktopBridge();
  if (!bridge) return false;
  const candidate = bridge as unknown as Record<string, unknown>;
  return (
    typeof candidate.getAutostart === "function"
    && typeof candidate.setAutostart === "function"
  );
}

async function requestDesktopAutostart(
  execute: (bridge: NonNullable<Window["letscubeDesktop"]>) => Promise<unknown>,
): Promise<DesktopAutostartState | null> {
  const bridge = getDesktopBridge();
  if (!bridge || !isDesktopAutostartAvailable()) return null;

  let payload: unknown;
  try {
    payload = await execute(bridge);
  } catch (reason) {
    throw new Error(toDesktopAutostartErrorCode(reason));
  }

  const state = parseDesktopAutostartState(payload);
  if (!state) throw new Error(DESKTOP_AUTOSTART_GENERIC_ERROR);
  return state;
}

export function readDesktopAutostartState(): Promise<DesktopAutostartState | null> {
  return requestDesktopAutostart((bridge) => bridge.getAutostart());
}

/**
 * Writes both choices at once and resolves with what the shell read back.
 *
 * One command rather than two switches with a command each: the pair is a
 * single registry value, and writing it in two steps would put a moment on the
 * disk in which the entry exists and the tray flag does not.
 */
export function setDesktopAutostart(
  request: DesktopAutostartRequest,
): Promise<DesktopAutostartState | null> {
  const normalized = normalizeAutostartRequest(request);
  return requestDesktopAutostart((bridge) => bridge.setAutostart(normalized));
}

/**
 * What the two switches mean together.
 *
 * "Start minimised" is a property of the sign-in launch and has no meaning
 * without one, so turning autostart off takes the tray flag with it rather than
 * leaving a switch that describes a launch that will not happen. Turning it
 * back on comes back plain, which is the cautious direction: a person who is
 * re-enabling autostart gets a window, and has to ask for the tray again.
 */
export function normalizeAutostartRequest(
  request: DesktopAutostartRequest,
): DesktopAutostartRequest {
  return {
    enabled: request.enabled === true,
    startMinimized: request.enabled === true && request.startMinimized === true,
  };
}

/**
 * The line under «Запуск с Windows».
 *
 * `null` is "the shell has not answered yet" and says so; it is not folded into
 * "off", because a switch that reads off before anything was measured is the
 * lie this whole module exists to avoid.
 */
export function describeAutostartState(state: DesktopAutostartState | null): string {
  if (!state) return "Читаем настройки Windows";
  if (state.blockedByWindows) return "Отключено в «Автозагрузке» Windows";
  if (!state.enabled) return "LETSCUBE не запускается при входе в Windows";
  if (!state.entryMatchesInstall) {
    return "Запись автозапуска ведёт к другой копии LETSCUBE";
  }
  return state.startMinimized
    ? "Запускается при входе в Windows, сразу в трей"
    : "Запускается при входе в Windows";
}

/**
 * The note shown under the switches when the registry disagrees with what the
 * application last wrote, or `null` when there is nothing to explain.
 *
 * Both cases are ordinary rather than exotic: «Автозагрузка» in the Windows
 * task manager switches an entry off without removing it, and reinstalling or
 * moving LETSCUBE leaves the old entry pointing at a file that is no longer
 * there.
 */
export function describeAutostartDisagreement(
  state: DesktopAutostartState | null,
): string | null {
  if (!state) return null;
  if (state.blockedByWindows) {
    return "Windows отключил автозапуск LETSCUBE в разделе «Автозагрузка» диспетчера задач. Включите переключатель ещё раз, чтобы разрешить его снова.";
  }
  if (state.enabled && !state.entryMatchesInstall) {
    return "Запись в автозапуске ведёт к другому файлу LETSCUBE — так бывает после переустановки или переноса приложения. Включите переключатель ещё раз, чтобы он указывал на текущую версию.";
  }
  return null;
}

/**
 * Whether the second switch may be touched.
 *
 * Off when autostart is off, because there is no launch for it to describe,
 * and off while a write is in flight. Deliberately expressed here rather than
 * inline in the component: it is the rule the two switches share, and a rule
 * inside a `"use client"` module is a rule with no test.
 */
export function isStartMinimizedSwitchEnabled(
  state: DesktopAutostartState | null,
  commandPending: boolean,
): boolean {
  return Boolean(state?.enabled) && !commandPending;
}

/**
 * Whether the second switch is drawn as on.
 *
 * Not the same question as what the registry literally says. An entry Windows
 * has switched off in «Автозагрузка» keeps its `--start-minimized` word, and
 * reading that word straight onto the switch drew it **on** directly above the
 * line «Доступно, когда включён запуск вместе с Windows» — measured in
 * `output/autostart/autostart-1440-light-blocked.png` on the first pass, and
 * the reason this function exists rather than a `state.startMinimized` in the
 * component. The flag describes a launch, so with no launch it is off, which is
 * also exactly what `normalizeAutostartRequest` would write.
 */
export function isStartMinimizedSwitchOn(state: DesktopAutostartState | null): boolean {
  return Boolean(state?.enabled && state.startMinimized);
}
