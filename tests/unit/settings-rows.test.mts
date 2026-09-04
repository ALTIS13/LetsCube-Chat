import assert from "node:assert/strict";
import test from "node:test";

import {
  SETTINGS_EMPTY_VALUE,
  audioProcessingLabel,
  audioSummary,
  decorationSummary,
  presenceHint,
  presenceSummary,
  pushStatusAction,
  pushStatusSummary,
  shouldShowCounter,
  textValueSummary,
  themeSummary,
  visibleSettingsSections,
} from "../../artifacts/kub/src/lib/settingsRows.ts";

/**
 * The settings screen is one column of rows, and each row's right-hand side is
 * produced here. These are the claims the column rests on: that a row prints
 * the value a person came to read, that it offers only the action that can
 * actually work on this platform, and that the staff entry is drawn for staff
 * alone.
 */

const BROWSER = { nativeAndroid: false, desktopWindows: false };
const ANDROID = { nativeAndroid: true, desktopWindows: false };
const WINDOWS = { nativeAndroid: false, desktopWindows: true };

test("the push row says what push is doing on this platform, not what it could do elsewhere", () => {
  // Windows delivers through the running shell only. The wording is pinned by
  // desktop-notification-adapter.test.mts for exactly that reason.
  assert.equal(
    pushStatusSummary("native_unavailable", WINDOWS),
    "Системные уведомления, пока приложение запущено",
  );
  assert.equal(pushStatusSummary("native_unavailable", ANDROID), "Android push через Firebase/FCM");
  assert.equal(
    pushStatusSummary("native_unavailable", BROWSER),
    "Системные уведомления пока настроены только для Android",
  );

  assert.equal(pushStatusSummary("denied", ANDROID), "Заблокировано в настройках приложения Android");
  assert.equal(pushStatusSummary("denied", WINDOWS), "Заблокировано в настройках приложения Windows");
  assert.equal(pushStatusSummary("denied", BROWSER), "Заблокировано в настройках браузера");

  assert.equal(pushStatusSummary("unsupported", BROWSER), "Браузер не поддерживает");
  assert.equal(pushStatusSummary("missing_vapid", BROWSER), "Нужен VAPID public key в конфигурации");
  assert.equal(pushStatusSummary("migration_missing", BROWSER), "Нужно обновление базы данных");
});

test("the push row prints a state, not an invitation", () => {
  // It used to read "Получать уведомления, даже когда вкладка закрыта" — a
  // description of the button beside it. A row that carries its value says
  // which of the two states it is in.
  assert.equal(pushStatusSummary("inactive", BROWSER), "Выключены");
  assert.equal(pushStatusSummary("active", BROWSER), "Включены");
});

test("the push row offers a button only where pressing it can work", () => {
  assert.equal(pushStatusAction("active", BROWSER), "disable");
  assert.equal(pushStatusAction("inactive", BROWSER), "enable");

  // Inside the Android shell `native_unavailable` means the web path is not the
  // one to use, and enabling still goes somewhere. In a browser it means there
  // is nothing to enable, and a button would be a dead end.
  assert.equal(pushStatusAction("native_unavailable", ANDROID), "enable");
  assert.equal(pushStatusAction("native_unavailable", BROWSER), null);
  assert.equal(pushStatusAction("native_unavailable", WINDOWS), null);

  for (const status of ["denied", "unsupported", "missing_vapid", "migration_missing"] as const) {
    assert.equal(pushStatusAction(status, ANDROID), null, status);
    assert.equal(pushStatusAction(status, BROWSER), null, status);
  }
});

test("the theme row names the theme in force, not only the rule", () => {
  assert.equal(themeSummary("dark", "dark"), "Тёмная");
  assert.equal(themeSummary("light", "light"), "Светлая");
  // "Системная" on its own is the rule. What is on screen right now is the
  // resolved half, and that is the part a person is checking.
  assert.equal(themeSummary("system", "dark"), "Системная · тёмная");
  assert.equal(themeSummary("system", "light"), "Системная · светлая");
});

test("presence prints its state, and explains itself only in the surprising one", () => {
  assert.equal(presenceSummary(true), "Виден");
  assert.equal(presenceSummary(false), "Скрыт");

  // On, the old paragraph restated the label. Off, it carries something a
  // switch cannot show: the timestamp stops being kept, but you stay findable.
  assert.equal(presenceHint(true), null);
  assert.match(String(presenceHint(false)), /можно найти и написать вам/u);
  assert.match(String(presenceHint(false)), /не сохраняется/u);
});

test("an empty profile field reads as empty rather than as nothing at all", () => {
  assert.equal(textValueSummary("  Максим  "), "Максим");
  assert.equal(textValueSummary("   "), SETTINGS_EMPTY_VALUE);
  assert.equal(textValueSummary(""), SETTINGS_EMPTY_VALUE);
  assert.equal(textValueSummary(null), SETTINGS_EMPTY_VALUE);
  assert.equal(textValueSummary(undefined), SETTINGS_EMPTY_VALUE);
});

test("the character counter appears only once the limit is close", () => {
  // usernameMax is 32, so the counter starts at 26 — ceil(32 * 0.8).
  assert.equal(shouldShowCounter(0, 32), false);
  assert.equal(shouldShowCounter(25, 32), false);
  assert.equal(shouldShowCounter(26, 32), true);
  assert.equal(shouldShowCounter(32, 32), true);

  // fullNameMax 64 -> 52, bioMax 70 -> 56.
  assert.equal(shouldShowCounter(51, 64), false);
  assert.equal(shouldShowCounter(52, 64), true);
  assert.equal(shouldShowCounter(55, 70), false);
  assert.equal(shouldShowCounter(56, 70), true);

  assert.equal(shouldShowCounter(5, 0), false);
  assert.equal(shouldShowCounter(Number.NaN, 32), false);
  assert.equal(shouldShowCounter(5, Number.NaN), false);
});

test("the audio row summarises stored settings without asking the browser for hardware", () => {
  assert.equal(
    audioSummary({ processingMode: "clean", selectedInputDeviceId: "default", micInputGain: 1 }),
    "Системный микрофон · Чистый голос",
  );
  assert.equal(
    audioSummary({ processingMode: "raw", selectedInputDeviceId: "abc123", micInputGain: 1 }),
    "Выбранный микрофон · Без обработки",
  );

  // A microphone quietly left at 40% is the thing worth seeing from a closed
  // row; a microphone at exactly 1 is the default and says nothing.
  assert.equal(
    audioSummary({ processingMode: "custom", selectedInputDeviceId: "default", micInputGain: 0.4 }),
    "Системный микрофон · Настроено вручную · усиление 40%",
  );
  assert.equal(
    audioSummary({ processingMode: "clean", selectedInputDeviceId: "default", micInputGain: 3 }),
    "Системный микрофон · Чистый голос · усиление 200%",
  );
  assert.equal(
    audioSummary({ processingMode: "clean", selectedInputDeviceId: "default", micInputGain: Number.NaN }),
    "Системный микрофон · Чистый голос",
  );

  assert.equal(audioProcessingLabel("clean"), "Чистый голос");
  assert.equal(audioProcessingLabel("raw"), "Без обработки");
  assert.equal(audioProcessingLabel("custom"), "Настроено вручную");
});

test("decoration reads off the profile that is already loaded", () => {
  assert.equal(decorationSummary("gold", "aurora"), "Рамка и фон");
  assert.equal(decorationSummary("gold", null), "Рамка");
  assert.equal(decorationSummary(null, "aurora"), "Фон");
  assert.equal(decorationSummary(null, null), "Без оформления");
  assert.equal(decorationSummary(undefined, undefined), "Без оформления");
  assert.equal(decorationSummary("", ""), "Без оформления");
});

test("the staff entry is drawn for staff and for nobody else", () => {
  const forEveryone = visibleSettingsSections({ isStaff: false });
  assert.deepEqual([...forEveryone], ["profile", "notifications", "privacy", "application"]);
  assert.equal(forEveryone.includes("service"), false);

  const forStaff = visibleSettingsSections({ isStaff: true });
  assert.deepEqual([...forStaff], ["profile", "notifications", "privacy", "application", "service"]);
});

test("adding the staff section does not disturb the sections everyone sees", () => {
  const forEveryone = visibleSettingsSections({ isStaff: false });
  const forStaff = visibleSettingsSections({ isStaff: true });
  assert.deepEqual(forStaff.slice(0, forEveryone.length), [...forEveryone]);

  // The list is what the modal maps over, so a mutation of the array it returns
  // would reorder or delete a whole section of the screen.
  visibleSettingsSections({ isStaff: true });
  assert.deepEqual([...visibleSettingsSections({ isStaff: false })], [...forEveryone]);
});
