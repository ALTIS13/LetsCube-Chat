"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { EmojiCategory } from "@/lib/emojiCatalog";

interface EmojiCategoryPickerProps {
  categories: readonly EmojiCategory[];
  onSelect: (emoji: string | null) => void;
  testIdPrefix: string;
  selected?: string | null;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
}

export function EmojiCategoryPicker({
  categories,
  onSelect,
  testIdPrefix,
  selected = null,
  allowEmpty = false,
  disabled = false,
  className,
}: EmojiCategoryPickerProps) {
  const initialCategory = categories.find((category) =>
    selected ? category.emojis.includes(selected) : false,
  ) ?? categories[0];
  const [activeCategoryId, setActiveCategoryId] = useState(initialCategory?.id ?? "");
  const activeCategory = categories.find((category) => category.id === activeCategoryId) ?? categories[0];

  if (!activeCategory) return null;

  return (
    <div data-testid={`${testIdPrefix}-picker`} className={cn("space-y-2", className)}>
      <div
        data-testid={`${testIdPrefix}-categories`}
        className="grid gap-1 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] p-1"
        style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}
        aria-label="Категории эмодзи"
      >
        {categories.map((category) => {
          const active = category.id === activeCategory.id;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategoryId(category.id)}
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
        className="grid grid-cols-8 gap-1"
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
        {activeCategory.emojis.map((emoji) => (
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
