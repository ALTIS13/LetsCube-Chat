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
 * Everything here is pure so `node --test` can reach it; the one import is
 * `plainMessages.ts`, which imports nothing either. None of it decides *what a
 * setting does* — only how the current value reads.
 */

import {
  PUSH_ROW_UNAVAILABLE_BROWSER,
  PUSH_ROW_UNAVAILABLE_DEVICE,
  PUSH_ROW_UNAVAILABLE_NOW,
} from "./plainMessages.ts";

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
      // D-132 (F2). «Android push через Firebase/FCM» named the delivery
      // network in the one line this row has for its value, to somebody who
      // cannot choose one. The row says whether they are available.
      if (platform.nativeAndroid) return PUSH_ROW_UNAVAILABLE_DEVICE;
      if (platform.desktopWindows) return "Системные уведомления, пока приложение запущено";
      return "Системные уведомления пока настроены только для Android";
    case "denied":
      if (platform.nativeAndroid) return "Заблокировано в настройках приложения Android";
      if (platform.desktopWindows) return "Заблокировано в настройках приложения Windows";
      return "Заблокировано в настройках браузера";
    // The same two build states the `usePush` messages used to spell out: a
    // missing signing key and a missing preference store (D-132, F2).
    case "missing_vapid":
      return PUSH_ROW_UNAVAILABLE_BROWSER;
    case "migration_missing":
      return PUSH_ROW_UNAVAILABLE_NOW;
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

/** The forward-origin row's value. */
export function forwardOriginSummary(visible: boolean): string {
  return visible ? "Показывается" : "Скрыто";
}

/**
 * The forward-origin row's second line.
 *
 * It carries a fact a switch cannot: the answer is written onto each copy at
 * the moment of forwarding, so this governs what happens next and reaches into
 * nothing already sent — in either direction. A person who turns it off and
 * then looks at yesterday's forward would otherwise read the unchanged name as
 * the setting not having worked.
 */
export function forwardOriginHint(visible: boolean): string | null {
  if (visible) return "Пересланные сообщения будут подписаны вашим именем";
  return "Новые пересылки пойдут без вашего имени. Отправленные раньше не изменятся";
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

/**
 * The heading each section is drawn under.
 *
 * These were five string literals inside the modal's JSX, which is why nothing
 * could search over them: the screen knew its own headings and no other module
 * did. They live here now, so the column's search and the rendered heading are
 * the same string rather than two that agree today.
 */
export const SETTINGS_SECTION_TITLES: Readonly<Record<SettingsSectionId, string>> = {
  profile: "Профиль",
  notifications: "Уведомления",
  privacy: "Конфиденциальность",
  application: "Приложение",
  service: "Сервис",
};

export type SettingsRowId =
  | "name"
  | "username"
  | "bio"
  | "phone"
  | "decoration"
  | "push"
  | "push-messages"
  | "push-tasks"
  | "push-invites"
  | "presence"
  | "forward-origin"
  | "blocked"
  | "devices"
  | "theme"
  | "message-text-size"
  | "audio"
  | "updates"
  | "admin";

export interface SettingsRowMeta {
  readonly id: SettingsRowId;
  readonly section: SettingsSectionId;
  /** Exactly the words the row prints on its left-hand side. */
  readonly label: string;
  /**
   * What a person might type instead of the label. Not decoration: «микрофон»
   * finds «Звук», «ник» finds «Никнейм» and «онлайн» finds «Статус «в сети»»,
   * none of which share a letter with the row they belong to.
   */
  readonly keywords: readonly string[];
}

/**
 * Every row the settings screen draws, in the order it draws them.
 *
 * This is the half `visibleSettingsSections` was missing. That function has
 * always known which *sections* exist; nothing knew which rows they contain, so
 * the screen could not be searched, only scrolled. The order here is the order
 * on screen, and the screen renders its rows against these ids — a row with no
 * entry here cannot be filtered, which is what `tests/e2e/settings-column.spec.ts`
 * checks by counting the rendered rows against this list.
 *
 * Values are deliberately NOT searchable. They come from hooks — the push
 * status, the resolved theme, the microphone's gain — and pulling them in here
 * would cost this module its "no imports" property, which is the thing that
 * lets `node --test` reach every branch of it.
 */
export const SETTINGS_ROWS: readonly SettingsRowMeta[] = [
  { id: "name", section: "profile", label: "Имя", keywords: ["фио", "полное имя", "как зовут", "name"] },
  { id: "username", section: "profile", label: "Никнейм", keywords: ["ник", "юзернейм", "username", "логин", "@"] },
  { id: "bio", section: "profile", label: "О себе", keywords: ["био", "bio", "описание", "обо мне"] },
  { id: "phone", section: "profile", label: "Телефон", keywords: ["номер", "phone", "смс", "sms", "подтверждение"] },
  { id: "decoration", section: "profile", label: "Оформление", keywords: ["рамка", "фон", "украшение", "аватар"] },
  { id: "push", section: "notifications", label: "Push-уведомления", keywords: ["пуш", "push", "оповещения"] },
  { id: "push-messages", section: "notifications", label: "Сообщения", keywords: ["пуш", "push", "чаты"] },
  { id: "push-tasks", section: "notifications", label: "Задачи", keywords: ["пуш", "push", "таски"] },
  { id: "push-invites", section: "notifications", label: "Приглашения", keywords: ["пуш", "push", "инвайты"] },
  { id: "presence", section: "privacy", label: "Статус «в сети»", keywords: ["онлайн", "presence", "последний вход", "видимость"] },
  // 2026-09-21. Somebody who wants this arrives with «пересылка», «переслал» or
  // «моё имя», not with the label — and one who arrives with «анонимно» is
  // asking for exactly this and must not be left to conclude we have nothing.
  { id: "forward-origin", section: "privacy", label: "Имя при пересылке", keywords: ["пересылка", "переслать", "переслал", "forward", "имя", "анонимно", "автор", "источник"] },
  // 2026-09-14. A block a person cannot find again is a trap, so the list of
  // people they have blocked has to be reachable by search as well as by
  // scrolling — and a row with no entry here cannot be filtered at all.
  { id: "blocked", section: "privacy", label: "Заблокированные", keywords: ["блок", "заблокировать", "чёрный список", "черный список", "block", "жалоба"] },
  // 2026-09-18, slice F of the call proposal. «Где я вошёл» is the question
  // somebody arrives with, and «звонки» is the one they arrive with after being
  // rung on a laptop in another room — both have to find this row, and neither
  // shares a letter with «Активные сеансы».
  { id: "devices", section: "privacy", label: "Активные сеансы", keywords: ["устройства", "устройство", "сеансы", "сессии", "вход", "звонки", "телефон", "компьютер", "devices", "sessions"] },
  { id: "theme", section: "application", label: "Тема", keywords: ["тёмная", "темная", "светлая", "dark", "light", "внешний вид", "оформление"] },
  // «мелко» and «крупно» are the words somebody arrives with — the tester of
  // 2026-09-20 wrote «мелко», not «размер текста» — and «шрифт» is what he
  // guessed the cause was. All three have to find this row (D-287).
  {
    id: "message-text-size",
    section: "application",
    label: "Размер текста сообщений",
    keywords: ["шрифт", "мелко", "мелкий", "крупно", "крупный", "больше", "текст", "размер", "font", "size", "читать", "зрение"],
  },
  // «чувствительность» since 2026-09-20, and it is not decoration either: it is the
  // word the owner used for the voice-activation threshold, and this row was
  // findable by «усиление» — the control that does **not** reach a call — and
  // not by the one that does. «рация» joins it for the same reason: it is what
  // the mode is called on the screen, and nothing else on this list spells it.
  {
    id: "audio",
    section: "application",
    label: "Звук",
    keywords: ["микрофон", "аудио", "голос", "громкость", "усиление", "чувствительность", "рация"],
  },
  { id: "updates", section: "application", label: "Обновления", keywords: ["версия", "update", "загрузка", "приложение"] },
  { id: "admin", section: "service", label: "Админ-панель", keywords: ["управление", "модерация", "баны", "мьюты", "пользователи"] },
];

/** Matches `searchLoadedMessages` in `lib/chatMessageSearch.ts`: one locale, one direction. */
function normalizeSettingsQuery(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU");
}

/**
 * The rows a query leaves standing, in screen order.
 *
 * An empty query leaves everything, which is what the screen looks like on
 * arrival. A query matches a row by its own label or one of its synonyms, and
 * it matches a *section* by that section's heading — typing «уведомления»
 * should give the whole notifications block rather than the one row whose label
 * happens to repeat the heading.
 */
export function matchSettingsRows(
  query: string,
  flags: { isStaff: boolean },
): readonly SettingsRowMeta[] {
  const sections = visibleSettingsSections(flags);
  const available = SETTINGS_ROWS.filter((row) => sections.includes(row.section));
  const needle = normalizeSettingsQuery(query);
  if (!needle) return available;
  return available.filter((row) => {
    if (normalizeSettingsQuery(row.label).includes(needle)) return true;
    if (normalizeSettingsQuery(SETTINGS_SECTION_TITLES[row.section]).includes(needle)) return true;
    return row.keywords.some((keyword) => normalizeSettingsQuery(keyword).includes(needle));
  });
}

/**
 * The same answer, shaped the way the column renders: which rows survive, and
 * which sections still have a row in them.
 *
 * The screen asks this once and reads both halves, so a section heading can
 * never be drawn over an empty block — the defect that would otherwise arrive
 * the first time a query matched a section title and nothing under it.
 */
export function settingsSearchResult(
  query: string,
  flags: { isStaff: boolean },
): { rows: ReadonlySet<SettingsRowId>; sections: readonly SettingsSectionId[]; total: number } {
  const matched = matchSettingsRows(query, flags);
  const rows = new Set<SettingsRowId>(matched.map((row) => row.id));
  const order = visibleSettingsSections(flags);
  const sections = order.filter((section) => matched.some((row) => row.section === section));
  return { rows, sections, total: matched.length };
}
