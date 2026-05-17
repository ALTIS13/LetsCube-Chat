"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KubIcon, KubModal } from "@/components/kub";
import {
  buildCommandResults,
  groupSearchResults,
  parseSearchTypeSyntax,
  SEARCH_FILTERS,
  SearchEmptyState,
  SearchProfilePreview,
  SearchResultsList,
  type SearchTypeFilter,
  useSearchResultActions,
} from "@/components/search/SearchShared";
import { type GlobalSearchDataType, useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useRoleAccess } from "@/hooks/useRole";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
import { KUB_GLOBAL_SEARCH_OPEN_EVENT, type GlobalSearchOpenDetail } from "@/lib/globalSearchEvents";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";

export function GlobalSearchPalette() {
  const currentUser = useAppStore((s) => s.currentUser);
  const [open, setOpen] = useState(false);
  const { canAccessTasks } = useTaskAccessGate({ enabled: open });
  const { isStaff } = useRoleAccess();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SearchTypeFilter>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const closePalette = useCallback(() => {
    setOpen(false);
    setActiveIndex(0);
  }, []);

  const {
    activateResult,
    openingChat,
    previewProfile,
    setPreviewProfile,
    openPreviewChat,
  } = useSearchResultActions({ onAfterOpen: closePalette });

  const parsed = useMemo(() => parseSearchTypeSyntax(query, typeFilter), [query, typeFilter]);
  const dataType: GlobalSearchDataType | "all" = parsed.type === "command" ? "all" : parsed.type;
  const search = useGlobalSearch({
    query: parsed.query,
    type: dataType,
    enabled: open && parsed.type !== "command",
    limit: 24,
  });

  const commandResults = useMemo(
    () => buildCommandResults({ query: parsed.query, type: parsed.type, canAccessTasks, isStaff }),
    [canAccessTasks, isStaff, parsed.query, parsed.type],
  );

  const results = useMemo(() => {
    const items =
      parsed.type === "command"
        ? commandResults
        : parsed.type === "all"
          ? [...commandResults, ...search.results]
          : search.results;
    return items.slice(0, 32);
  }, [commandResults, parsed.type, search.results]);

  const grouped = useMemo(() => groupSearchResults(results), [results]);

  const closeAll = useCallback(() => {
    closePalette();
    setPreviewProfile(null);
  }, [closePalette, setPreviewProfile]);

  const openPalette = useCallback((initialQuery = "") => {
    setOpen(true);
    setPreviewProfile(null);
    setQuery(initialQuery);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [setPreviewProfile]);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<GlobalSearchOpenDetail>).detail;
      const initialQuery = detail?.query ?? "";
      if (focusSidebarSearchInput(initialQuery)) return;
      openPalette(initialQuery);
    };
    window.addEventListener(KUB_GLOBAL_SEARCH_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(KUB_GLOBAL_SEARCH_OPEN_EVENT, handleOpen);
  }, [openPalette]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (focusSidebarSearchInput()) return;
        openPalette();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openPalette]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [parsed.query, parsed.type, results.length]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (results.length === 0 ? 0 : (index - 1 + results.length) % results.length));
      return;
    }
    if (event.key === "Enter") {
      const result = results[activeIndex];
      if (result) {
        event.preventDefault();
        void activateResult(result);
      }
    }
  };

  const showHint = parsed.query.length === 0;
  const showEmpty = !showHint && !search.loading && results.length === 0;

  if (!currentUser) return null;

  return (
    <KubModal
      open={open}
      onClose={closeAll}
      title="Глобальный поиск"
      description="Ctrl+K / Cmd+K"
      icon={<KubIcon name="search" size={18} />}
      size="lg"
      className="sm:max-w-3xl"
      contentClassName="p-0 overflow-hidden"
      mobileSheet
    >
      <div className="relative flex h-full min-h-0 flex-col" data-testid="global-search-palette">
        <div className="border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-4 py-3">
          <div className="flex h-11 items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 focus-within:border-[color:var(--kub-cyan)]">
            <KubIcon name="search" size={17} className="shrink-0 text-[color:var(--kub-muted)]" />
            <input
              ref={inputRef}
              data-testid="global-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Поиск по людям, чатам, сообщениям, задачам…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
              aria-label="Глобальный поиск"
            />
            {search.loading && <KubIcon name="spinner" size={15} tone="accent" />}
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="rounded-lg p-1 text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface)] hover:text-[color:var(--kub-text)]"
                aria-label="Очистить поиск"
              >
                <KubIcon name="close" size={14} />
              </button>
            )}
          </div>

          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
            {SEARCH_FILTERS.map((filter) => {
              const active = parsed.type === filter.id || (!query.match(/\btype:/i) && typeFilter === filter.id);
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setTypeFilter(filter.id)}
                  className={cn(
                    "h-8 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors",
                    active
                      ? "bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)] text-[color:var(--kub-cyan)]"
                      : "bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                  )}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          {search.migrationMissing && parsed.type !== "command" && (
            <div className="mt-3 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
              Поиск по всей истории требует обновления базы данных. Сейчас доступны видимые чаты, загруженные сообщения, пользователи, задачи и локации по RLS.
            </div>
          )}
          {search.error && (
            <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--kub-warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--kub-warn)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-warn)]">
              {search.error}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3">
          {showHint && (
            <div className="space-y-3 px-2 py-3">
              <div className="rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-4">
                <div className="text-sm font-semibold text-[color:var(--kub-text)]">Быстрый поиск</div>
                <div className="mt-1 text-xs leading-relaxed text-[color:var(--kub-muted)]">
                  Начните вводить имя, @username, чат, сообщение, задачу или локацию. Для фильтра можно набрать `type:user`, `type:message` или выбрать чип сверху.
                </div>
              </div>
              <SearchResultsList
                sections={groupSearchResults(commandResults)}
                activeIndex={activeIndex}
                onHover={setActiveIndex}
                onOpen={activateResult}
              />
            </div>
          )}

          {showEmpty && <SearchEmptyState />}

          {!showHint && !showEmpty && (
            <SearchResultsList
              sections={grouped}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onOpen={activateResult}
            />
          )}
        </div>

        {previewProfile && (
          <SearchProfilePreview
            profile={previewProfile}
            currentUserId={currentUser.id}
            opening={openingChat}
            onBack={() => setPreviewProfile(null)}
            onOpenChat={openPreviewChat}
          />
        )}
      </div>
    </KubModal>
  );
}

function focusSidebarSearchInput(initialQuery = ""): boolean {
  if (typeof window === "undefined") return false;
  if (window.innerWidth < 768) return false;
  const input = document.querySelector<HTMLInputElement>('[data-testid="sidebar-search-input"]');
  if (!input || input.offsetParent === null) return false;
  useAppStore.getState().setSearchQuery(initialQuery);
  input.focus();
  input.select();
  return true;
}
