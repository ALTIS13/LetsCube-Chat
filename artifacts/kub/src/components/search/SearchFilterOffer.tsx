"use client";

import { useMemo } from "react";
import { KubIcon, type KubIconName } from "@/components/kub";
import {
  completeSearchFilter,
  insertSearchPrefix,
  personMatchesSearch,
  SEARCH_FILTER_ROWS,
  SEARCH_HAS_CHOICES,
  searchFilterOffer,
} from "@/lib/searchFilterOffer";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";

const ROW_ICONS: Record<string, KubIconName> = {
  "from:": "user",
  "has:": "attach",
  "before:": "clock",
  "after:": "clock",
};

const HAS_ICONS: Record<string, KubIconName> = {
  image: "image",
  video: "video",
  file: "file",
  link: "link",
  audio: "music",
};

/**
 * The in-chat search's own grammar, offered under its field (tracker item 36 c).
 *
 * The rule — what to offer for what has been typed — is `lib/searchFilterOffer.ts`.
 * What is here is the drawing and the insert: a press puts the prefix or the
 * finished filter into the field and hands the keyboard back to it, and does
 * not search on its own, which is what Discord's popout does (§15.3). The
 * people of a `from:` are the conversation's own members.
 */
export function SearchFilterOffer({
  chatId,
  query,
  onChangeQuery,
  onPicked,
  compact = false,
}: {
  chatId: string;
  query: string;
  onChangeQuery: (next: string) => void;
  /** Called after a press, to put the caret back in the field. */
  onPicked?: () => void;
  compact?: boolean;
}) {
  const members = useAppStore((s) => s.chats.find((chat) => chat.id === chatId)?.members);
  const offer = searchFilterOffer(query);
  const people = useMemo(() => {
    if (offer.kind !== "from") return [];
    return (members ?? [])
      .map((member) => ({
        id: member.user_id,
        name: member.profile?.full_name?.trim() || member.profile?.username || "Участник",
        username: member.profile?.username ?? null,
      }))
      .filter((person) => personMatchesSearch(person, offer.partial))
      .slice(0, 10);
  }, [members, offer]);

  if (offer.kind === "none") return null;

  const pick = (next: string) => {
    onChangeQuery(next);
    onPicked?.();
  };

  const rowClass = cn(
    "flex w-full min-w-0 items-center gap-2.5 rounded-lg text-left transition-colors kub-raise-hover",
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
    compact ? "px-2 py-1.5" : "px-2.5 py-2",
  );

  if (offer.kind === "filters") {
    return (
      <div className={cn("flex flex-col", compact ? "px-2 pb-2" : "px-3 pt-2")} data-testid="search-filter-offer" data-offer="filters">
        <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
          Фильтры
        </div>
        {SEARCH_FILTER_ROWS.map((row) => (
          <button
            key={row.prefix}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(insertSearchPrefix(query, row.prefix))}
            data-search-filter={row.prefix}
            className={rowClass}
          >
            <KubIcon name={ROW_ICONS[row.prefix] ?? "filter"} size={15} tone="muted" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-[color:var(--kub-text)]">{row.title}</span>
              <span className="truncate text-xs text-[color:var(--kub-muted)]">{row.hint}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  if (offer.kind === "from") {
    if (people.length === 0) return null;
    return (
      <div className={cn("flex flex-col", compact ? "px-2 pb-2" : "px-3 pt-2")} data-testid="search-filter-offer" data-offer="from">
        <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
          От участника
        </div>
        {people.map((person) => (
          <button
            key={person.id}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(completeSearchFilter(query, offer.start, "from", person.name))}
            data-search-person={person.id}
            className={rowClass}
          >
            <KubIcon name="user" size={15} tone="muted" />
            <span className="min-w-0 flex-1 truncate text-sm text-[color:var(--kub-text)]">{person.name}</span>
            {person.username && (
              <span className="shrink-0 text-xs text-[color:var(--kub-muted)]">@{person.username}</span>
            )}
          </button>
        ))}
      </div>
    );
  }

  const choices = SEARCH_HAS_CHOICES.filter((choice) => {
    const needle = offer.partial.toLocaleLowerCase("ru-RU");
    return !needle || choice.value.startsWith(needle) || choice.label.toLocaleLowerCase("ru-RU").startsWith(needle);
  });
  if (choices.length === 0) return null;
  return (
    <div className={cn("flex flex-col", compact ? "px-2 pb-2" : "px-3 pt-2")} data-testid="search-filter-offer" data-offer="has">
      <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
        Содержит
      </div>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => pick(completeSearchFilter(query, offer.start, "has", choice.value))}
          data-search-has={choice.value}
          className={rowClass}
        >
          <KubIcon name={HAS_ICONS[choice.value] ?? "attach"} size={15} tone="muted" />
          <span className="min-w-0 flex-1 truncate text-sm text-[color:var(--kub-text)]">{choice.label}</span>
          <span className="shrink-0 text-xs text-[color:var(--kub-muted)]">has:{choice.value}</span>
        </button>
      ))}
    </div>
  );
}
