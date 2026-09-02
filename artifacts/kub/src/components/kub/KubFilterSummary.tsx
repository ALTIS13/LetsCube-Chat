import { cn } from "@/lib/utils";
import { KubFilterChip } from "./KubFilterChip";

export interface ActiveFilter {
  id: string;
  /** Read as a sentence fragment: "Роль: Администратор", "Телефон подтверждён". */
  label: string;
  onRemove: () => void;
}

interface KubFilterSummaryProps {
  /** How many rows survive the filters and are actually on screen. */
  matched: number;
  /** How many exist in total, as the server counts them. */
  total: number;
  filters: ActiveFilter[];
  onReset: () => void;
  /** The word for what is being counted, in the genitive plural: "пользователей". */
  noun?: string;
  /**
   * True when the loaded set is only part of `total`, so filters applied in the
   * browser can only see this page. Saying so is the difference between a count
   * that informs and one that misleads: on a paged list, "найдено 1 из 340" read
   * as a search across all 340 would be a lie, because 339 of them were never
   * examined.
   */
  scopedToPage?: boolean;
  className?: string;
}

// Grouping digits makes four- and five-figure counts readable at a glance;
// `ru-RU` uses a narrow no-break space, which is the correct Russian separator.
const numbers = new Intl.NumberFormat("ru-RU");

/**
 * The line that answers "what am I looking at, and why is it not everything?"
 *
 * It is one line rather than a panel on purpose: it sits above the list and has
 * to cost almost no height, because its whole job is to stop someone reading a
 * filtered list as if it were the full one. When nothing is filtered it renders
 * nothing at all — a permanent "0 filters" line would be the same noise the
 * five always-visible selects were.
 */
export function KubFilterSummary({
  matched,
  total,
  filters,
  onReset,
  noun,
  scopedToPage = false,
  className,
}: KubFilterSummaryProps) {
  if (filters.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)}>
      <span className="text-[color:var(--kub-muted)]">
        Найдено {numbers.format(matched)} из {numbers.format(total)}
        {noun ? ` ${noun}` : ""}
        {scopedToPage ? " · фильтры применены к загруженной странице" : ""}
      </span>
      {filters.map((filter) => (
        <KubFilterChip key={filter.id} label={filter.label} onRemove={filter.onRemove}>
          {filter.label}
        </KubFilterChip>
      ))}
      <button
        type="button"
        onClick={onReset}
        className="kub-button kub-interactive rounded-lg px-2 font-semibold text-[color:var(--kub-cyan)] hover:underline"
      >
        Сбросить всё
      </button>
    </div>
  );
}
