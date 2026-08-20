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
}

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
}: EmojiCategoryPickerProps) {
  const initialCategory = categories.find((category) =>
    selected ? category.emojis.includes(selected) : false,
  ) ?? categories[0];
  const [activeCategoryId, setActiveCategoryId] = useState(initialCategory?.id ?? "");
  const [query, setQuery] = useState("");
  const activeCategory = categories.find((category) => category.id === activeCategoryId) ?? categories[0];

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
    <div data-testid={`${testIdPrefix}-picker`} className={cn("space-y-2", className)}>
      {searchable && (
        <label className="flex h-9 items-center gap-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] px-2.5 focus-within:border-[color:var(--kub-cyan)]">
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
              className="rounded-md p-1 text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)] hover:text-[color:var(--kub-text)]"
              aria-label="Очистить поиск эмодзи"
            >
              <KubIcon name="close" size={12} />
            </button>
          )}
        </label>
      )}

      <div
        data-testid={`${testIdPrefix}-categories`}
        className="grid gap-1 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] p-1"
        style={{ gridTemplateColumns: `repeat(${Math.min(categories.length, 4)}, minmax(0, 1fr))` }}
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
              className={cn(
                "min-w-0 min-h-8 truncate rounded-md px-1.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)] disabled:opacity-60",
                active
                  ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                  : "text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)] hover:text-[color:var(--kub-text)]",
              )}
            >
              {category.label}
            </button>
          );
        })}
      </div>

      <div
        data-testid={`${testIdPrefix}-grid`}
        className={cn(
          "grid grid-cols-8 gap-1",
          scrollable && "max-h-52 overflow-y-auto overscroll-contain pr-1",
        )}
        aria-label={`Эмодзи: ${activeCategory.label}`}
      >
        {allowEmpty && (
          <EmojiOption
            label="Без иконки"
            active={selected === null}
            disabled={disabled}
            onClick={() => onSelect(null)}
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
          >
            {emoji}
          </EmojiOption>
        ))}
        {visibleEmojis.length === 0 && (
          <div className="col-span-8 py-6 text-center text-xs text-[color:var(--kub-muted)]">
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
}

function EmojiOption({ label, active, disabled, onClick, children }: EmojiOptionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-9 min-w-0 items-center justify-center rounded-lg border text-lg leading-none transition-[background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)] active:scale-95 disabled:opacity-60",
        active
          ? "border-[var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-cyan)_18%,var(--kub-surface-2))] kub-glow-soft"
          : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] hover:border-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-3)]",
      )}
    >
      {children}
    </button>
  );
}
