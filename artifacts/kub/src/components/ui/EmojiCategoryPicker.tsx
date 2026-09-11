"use client";

import { useMemo, useState } from "react";
import { KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";
import type { EmojiCategory, EmojiSearchTerms } from "@/lib/emojiCatalog";

interface EmojiCategoryPickerProps {
  categories: readonly EmojiCategory[];
  onSelect: (emoji: string | null) => void;
  testIdPrefix: string;
  selected?: string | null;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
  searchTerms?: EmojiSearchTerms;
  scrollable?: boolean;
  compact?: boolean;
  /**
   * A «Недавние» row above the search and the categories — the reaction panel's,
   * as in Telegram. Omitted, the picker is exactly what it was.
   */
  recent?: readonly string[];
  /** Utilities for the emoji grid itself, merged after its own. */
  gridClassName?: string;
}

/**
 * The picker keeps the bargain every other control makes (D-015): its dense
 * scale is the design and stays exactly as it is under a cursor, and a coarse
 * pointer — a finger — gets 44px targets. Measured under a finger before this,
 * a message picker's emoji cell was 39.5x28 at 390 and 35.8x28 at 360, its
 * category tabs 28 tall and its search field 32.
 *
 * Written as `pointer-coarse:` utilities beside the sizes they replace rather
 * than as a component class in `index.css`, because every size here is already
 * a utility chosen per variant, and a component-layer rule loses to a utility
 * on the same element (rule 10 of docs/operations/interface-material.md).
 */
export function EmojiCategoryPicker({
  categories,
  onSelect,
  testIdPrefix,
  selected = null,
  allowEmpty = false,
  disabled = false,
  className,
  searchable = false,
  searchTerms = {},
  scrollable = false,
  compact = false,
  recent,
  gridClassName,
}: EmojiCategoryPickerProps) {
  const initialCategory = categories.find((category) =>
    selected ? category.emojis.includes(selected) : false,
  ) ?? categories[0];
  const [activeCategoryId, setActiveCategoryId] = useState(initialCategory?.id ?? "");
  const [query, setQuery] = useState("");
  const activeCategory = categories.find((category) => category.id === activeCategoryId) ?? categories[0];
  // Icons only when every category has one: a row that mixes words and icons
  // would read as two different controls. The folder picker keeps its words.
  const iconTabs = categories.length > 0 && categories.every((category) => Boolean(category.icon));

  const visibleEmojis = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    if (!needle) return activeCategory?.emojis ?? [];

    const seen = new Set<string>();
    return categories.flatMap((category) =>
      category.emojis
        .filter((emoji) => {
          const haystack = `${emoji} ${category.label} ${searchTerms[emoji] ?? ""}`.toLocaleLowerCase("ru-RU");
          return haystack.includes(needle);
        })
        .filter((emoji) => {
          if (seen.has(emoji)) return false;
          seen.add(emoji);
          return true;
        }),
    );
  }, [activeCategory?.emojis, categories, query, searchTerms]);

  if (!activeCategory) return null;

  return (
    <div data-testid={`${testIdPrefix}-picker`} className={cn(compact ? "space-y-1.5" : "space-y-2", className)}>
      {recent && recent.length > 0 && (
        <div data-testid={`${testIdPrefix}-recent`} className="space-y-1">
          <div className="px-0.5 text-[12px] font-semibold text-[color:var(--kub-muted)]">Недавние</div>
          <div
            role="group"
            aria-label="Недавние"
            className="grid grid-cols-8 gap-1 pointer-coarse:grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]"
          >
            {recent.map((emoji) => (
              <EmojiOption
                key={emoji}
                label={`Выбрать ${emoji}`}
                active={selected === emoji}
                disabled={disabled}
                onClick={() => onSelect(emoji)}
                compact={compact}
              >
                {emoji}
              </EmojiOption>
            ))}
          </div>
        </div>
      )}

      {searchable && (
        <label className={cn(
          "flex items-center gap-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] px-2.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]",
          compact ? "h-8" : "h-9",
          "pointer-coarse:h-11",
        )}>
          <KubIcon name="search" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            data-testid={`${testIdPrefix}-search`}
            placeholder="Найти эмодзи"
            className="min-w-0 flex-1 bg-transparent text-xs text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              // Under a finger the clear button takes the field's full height
              // and its right end, rather than the 20px square around its icon.
              className="rounded-md p-1 text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)] hover:text-[color:var(--kub-text)] pointer-coarse:-my-px pointer-coarse:-mr-2.5 pointer-coarse:flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center"
              aria-label="Очистить поиск эмодзи"
            >
              <KubIcon name="close" size={12} />
            </button>
          )}
        </label>
      )}

      <div
        data-testid={`${testIdPrefix}-categories`}
        className={cn(
          "gap-1 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] p-1",
          // Icons, as Telegram draws its categories: one row of equal tabs under
          // a cursor, and under a finger 44px tabs in a row that scrolls when
          // they do not all fit — eight of them do not at 390px. Without gaps
          // there, the last tab that does not fit shows most of itself, which
          // is what says the row goes on; with them it was hidden whole.
          iconTabs ? "flex pointer-coarse:gap-0 pointer-coarse:overflow-x-auto pointer-coarse:overscroll-x-contain" : "grid",
        )}
        style={iconTabs ? undefined : { gridTemplateColumns: `repeat(${Math.min(categories.length, 4)}, minmax(0, 1fr))` }}
        aria-label="Категории эмодзи"
      >
        {categories.map((category) => {
          const active = category.id === activeCategory.id;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => {
                setActiveCategoryId(category.id);
                setQuery("");
              }}
              disabled={disabled}
              data-state={active ? "active" : "inactive"}
              aria-pressed={active}
              // An icon tab keeps its category's word as its name and its hint.
              aria-label={iconTabs ? category.label : undefined}
              title={iconTabs ? category.label : undefined}
              className={cn(
                "min-w-0 rounded-md font-semibold transition-colors disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
                iconTabs
                  ? cn("flex flex-1 items-center justify-center", compact ? "min-h-7" : "min-h-8", "pointer-coarse:min-h-11 pointer-coarse:min-w-11")
                  : cn(
                      "truncate px-1.5",
                      compact ? "min-h-7 text-[9px]" : "min-h-8 text-[12px]",
                      // The compact label was cut to 9px to fit a 28px tab. A
                      // tab a finger can hit has the room back, so it reads at
                      // the size the regular picker uses.
                      "pointer-coarse:min-h-11 pointer-coarse:text-[12px]",
                    ),
                active
                  ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                  : "text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)] hover:text-[color:var(--kub-text)]",
              )}
            >
              {iconTabs && category.icon ? <KubIcon name={category.icon} size={compact ? 16 : 18} /> : category.label}
            </button>
          );
        })}
      </div>

      <div
        data-testid={`${testIdPrefix}-grid`}
        className={cn(
          "grid grid-cols-8 gap-1",
          // Under a finger the columns follow the width: as many 44px columns
          // as fit. Eight fixed columns were 35.8px wide at 360.
          "pointer-coarse:grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]",
          // And the window is bounded by the screen as well, so a phone held
          // sideways keeps the picker on screen with two rows to scroll.
          scrollable && (compact ? "max-h-40 pointer-coarse:max-h-[min(10rem,25dvh)]" : "max-h-52"),
          scrollable && "overflow-y-auto overscroll-contain pr-1",
          gridClassName,
        )}
        aria-label={`Эмодзи: ${activeCategory.label}`}
      >
        {allowEmpty && (
          <EmojiOption
            label="Без иконки"
            active={selected === null}
            disabled={disabled}
            onClick={() => onSelect(null)}
            compact={compact}
          >
            —
          </EmojiOption>
        )}
        {visibleEmojis.map((emoji) => (
          <EmojiOption
            key={emoji}
            label={`Выбрать ${emoji}`}
            active={selected === emoji}
            disabled={disabled}
            onClick={() => onSelect(emoji)}
            compact={compact}
          >
            {emoji}
          </EmojiOption>
        ))}
        {visibleEmojis.length === 0 && (
          <div className="col-span-full py-6 text-center text-xs text-[color:var(--kub-muted)]">
            Эмодзи не найден
          </div>
        )}
      </div>
    </div>
  );
}

interface EmojiOptionProps {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: string;
  compact: boolean;
}

function EmojiOption({ label, active, disabled, onClick, children, compact }: EmojiOptionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-w-0 items-center justify-center rounded-lg border text-lg leading-none transition-[background-color,border-color,transform] active:scale-95 disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
        compact ? "h-7" : "h-9",
        // The glyph grows with the cell, to the size the phone's quick
        // reaction row already uses in its 44px buttons.
        "pointer-coarse:h-11 pointer-coarse:text-2xl",
        active
          ? "border-[var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-cyan)_18%,var(--kub-surface-2))] kub-glow-soft"
          : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] hover:border-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-3)]",
      )}
    >
      {children}
    </button>
  );
}
