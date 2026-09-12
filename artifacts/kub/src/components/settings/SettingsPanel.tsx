"use client";

import { useMemo, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { SettingsErrorNotice, useSettingsScreen } from "@/components/settings/SettingsScreen";
import { settingsSearchResult } from "@/lib/settingsRows";
import { useAppStore } from "@/store/app.store";

/**
 * Settings as a state of the LIST COLUMN, from `md` (D-160).
 *
 * `Sidebar` swaps its body to this the same way it swaps to
 * `SidebarSearchResults` for a global query and to `ChatSearchPanel` for an
 * in-chat one. Those two are the precedent and this follows their shape rather
 * than inventing a third.
 *
 * Why the column and not the dialog. Measured at 1440 before the change: the
 * dialog was `xl` — 896px — on every screen, 62.2% of a 1440 and 46.7% of a
 * 1920, leaving 272px and then 512px of dead margin each side while it blurred
 * the whole application behind it. Its rows were 822px wide, so «Статус «в
 * сети»» stood 570px from the word «Виден» that is its value: a label and its
 * own value at opposite ends of a line is the phone's row list stretched to a
 * desktop, which is what the owner meant by «помесь телефона и десктопа». The
 * container was never the phone pattern here — `mobileSheet` only applies below
 * 640 and at 1440 that really was a centred desktop dialog.
 *
 * What the column buys, all of it measurable: the row is the column's width
 * instead of 822px, so a value sits beside its label or wraps under it; nothing
 * is covered and nothing is blurred, because this is not an overlay at all; and
 * the screen gains a search, which the dialog never had.
 *
 * No material of its own: it is the column's body, inside the one sheet of
 * glass `Sidebar` paints, exactly as the chat list and the two search surfaces
 * are (rule 1).
 */
export function SettingsPanel() {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const [query, setQuery] = useState("");
  const screen = useSettingsScreen({ onClose: closeSettings });

  const filtering = query.trim().length > 0;
  // The engine is `lib/settingsRows.ts`, which imports nothing and is reached
  // directly by `tests/unit/settings-search.test.mts`. The panel decides how a
  // result looks and never what matches — the split `useChatMessageSearch`
  // made, for the same reason: two forms of one screen must not drift.
  const { rows, sections, total } = useMemo(
    () => settingsSearchResult(query, { isStaff: screen.isStaff }),
    [query, screen.isStaff],
  );

  if (!screen.ready) return null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="sidebar-settings">
      {/* `--kub-rule`, not the sheet-edge colour: a line between two blocks of
          one surface, where the column's own edge is the heavier of the two
          (rule 11). The in-chat search panel's heading row is the same shape. */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-[color:var(--kub-rule)] px-3 py-2">
        <div className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
          Настройки
        </div>
        <button
          type="button"
          onClick={closeSettings}
          data-testid="settings-close"
          className="kub-icon-action kub-interactive flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
          aria-label="Закрыть настройки"
        >
          <KubIcon name="close" size={16} />
        </button>
      </div>

      {/* No perimeter on the well. The field is cut into `--kub-inset` and the
          step does the separating, as the in-chat search field is. */}
      <div className="flex-shrink-0 px-3 pt-3">
        <div className="kub-field h-9 min-w-0 gap-2 rounded-lg bg-[var(--kub-inset)] px-3 transition-all focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]">
          <KubIcon name="search" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
          <input
            data-testid="settings-search-input"
            type="text"
            placeholder="Поиск по настройкам…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              // Escape empties the field first and leaves on the second press,
              // so a long query is not lost to one keystroke — the same two
              // steps the in-chat search field takes.
              if (query) setQuery("");
              else closeSettings();
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="kub-icon-action kub-interactive shrink-0 rounded-md text-[color:var(--kub-muted)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
              aria-label="Очистить"
            >
              <KubIcon name="close" size={12} />
            </button>
          )}
        </div>
      </div>

      {filtering && (
        <div
          data-testid="settings-search-counter"
          className="flex-shrink-0 px-3 pt-2 text-xs tabular-nums text-[color:var(--kub-muted)]"
        >
          {total > 0
            ? `${total} в ${sections.length} ${sections.length === 1 ? "разделе" : "разделах"}`
            : "ничего не найдено"}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-4" data-testid="settings-scroll">
        {/* The account header is the screen's own identity, not a result. While
            a query is typed the column is showing what was asked for and
            nothing else — the same way a global query replaces the chat list
            rather than sitting under it. */}
        {!filtering && screen.identity}
        <SettingsErrorNotice error={screen.error} />
        {filtering && total === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-[color:var(--kub-muted)]">
            Ничего не найдено в настройках.
          </p>
        ) : (
          screen.body(filtering ? rows : null)
        )}
      </div>

      {/* Pinned, because the fields it saves can be scrolled away from — in the
          dialog this was the footer and it is the same button with the same
          three states. */}
      <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-[color:var(--kub-rule)] px-3 py-2">
        <KubButton
          onClick={() => void screen.save()}
          disabled={screen.saving}
          loading={screen.saving}
          variant={screen.saved ? "secondary" : "primary"}
          size="sm"
          leftIcon={!screen.saving ? <KubIcon name="check" size={13} /> : undefined}
        >
          {screen.saved ? "Сохранено" : "Сохранить"}
        </KubButton>
      </div>
    </div>
  );
}
