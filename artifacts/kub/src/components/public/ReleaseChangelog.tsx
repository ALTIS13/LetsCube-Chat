import { useId, useState } from "react";

import { KubIcon } from "@/components/kub";
import type { PublicChangelogEntry } from "@/lib/publicReleaseModel";
import { mergeReleaseHistory, type ReleaseHistoryEntry } from "@/lib/releaseHistory";
import type { ReleasePlatform } from "@/lib/releaseCatalog";

/**
 * The compact "Что нового" module.
 *
 * Current catalog metadata and a bounded receipt-backed release history.
 * Reading old notes never changes the current download or updater contract.
 */

export function ReleaseChangelog({ entry }: {
  entry: (PublicChangelogEntry & { history?: ReleaseHistoryEntry[] }) | null;
}) {
  const listId = useId();
  const history = entry?.history ?? (entry ? [{
    ...entry, build: null, whatToTest: [], limitations: [], source: "catalog" as const,
  }] : mergeReleaseHistory([]));

  return (
    <section
      aria-labelledby={`${listId}-title`}
      // A card of the same material as the platforms above it, carrying its own
      // top margin so the two surfaces keep one rhythm on both pages that mount
      // this. `mt-*` matches the gap of the platform grid it follows.
      className="kub-glass mt-4 rounded-2xl border border-[color:var(--kub-border-color)] p-5 sm:mt-5 sm:p-8"
    >
      <h2 id={`${listId}-title`} className="text-2xl font-bold text-[color:var(--kub-text)]">Что нового</h2>
      <div className="mt-5"><ReleaseHistoryList history={history} /></div>
    </section>
  );
}

export function ReleaseHistoryList({ history, entryTestId }: {
  history: readonly ReleaseHistoryEntry[];
  entryTestId?: string;
}) {
  const selectId = useId();
  const [selected, setSelected] = useState<ReleasePlatform | null>(null);
  const platforms = [...new Map(history.map((entry) => [entry.platform, entry.title])).entries()];
  const platform = platforms.find(([key]) => key === selected)?.[0] ?? platforms[0]?.[0];
  const entries = history.filter((entry) => entry.platform === platform);
  const [first, ...older] = entries;
  if (!first) return null;

  return (
    <div data-testid="release-history" className="min-w-0 max-w-2xl space-y-4 [overflow-wrap:anywhere]">
      {platforms.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="text-sm text-[color:var(--kub-muted)]">Платформа</label>
          <select id={selectId} value={platform} onChange={(event) => setSelected(event.target.value as ReleasePlatform)}
            className="kub-glass min-h-11 max-w-full rounded-md border border-[color:var(--kub-border-color)] px-3 text-sm text-[color:var(--kub-text)]">
            {platforms.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
          </select>
        </div>
      )}
      <article key={`${first.platform}:${first.build}:${first.version}`} data-testid={entryTestId ?? "release-history-latest"}
        data-platform={first.platform} data-build={first.build} className="min-w-0">
        <h4 className="break-words text-sm font-semibold text-[color:var(--kub-text)]">
          {first.title} {first.version}{first.build !== null && ` · сборка ${first.build}`}
        </h4>
        <time dateTime={first.publishedAt} className="text-xs leading-5 text-[color:var(--kub-muted)]">{formatDate(first.publishedAt)}</time>
        <ReleaseNotes entry={first} />
      </article>
      {older.map((entry) => (
        <details key={`${entry.platform}:${entry.build}:${entry.version}`} data-testid="release-history-older"
          data-platform={entry.platform} data-build={entry.build} className="min-w-0 border-t border-[color:var(--kub-rule)] pt-3">
          <summary className="min-h-11 cursor-pointer text-sm leading-6 text-[color:var(--kub-text)]">
            <span className="font-semibold">{entry.title} {entry.version}{entry.build !== null && ` · сборка ${entry.build}`}</span>
            <time dateTime={entry.publishedAt} className="block whitespace-nowrap text-xs text-[color:var(--kub-muted)]">{formatDate(entry.publishedAt)}</time>
          </summary>
          <ReleaseNotes entry={entry} />
        </details>
      ))}
    </div>
  );
}

function ReleaseNotes({ entry }: { entry: ReleaseHistoryEntry }) {
  return (
    <div className="mt-2 space-y-3 text-sm leading-6 text-[color:var(--kub-text)]">
      {entry.source !== "catalog" && (
        <p className="text-xs leading-5 text-[color:var(--kub-muted)]">
          {entry.source === "bundled" ? "Выпущено" : "Сохранённые сведения · сейчас без связи с каталогом"}
        </p>
      )}
      {entry.notes && !entry.highlights.length && <p className="whitespace-pre-wrap break-words">{entry.notes}</p>}
      {entry.highlights.length > 0 && (
        <div>
          <h5 className="mb-2 text-sm font-semibold">Что изменилось</h5>
          <ul className="space-y-2">
            {entry.highlights.slice(0, 3).map((highlight, index) => (
              <li key={index} className="flex min-w-0 gap-2">
                <KubIcon name="check" size={14} tone="accent" className="mt-1 shrink-0" />
                <span className="min-w-0 break-words">{highlight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!entry.notes && !entry.highlights.length && <p>Описание изменений для этого выпуска не опубликовано.</p>}
      {entry.whatToTest.length > 0 && (
        <div>
          <h5 className="mb-1 text-sm font-semibold">Что проверить</h5>
          <ul className="list-disc space-y-2 pl-5">{entry.whatToTest.slice(0, 2).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
      {(entry.limitations.length > 0 || entry.highlights.length > 3 || entry.whatToTest.length > 2) && (
        <details data-testid="release-history-details" className="text-[color:var(--kub-muted)]">
          <summary className="min-h-11 cursor-pointer leading-10">Подробности</summary>
          {entry.highlights.length > 3 && <ul className="list-disc space-y-2 pl-5">{entry.highlights.slice(3).map((item) => <li key={item}>{item}</li>)}</ul>}
          {entry.whatToTest.length > 2 && <ul className="mt-2 list-disc space-y-2 pl-5">{entry.whatToTest.slice(2).map((item) => <li key={item}>{item}</li>)}</ul>}
          {entry.limitations.length > 0 && <>
            <h5 className="mb-1 text-sm font-semibold">Ограничения</h5>
            <ul className="list-disc space-y-2 pl-5">{entry.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
          </>}
        </details>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
