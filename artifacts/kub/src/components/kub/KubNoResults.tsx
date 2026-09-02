import { KubButton } from "./KubButton";
import { KubEmptyState } from "./KubEmptyState";
import { KubIcon } from "./KubIcon";
import type { ActiveFilter } from "./KubFilterSummary";

interface KubNoResultsProps {
  filters: ActiveFilter[];
  onReset: () => void;
  /**
   * How many the conditions removed — pass it ONLY where that number is really
   * known. On a screen whose search runs on the server, the unfiltered total is
   * not in memory at all, and the count that is available is the count of what
   * matched, which is zero here. Rendering that produced "условия отсеяли 0
   * пользователей", which is worse than saying nothing.
   */
  removed?: number;
  /** What is being counted, in the genitive plural: "пользователей". */
  noun?: string;
  /** Shown when there is genuinely nothing to list, filters or not. */
  emptyTitle?: string;
  emptyDescription?: string;
}

const numbers = new Intl.NumberFormat("ru-RU");

/**
 * "Nothing found" written as a way out rather than a full stop.
 *
 * A bare "Никого не найдено" leaves a person to work out for themselves that
 * they are looking at a filtered list, which condition is responsible, and how
 * to undo it — and if they have forgotten a filter is on, they will read it as
 * "these people do not exist".
 *
 * So this says how many the conditions removed, and offers to drop them: the
 * one that is on, by name, when there is only one, and all of them otherwise.
 * With no filters active it falls back to a plain empty state, because then
 * there really is nothing and offering to remove nothing would be nonsense.
 */
export function KubNoResults({
  filters,
  onReset,
  removed,
  noun,
  emptyTitle = "Пока пусто",
  emptyDescription,
}: KubNoResultsProps) {
  if (filters.length === 0) {
    return (
      <KubEmptyState
        icon={<KubIcon name="search" size={22} />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  const only = filters.length === 1 ? filters[0] : null;
  const counted = typeof removed === "number" && removed > 0 ? removed : null;

  return (
    <KubEmptyState
      icon={<KubIcon name="search" size={22} />}
      title="Ничего не найдено по текущим условиям"
      description={
        counted !== null
          ? `Условия отсеяли ${numbers.format(counted)}${noun ? ` ${noun}` : ""}. Снимите одно из них или сбросьте всё.`
          : "Снимите одно из условий или сбросьте всё."
      }
      action={
        // With one filter on, "снять его" and "сбросить всё" are the same
        // action, so only the named one is offered: two adjacent buttons that
        // do the same thing make a person stop and work out the difference,
        // and there isn't one.
        only ? (
          <KubButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={only.onRemove}
            leftIcon={<KubIcon name="close" size={13} />}
          >
            Снять «{only.label}»
          </KubButton>
        ) : (
          <KubButton type="button" variant="secondary" size="sm" onClick={onReset}>
            Сбросить всё
          </KubButton>
        )
      }
    />
  );
}
