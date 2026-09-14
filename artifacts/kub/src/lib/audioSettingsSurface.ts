/**
 * What the sound settings say, and the few decisions behind the words.
 *
 * The surface used to keep all of this inline: three section captions, two
 * device labels, five notices and a mode readout printed twice. None of it
 * could be reached from `node --test`, so every one of those strings was a
 * thing only a screenshot could check.
 *
 * Nothing here decides what a setting *does*. `hooks/useAudioSettings.ts` holds
 * the stored values and the track constraints, and `lib/audioOutput.ts` the
 * sink; this module holds the reading of them. It imports nothing — including
 * `DEFAULT_AUDIO_DEVICE_ID`, which is passed in rather than copied, so the two
 * cannot drift the way `settingsRows.ts` has to guard against.
 */

export type AudioSurfaceMode = "clean" | "raw" | "custom";

/** The two modes that can be applied. `settingsForProcessingMode` takes these. */
export type AudioSelectableMode = Exclude<AudioSurfaceMode, "custom">;

/**
 * A segment of the processing picker, as a discriminated union on
 * `selectable`.
 *
 * Not a `boolean` field: the component narrows `segment.mode` off it to call
 * `changeProcessingMode`, and with a plain `boolean` the narrowing is not
 * available and the call site needs a cast — which is the cast that would
 * happily pass `"custom"` to a function that has no branch for it.
 *
 * `custom` is a **state**, not a choice: it is what `inferProcessingMode`
 * answers when the three switches below do not all agree, and there is no
 * "custom" to apply. It stays in the picker because a track with nothing lit
 * reads as broken, and it is drawn as the selected segment while it is the
 * state. It used to be a third full-width pill, `disabled`, painted exactly
 * like the two that work.
 */
export type AudioModeSegment =
  | { readonly mode: AudioSelectableMode; readonly label: string; readonly selectable: true }
  | { readonly mode: "custom"; readonly label: string; readonly selectable: false };

/**
 * The picker, in order.
 *
 * A one-of-N choice is drawn in this product as a track with flush segments —
 * the theme radiogroup two rows above this section, and «Лимит кэша» in
 * `StorageSection`, which is a sibling inside another disclosure on the same
 * screen. Both are `rounded-lg border bg-[var(--kub-bg)] p-0.5` holding
 * segments whose selected one carries the accent fill. Three stacked
 * full-width pills were a third dialect for the same job.
 */
export const AUDIO_MODE_SEGMENTS: readonly AudioModeSegment[] = [
  { mode: "clean", label: "Чистый голос", selectable: true },
  { mode: "raw", label: "Без обработки", selectable: true },
  { mode: "custom", label: "Вручную", selectable: false },
];

/** The group captions, in the screen's own voice: muted, not an accent colour. */
export const AUDIO_GROUP_DEVICES = "Устройства";
export const AUDIO_GROUP_LEVEL = "Уровень";
export const AUDIO_GROUP_PROCESSING = "Обработка голоса";

/**
 * The one fact the old three-line preamble carried that a person cannot read
 * off the controls. The rest of it — "choose a microphone, check the level,
 * set the processing" — named the rows underneath it, and the row this panel
 * opens from already says «Звук».
 */
export const AUDIO_INTRO_NOTE = "Эти настройки не меняют системную громкость.";

export const AUDIO_INPUT_LABEL = "Микрофон";
export const AUDIO_OUTPUT_LABEL = "Вывод звука";
export const AUDIO_DEFAULT_INPUT_LABEL = "Системный микрофон";
export const AUDIO_DEFAULT_OUTPUT_LABEL = "Системный вывод";

/**
 * `enumerateDevices()` answers before permission is granted — with blank
 * labels, which the caller replaces with «Микрофон 1» and friends. So the list
 * is there and the **names** are what arrive later; «Список появится после
 * разрешения доступа» said the opposite of what happens.
 */
export const AUDIO_DEVICE_NAMES_NOTE =
  "Названия устройств появятся после того, как вы разрешите доступ к микрофону.";

export const AUDIO_OUTPUT_UNSUPPORTED_NOTE =
  "Браузер не даёт выбрать вывод. Звук идёт в системное устройство.";

export const AUDIO_GAIN_LABEL = "Усиление микрофона";
export const AUDIO_MONITOR_GAIN_LABEL = "Громкость прослушивания";
export const AUDIO_SELF_MONITOR_LABEL = "Слышать свой микрофон";
export const AUDIO_LEVEL_METER_LABEL = "Уровень микрофона";
export const AUDIO_MODE_GROUP_LABEL = "Как звучит голос";
export const AUDIO_RESET_LABEL = "Сбросить настройки звука";
export const AUDIO_APPLYING_NOTE = "Применяем настройки…";

export const AUDIO_PROCESSING_HINT =
  "Если слышно эхо, наденьте наушники. Если голос звучит с артефактами, выберите «Без обработки».";

/** The button that starts and stops the microphone test. A button says a verb. */
export function micTestLabel(testing: boolean): string {
  return testing ? "Остановить" : "Проверить микрофон";
}

/**
 * The line under «Слышать свой микрофон».
 *
 * Three branches, not two. While a test was running and monitoring was off,
 * the old copy said «Доступно во время проверки микрофона» — which is the one
 * moment it is not merely available but ready, and reads as a refusal.
 */
export function selfMonitorHint(selfMonitoring: boolean, testing: boolean): string {
  if (selfMonitoring) return "Звук идёт в выбранный вывод. Без наушников будет эхо.";
  if (testing) return "Наденьте наушники, иначе микрофон услышит сам себя.";
  return "Доступно во время проверки микрофона.";
}

/** Which device fell away, said in the words the surface prints. */
export function deviceFallbackNote(kind: "input" | "output"): string {
  return kind === "input"
    ? "Выбранный микрофон недоступен. Используется системный."
    : "Выбранное устройство вывода недоступно. Используется системное.";
}

/**
 * The meter's width, as a percentage.
 *
 * The caller reads a peak out of an `AnalyserNode`, and an empty buffer or a
 * closed context gives `NaN` — which reached the style as `width: NaN%` and
 * left the bar at whatever it last was. Clamped and finite here.
 */
export function audioLevelPercent(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.round(Math.min(1, Math.max(0, level)) * 100);
}

export interface AudioDeviceChoice {
  readonly deviceId: string;
  readonly label: string;
}

/**
 * The options one device `<select>` offers: the system entry first, then the
 * enumerated devices.
 *
 * The system entry is synthesised rather than taken from the browser, and an
 * enumerated device carrying the same id is dropped — Chromium really does
 * return an `audioinput` whose `deviceId` is `"default"`, and without the
 * filter the select shows «Системный микрофон» and «Default - Микрофон (…)»
 * as two options that set the same value, so picking one moves the tick to
 * the other.
 */
export function audioDeviceOptions(
  defaultId: string,
  defaultLabel: string,
  devices: readonly AudioDeviceChoice[],
): readonly AudioDeviceChoice[] {
  return [
    { deviceId: defaultId, label: defaultLabel },
    ...devices.filter((device) => device.deviceId !== defaultId),
  ];
}
