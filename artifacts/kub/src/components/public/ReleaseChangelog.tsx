import { useId, useState } from "react";

import { KubIcon } from "@/components/kub";
import type { PublicChangelogEntry } from "@/lib/publicReleaseModel";

/**
 * The compact "Что нового" module.
 *
 * It reads the newest released Stable build straight from the release catalog,
 * so it can never claim something the manifest does not. Details expand in
 * place: there is no news route and no content system behind this.
 */

const VISIBLE_HIGHLIGHTS = 3;

export function ReleaseChangelog({ entry }: { entry: PublicChangelogEntry | null }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  if (!entry) return null;

  const hasMore = entry.highlights.length > VISIBLE_HIGHLIGHTS;
  const shown = expanded ? entry.highlights : entry.highlights.slice(0, VISIBLE_HIGHLIGHTS);

  return (
    <section
      aria-labelledby="public-changelog-title"
      className="border-t border-[color:var(--kub-border-color)] py-10 sm:py-14"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="public-changelog-title" className="text-2xl font-bold text-[color:var(--kub-text)]">
          Что нового
        </h2>
        <p className="text-sm text-[color:var(--kub-muted)]">
          {entry.title} {entry.version} · <time dateTime={entry.publishedAt}>{formatDate(entry.publishedAt)}</time>
        </p>
      </div>

      {shown.length > 0 ? (
        <ul id={listId} className="mt-5 flex max-w-2xl flex-col gap-2">
          {shown.map((highlight) => (
            <li key={highlight} className="flex gap-2 text-sm leading-6 text-[color:var(--kub-text)]">
              <KubIcon name="check" size={16} tone="accent" className="mt-0.5 shrink-0" />
              <span>{highlight}</span>
            </li>
          ))}
        </ul>
      ) : (
        entry.notes && (
          <p className="mt-5 max-w-2xl text-sm leading-6 text-[color:var(--kub-muted)]">{entry.notes}</p>
        )
      )}

      {hasMore && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
          className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[color:var(--kub-cyan)]"
        >
          {expanded ? "Свернуть" : `Ещё ${entry.highlights.length - VISIBLE_HIGHLIGHTS}`}
          <KubIcon name={expanded ? "chevronUp" : "chevronDown"} size={16} tone="accent" />
        </button>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}
