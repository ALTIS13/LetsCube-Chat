"use client";

import { useEffect, useMemo, useState } from "react";
import { KubIcon } from "@/components/kub";
import {
  buildCommandResults,
  groupSearchResults,
  mergeSearchResults,
  parseSearchTypeSyntax,
  SearchEmptyState,
  SearchProfilePreview,
  SearchResultsList,
  useSearchResultActions,
} from "@/components/search/SearchShared";
import { getLocalChatSearchResults, useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useRoleAccess } from "@/hooks/useRole";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
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
    type: parsed.type === "command" ? "all" : parsed.type,
    enabled: parsed.query.length > 0 && parsed.type !== "command",
    limit: 24,
  });

  const commandResults = useMemo(
    () => buildCommandResults({ query: parsed.query, type: parsed.type, canAccessTasks, isStaff }),
    [canAccessTasks, isStaff, parsed.query, parsed.type],
  );

  const results = useMemo(() => {
    if (parsed.type === "command") return commandResults;
    const localFirst = parsed.type === "all" || parsed.type === "chat" ? localChatResults : [];
    const remoteResults = parsed.type === "all" ? [...commandResults, ...search.results] : search.results;
    return mergeSearchResults(localFirst, remoteResults, 32);
  }, [commandResults, localChatResults, parsed.type, search.results]);

  const grouped = useMemo(() => groupSearchResults(results), [results]);

  useEffect(() => {
    setActiveIndex(0);
  }, [parsed.query, parsed.type, results.length]);

  const showEmpty = parsed.query.length > 0 && !search.loading && results.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="sidebar-global-search-results">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--kub-border-color)] px-3 py-2">
        <div className="min-w-0 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
          Поиск
        </div>
        {search.loading && (
          <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--kub-muted)]">
            <KubIcon name="spinner" size={13} tone="accent" />
            Ищем
          </div>
        )}
      </div>

      {search.migrationMissing && parsed.type !== "command" && (
        <div className="mx-3 mt-3 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
          Поиск по всей истории требует обновления базы данных. Сейчас доступны видимые чаты, загруженные сообщения, пользователи, задачи и локации.
        </div>
      )}

      {search.error && (
        <div className="mx-3 mt-3 rounded-xl border border-[color-mix(in_srgb,var(--kub-warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--kub-warn)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-warn)]">
          {search.error}
        </div>
      )}

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
