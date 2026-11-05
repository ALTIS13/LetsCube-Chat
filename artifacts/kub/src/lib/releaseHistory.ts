import type { PublicChangelogEntry, PublicChangelogSource } from "./publicReleaseModel";
import type { ReleasePlatform } from "./releaseCatalog";

export type ReleaseHistoryEntry = PublicChangelogEntry & {
  build: number | null;
  whatToTest: readonly string[];
  limitations: readonly string[];
  source: "bundled" | "catalog" | "stale-catalog";
  evidenceRef?: string;
};

export type ReleaseChangelogValue = PublicChangelogEntry & {
  history: ReleaseHistoryEntry[];
};

export type CatalogReleaseNotes = Pick<ReleaseHistoryEntry, "version" | "whatToTest">
  & Partial<Pick<ReleaseHistoryEntry, "highlights" | "notes" | "limitations">>;

// Applied only to an exact available Stable manifest, never to the archive.
// Changes remain the publisher's highlights; these are reviewed tester checks.
export const CATALOG_RELEASE_NOTES: Readonly<Record<string, CatalogReleaseNotes>> = {
  "android:47": {
    version: "0.1.46",
    whatToTest: [
      "Проверьте подтверждение собственной задачи с правом проверки своих задач. У пользователя без права подтверждение должно быть недоступно и отклоняться сервером.",
      "Создайте задачу без назначения и назначьте её позже. Проверьте фильтр по нескольким людям, раскрытие дополнительных полей формы и трёх версий истории обновлений.",
    ],
  },
};

export const RELEASE_HISTORY_PER_PLATFORM_LIMIT = 4;

// Receipt dates have day precision. These are released notes, not a download
// catalog: never construct artifact URLs or infer unpublished candidate builds.
export const VERIFIED_RELEASE_HISTORY: readonly ReleaseHistoryEntry[] = [
  {
    platform: "android", title: "Android", version: "0.1.45", build: 46,
    publishedAt: "2026-11-05", source: "bundled",
    notes: "Совместимость обработки звука в коротких видео.",
    highlights: [
      "Добавлен резервный способ обработки звука в некоторых коротких MP4-видео при ошибке основного способа.",
      "При обрезке сохраняется звук выбранного отрезка. При ошибке оригинал не отправляется автоматически.",
    ],
    whatToTest: [
      "Обрежьте короткое MP4-видео со звуком: проверьте фрагмент и синхронность звука. При ошибке убедитесь, что оригинал не отправился.",
    ],
    limitations: [
      "Резервный путь ограничен совместимыми MP4/AVC с одной AAC-LC моно-дорожкой: до 8 МиБ, 15 секунд и 1280 пикселей по стороне, не более 921 600 пикселей кадра.",
      "Проверка обработки в браузере Android не подтверждает редактирование и отправку в установленном приложении или на iPhone. Эти сценарии ещё требуют проверки.",
    ],
    evidenceRef: "docs/operations/2026-11-05-video-pcm-fallback.md",
  },
  {
    platform: "android", title: "Android", version: "0.1.44", build: 45,
    publishedAt: "2026-10-28", source: "bundled",
    notes: "Обновление приложения, уведомления и качество отредактированного видео.",
    highlights: [
      "После изменения каталога обновлений устаревший подготовленный файл заменяется предложением актуального выпуска. При сетевой ошибке известный файл сохраняется.",
      "Завершение обработки старого уведомления больше не закрывает новое уведомление с тем же тегом.",
      "Отредактированное видео не сжимается повторно. Ползунок качества относится только к ещё не обработанным видео; для уже обработанных он скрыт.",
    ],
    whatToTest: [
      "Проверьте обновление из состояния «Готово», когда появился новый выпуск, и отдельно при отсутствии сети.",
      "Проверьте качество, порядок и подпись при повторной отправке отредактированного видео в альбоме. При чтении старого уведомления новая карточка того же чата должна остаться.",
    ],
    limitations: [
      "На проверенном устройстве Android 13 установка дошла до сканирования Play Protect; завершение установки не подтверждено. Защиту отключать не нужно.",
      "Этот выпуск не закрывает все случаи отправки медиа, уведомлений и работы обновления на разных устройствах.",
    ],
    evidenceRef: "docs/operations/2026-10-28-stable45-followup.md",
  },
  {
    platform: "android", title: "Android", version: "0.1.43", build: 44,
    publishedAt: "2026-10-28", source: "bundled",
    notes: "Совместимость проверки подписи обновления на отдельных устройствах Android.",
    highlights: [
      "Исправлено чтение сведений о подписи APK на проверенном устройстве Android 13, где корректный файл отклонялся до открытия установщика.",
      "Защита проверки подписи и целостности обновления не ослаблена. Проверенная установка поверх приложения сохранила его данные.",
    ],
    whatToTest: [
      "На устройстве с прежней ошибкой проверки APK проверьте переход от загрузки к системному установщику и сохранение данных после обновления.",
    ],
    limitations: [
      "Старому приложению с этой ошибкой может потребоваться однократная установка официального APK поверх, без удаления приложения. Такая замена не доказывает работу встроенного обновления.",
      "Исправление проверено на конкретных устройствах, а не на всех моделях Android 13.",
    ],
    evidenceRef: "docs/operations/2026-10-28-android-oem-updater.md",
  },
];

export function mergeReleaseHistory(
  sources: readonly PublicChangelogSource[],
  archive: readonly ReleaseHistoryEntry[] = VERIFIED_RELEASE_HISTORY,
  catalogNotes: Readonly<Record<string, CatalogReleaseNotes>> = CATALOG_RELEASE_NOTES,
): ReleaseHistoryEntry[] {
  const entries = new Map<string, ReleaseHistoryEntry>();
  for (const entry of archive) {
    if (entry.build === null) continue;
    entries.set(`${entry.platform}:${entry.build}`, {
      ...entry,
      highlights: [...entry.highlights],
      whatToTest: [...entry.whatToTest],
      limitations: [...entry.limitations],
    });
  }

  for (const { title, snapshot } of sources) {
    const manifest = snapshot?.manifest;
    if (!manifest || manifest.channel !== "stable" || !manifest.available || !manifest.artifact) continue;
    const key = `${manifest.platform}:${manifest.build}`;
    const archived = entries.get(key);
    const currentNotes = catalogNotes[key];
    const reviewed = currentNotes?.version === manifest.version ? currentNotes
      : archived?.version === manifest.version ? archived : undefined;
    entries.set(key, {
      platform: manifest.platform,
      title,
      version: manifest.version,
      build: manifest.build,
      publishedAt: manifest.publishedAt,
      highlights: [...(currentNotes?.version === manifest.version ? currentNotes.highlights ?? manifest.highlights : reviewed?.highlights ?? manifest.highlights)],
      notes: currentNotes?.version === manifest.version ? currentNotes.notes ?? manifest.notes : reviewed?.notes ?? manifest.notes,
      whatToTest: [...(reviewed?.whatToTest ?? [])],
      limitations: [...(reviewed?.limitations ?? [])],
      evidenceRef: archived?.version === manifest.version ? archived.evidenceRef : undefined,
      source: snapshot!.stale ? "stale-catalog" : "catalog",
    });
  }

  const kept = new Map<ReleasePlatform, number>();
  return [...entries.values()]
    .sort((a, b) => a.platform.localeCompare(b.platform) || (b.build ?? 0) - (a.build ?? 0))
    .filter((entry) => {
      const count = kept.get(entry.platform) ?? 0;
      kept.set(entry.platform, count + 1);
      return count < RELEASE_HISTORY_PER_PLATFORM_LIMIT;
    });
}
