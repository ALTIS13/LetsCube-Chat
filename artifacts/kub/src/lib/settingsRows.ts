/**
 * What a settings row says on its right-hand side, and which rows exist at all.
 *
 * The settings screen used to spend a card, a section label and a paragraph on
 * each control, so the value a person came to read — which theme, which
 * microphone, whether push is on — was either implied by a control's position
 * or absent. These functions produce that value as a short string the row can
 * print beside its label, which is the whole reason the screen fits in one
 * scan now.
 *
 * Everything here is pure and free of imports so `node --test` can reach it.
 * None of it decides *what a setting does* — only how the current value reads.
 */

export type SettingsPushStatus =
  | "unsupported"
  | "native_unavailable"
  | "denied"
  | "missing_vapid"
  | "migration_missing"
  | "inactive"
  | "active";

export interface SettingsPlatform {
  nativeAndroid: boolean;
  desktopWindows: boolean;
}

export type SettingsTheme = "system" | "dark" | "light";
export type SettingsResolvedTheme = "dark" | "light";

export type SettingsAudioProcessingMode = "clean" | "raw" | "custom";

export interface SettingsAudioSummaryInput {
  processingMode: SettingsAudioProcessingMode;
  selectedInputDeviceId: string;
  micInputGain: number;
}

/** Shown where a person has not filled a value in. */
export const SETTINGS_EMPTY_VALUE = "—";

/** `DEFAULT_AUDIO_DEVICE_ID` from `hooks/useAudioSettings`, duplicated so this module keeps no imports. */
export const SETTINGS_DEFAULT_AUDIO_DEVICE_ID = "default";

/**
 * The push row's value.
 *
 * Same seven branches the modal used to inline as JSX, with one deliberate
 * copy change: `inactive` used to read "Получать уведомления, даже когда
 * вкладка закрыта", which describes what the button beside it does rather than
 * what the setting currently is. A row that prints its value says "Выключены".
 *
 * The Windows wording is pinned by `tests/unit/desktop-notification-adapter.test.mts`:
 * the desktop shell delivers notifications only while it is running, and the
 * copy must not promise more than that.
 */
export function pushStatusSummary(status: SettingsPushStatus, platform: SettingsPlatform): string {
  switch (status) {
    case "unsupported":
      return "Браузер не поддерживает";
    case "native_unavailable":
      if (platform.nativeAndroid) return "Android push через Firebase/FCM";
      if (platform.desktopWindows) return "Системные уведомления, пока приложение запущено";
      return "Системные уведомления пока настроены только для Android";
    case "denied":
      if (platform.nativeAndroid) return "Заблокировано в настройках приложения Android";
      if (platform.desktopWindows) return "Заблокировано в настройках приложения Windows";
      return "Заблокировано в настройках браузера";
    case "missing_vapid":
      return "Нужен VAPID public key в конфигурации";
    case "migration_missing":
      return "Нужно обновление базы данных";
    case "inactive":
      return "Выключены";
    case "active":
      return "Включены";
    default:
      return "Выключены";
  }
}

/**
 * Which button the push row offers, or none.
 *
 * `native_unavailable` is the interesting one: inside the Android shell it
 * means "the web push path is not the one you want" and enabling is still
 * possible, while in a browser on any other platform it means there is nothing
 * to enable. Collapsing the two hands a browser a button that cannot work.
 */
export function pushStatusAction(
  status: SettingsPushStatus,
  platform: Pick<SettingsPlatform, "nativeAndroid">,
): "enable" | "disable" | null {
  if (status === "active") return "disable";
  if (status === "inactive") return "enable";
  if (status === "native_unavailable" && platform.nativeAndroid) return "enable";
  return null;
}

/**
 * The theme row's value.
 *
 * "Системная" alone is not the value — it is the rule. What the person sees
 * right now is the resolved theme, so the system choice prints both.
 */
export function themeSummary(theme: SettingsTheme, resolved: SettingsResolvedTheme): string {
  if (theme === "dark") return "Тёмная";
  if (theme === "light") return "Светлая";
  return resolved === "dark" ? "Системная · тёмная" : "Системная · светлая";
}

/** The presence row's value. */
export function presenceSummary(visible: boolean): string {
  return visible ? "Виден" : "Скрыт";
}

/**
 * The presence row's second line, or nothing.
 *
 * On, the old paragraph only restated the label. Off, it carries a fact a
 * person cannot infer from a switch — the timestamp stops being stored, but
 * they remain findable — so that half stays and the redundant half goes.
 */
export function presenceHint(visible: boolean): string | null {
  if (visible) return null;
  return "Время последнего входа не сохраняется. Вас по-прежнему можно найти и написать вам";
}

/** A profile text field's value, or the empty marker. */
export function textValueSummary(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || SETTINGS_EMPTY_VALUE;
}

/** Below this share of the limit the character counter is noise, so it is not drawn. */
export const SETTINGS_COUNTER_REVEAL_RATIO = 0.8;

/**
 * Whether a field shows its character counter.
 *
 * It used to be permanent: "0/32" under an empty username tells a person
 * nothing they were about to need. It matters only as the limit approaches.
 */
export function shouldShowCounter(length: number, max: number): boolean {
  if (!Number.isFinite(length) || !Number.isFinite(max)) return false;
  if (max <= 0) return false;
  return length >= Math.ceil(max * SETTINGS_COUNTER_REVEAL_RATIO);
}

export function audioProcessingLabel(mode: SettingsAudioProcessingMode): string {
  if (mode === "clean") return "Чистый голос";
  if (mode === "raw") return "Без обработки";
  return "Настроено вручную";
}

/**
 * The audio row's value, read from stored settings alone.
 *
 * Device *names* would need `enumerateDevices()`, which asks the browser for
 * hardware and is exactly the work the collapsed row exists to avoid. So the
 * row says whether the choice is the system default or a specific device, and
 * the processing mode. Gain is appended only when it is not 1, because a
 * microphone quietly running at 40% is worth seeing without opening anything.
 */
export function audioSummary(settings: SettingsAudioSummaryInput): string {
  const device =
    settings.selectedInputDeviceId === SETTINGS_DEFAULT_AUDIO_DEVICE_ID
      ? "Системный микрофон"
      : "Выбранный микрофон";
  const parts = [device, audioProcessingLabel(settings.processingMode)];
  if (Number.isFinite(settings.micInputGain) && settings.micInputGain !== 1) {
    parts.push(`усиление ${formatGainPercent(settings.micInputGain)}`);
  }
  return parts.join(" · ");
}

/** Matches `formatAudioPercent` in `hooks/useAudioSettings`: clamped to 0..200%. */
function formatGainPercent(value: number): string {
  return `${Math.round(Math.min(2, Math.max(0, value)) * 100)}%`;
}

/**
 * The decoration row's value.
 *
 * Both keys are already on the current profile, so this costs no request —
 * which is why decoration gets a value inline and phone does not.
 */
export function decorationSummary(
  frame: string | null | undefined,
  background: string | null | undefined,
): string {
  const hasFrame = Boolean(frame);
  const hasBackground = Boolean(background);
  if (hasFrame && hasBackground) return "Рамка и фон";
  if (hasFrame) return "Рамка";
  if (hasBackground) return "Фон";
  return "Без оформления";
}

export type SettingsSectionId =
  | "profile"
  | "notifications"
  | "privacy"
  | "application"
  | "service";

const ALWAYS_VISIBLE_SECTIONS: readonly SettingsSectionId[] = [
  "profile",
  "notifications",
  "privacy",
  "application",
];

/**
 * The sections of the settings screen, in the order they are drawn.
 *
 * Order is part of the contract, not decoration. Profile comes first because
 * it is the thing a person recognises; notifications second, which is where
 * the four-tab version deliberately put them too; then privacy, then the
 * application-level preferences that are opened rarely.
 *
 * `service` is the staff-only administration entry and must never render for
 * anyone else. The modal draws its sections from this list so that rule lives
 * in one testable place instead of an `&&` in the middle of the markup.
 */
export function visibleSettingsSections(flags: { isStaff: boolean }): readonly SettingsSectionId[] {
  if (!flags.isStaff) return ALWAYS_VISIBLE_SECTIONS;
  return [...ALWAYS_VISIBLE_SECTIONS, "service"];
}
