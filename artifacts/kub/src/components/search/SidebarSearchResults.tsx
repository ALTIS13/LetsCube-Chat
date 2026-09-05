"use client";

import { useEffect, useMemo, useState } from "react";
import { KubIcon } from "@/components/kub";
import {
  buildCommandResults,
  groupSearchResults,
  mergeSearchResults,
  parseSearchTypeSyntax,
  SearchEmptyState,
  SearchFilterChips,
  SearchProfilePreview,
  SearchResultsList,
  useSearchResultActions,
} from "@/components/search/SearchShared";
import { getLocalChatSearchResults, useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useRoleAccess } from "@/hooks/useRole";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
import { typeFilterToDataType } from "@/lib/searchQuery";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";

export function SidebarSearchResults({ query }: { query: string }) {
  const trimmedQuery = query.trim();
  const currentUser = useAppStore((s) => s.currentUser);
  const chats = useAppStore((s) => s.chats);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const { canAccessTasks } = useTaskAccessGate({ enabled: trimmedQuery.length > 0 });
  const { isStaff } = useRoleAccess();
  const {
    activateResult,
    openingChat,
    previewProfile,
    setPreviewProfile,
    openPreviewChat,
  } = useSearchResultActions({ onAfterOpen: () => setSearchQuery("") });

  const parsed = useMemo(() => parseSearchTypeSyntax(trimmedQuery, "all"), [trimmedQuery]);
  const localChatResults = useMemo(
    () => getLocalChatSearchResults({
      query: parsed.query,
      currentUserId: currentUser?.id ?? null,
      chats,
      limit: 8,
    }),
    [chats, currentUser?.id, parsed.query],
  );

  const search = useGlobalSearch({
    query: parsed.query,
    type: typeFilterToDataType(parsed.filters.type),
    filters: parsed.filters,
    enabled: parsed.filters.type !== "command" && (parsed.query.length > 0 || parsed.hasAdvancedFilters),
    limit: 24,
  });

  const commandResults = useMemo(
    () => buildCommandResults({ query: parsed.query, type: parsed.filters.type, canAccessTasks, isStaff }),
    [canAccessTasks, isStaff, parsed.query, parsed.filters.type],
  );

  const results = useMemo(() => {
    if (parsed.filters.type === "command") return commandResults;
    const canUseLocalChatMatches =
      (parsed.filters.type === "all" || parsed.filters.type === "chat") &&
      !parsed.filters.from &&
      parsed.filters.has.length === 0;
    const localFirst = canUseLocalChatMatches ? localChatResults : [];
    const remoteResults = parsed.filters.type === "all" ? [...commandResults, ...search.results] : search.results;
    return mergeSearchResults(localFirst, remoteResults, 32);
  }, [commandResults, localChatResults, parsed.filters.from, parsed.filters.has.length, parsed.filters.type, search.results]);

  const grouped = useMemo(() => groupSearchResults(results), [results]);

  useEffect(() => {
    setActiveIndex(0);
  }, [parsed.query, parsed.filters.type, results.length]);

  const showEmpty = parsed.query.length > 0 && !search.loading && results.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="sidebar-global-search-results">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--kub-border-color)] px-3 py-2">
        <div className="min-w-0 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
          Поиск
        </div>
        {search.loading && (
          <div className="flex items-center gap-1.5 text-[12px] text-[color:var(--kub-muted)]">
            <KubIcon name="spinner" size={13} tone="accent" />
            Ищем
          </div>
        )}
      </div>

      {search.migrationMissing && parsed.filters.type !== "command" && (
        <div className="kub-raise mx-3 mt-3 rounded-xl px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
          Поиск по всей истории требует обновления базы данных. Сейчас доступны видимые чаты, загруженные сообщения, пользователи, задачи и локации.
        </div>
      )}

      {search.filtersLimited && (
        <div className="kub-raise mx-3 mt-3 rounded-xl px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
          Расширенные фильтры по всей истории требуют обновления базы данных. Сейчас поиск применяет доступные локальные фильтры.
        </div>
      )}

      {search.error && (
        <div className="mx-3 mt-3 rounded-xl border border-[color-mix(in_srgb,var(--kub-warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--kub-warn)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-warn)]">
          {search.error}
        </div>
      )}

      <SearchFilterChips parsed={parsed} query={query} onChangeQuery={setSearchQuery} compact />

      <div className={cn("min-h-0 flex-1 overflow-y-auto px-2 py-3", search.migrationMissing && "pt-2")}>
        {showEmpty ? (
          <SearchEmptyState compact />
        ) : (
          <SearchResultsList
            sections={grouped}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onOpen={activateResult}
            compact
            testIdPrefix="sidebar-search-result"
          />
        )}
      </div>

      {previewProfile && currentUser && (
        <SearchProfilePreview
          profile={previewProfile}
          currentUserId={currentUser.id}
          opening={openingChat}
          onBack={() => setPreviewProfile(null)}
          onOpenChat={openPreviewChat}
          compact
        />
      )}
    </div>
  );
}
