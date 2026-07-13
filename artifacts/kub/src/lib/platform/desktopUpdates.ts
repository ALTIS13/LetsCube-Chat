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
  if (typedPhase === "critical_update_required" && (typedChannel !== "stable" || !mandatory)) {
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

export function createDesktopUpdateFailureSnapshot(installedVersion: unknown): DesktopUpdateSnapshot {
  return {
    channel: "stable",
    phase: "failed",
    installedVersion: isSemVer(installedVersion) ? installedVersion : "0.0.0",
    availableVersion: null,
    downloadedBytes: 0,
    totalBytes: null,
    mandatory: false,
    errorCode: "desktop_update_unavailable",
  };
}

let commandInFlight: Promise<DesktopUpdateSnapshot | null> | null = null;

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
  return runDesktopCommand("desktop_update_check_failed", (bridge) => bridge.checkUpdate());
}

export function installDesktopUpdate(): Promise<DesktopUpdateSnapshot | null> {
  return runDesktopCommand("desktop_update_install_failed", (bridge) => bridge.installUpdate());
}

export function setDesktopUpdateChannel(
  channel: DesktopUpdateChannel,
): Promise<DesktopUpdateSnapshot | null> {
  if (!UPDATE_CHANNEL_SET.has(channel)) {
    return Promise.reject(new Error("desktop_update_channel_invalid"));
  }
  return runDesktopCommand(
    "desktop_update_channel_failed",
    (bridge) => bridge.setUpdateChannel(channel),
  );
}

function runDesktopCommand(
  errorCode: string,
  execute: (bridge: NonNullable<Window["letscubeDesktop"]>) => Promise<unknown>,
): Promise<DesktopUpdateSnapshot | null> {
  const bridge = getDesktopBridge();
  if (!bridge) return Promise.resolve(null);
  if (commandInFlight) return commandInFlight;

  try {
    commandInFlight = execute(bridge)
      .then((value) => {
        const snapshot = parseDesktopUpdateSnapshot(value);
        if (!snapshot) throw new Error("desktop_update_response_invalid");
        return snapshot;
      })
      .catch(() => {
        throw new Error(errorCode);
      })
      .finally(() => {
        commandInFlight = null;
      });
  } catch {
    commandInFlight = Promise.reject(new Error(errorCode));
    void commandInFlight.catch(() => {
      commandInFlight = null;
    });
  }
  return commandInFlight;
}

function presentation(
  title: string,
  description: string,
  action: DesktopUpdatePresentation["action"],
  persistent: boolean,
): DesktopUpdatePresentation {
  return { title, description, action, blocking: false, persistent, progress: null };
}
