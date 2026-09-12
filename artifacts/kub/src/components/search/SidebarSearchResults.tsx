"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KubHint, KubIcon } from "@/components/kub";
import {
  buildCommandResults,
  groupSearchResults,
  mergeSearchResults,
  parseSearchTypeSyntax,
  SearchEmptyState,
  SearchFilterChips,
  SearchProfilePreview,
  SearchResultsList,
  SearchTypeFilters,
  useSearchResultActions,
  type SearchTypeFilter,
} from "@/components/search/SearchShared";
import { getLocalChatSearchResults, useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useHint } from "@/hooks/useHint";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRoleAccess } from "@/hooks/useRole";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
import {
  clearTypeSyntax,
  SEARCH_SYNTAX_HINT_ID,
  SEARCH_SYNTAX_HINT_TEXT,
  shouldOfferSearchSyntaxHint,
  typeFilterToDataType,
} from "@/lib/searchQuery";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";

export function SidebarSearchResults({ query }: { query: string }) {
  const trimmedQuery = query.trim();
  const currentUser = useAppStore((s) => s.currentUser);
  const chats = useAppStore((s) => s.chats);
  const selectedChatId = useAppStore((s) => s.selectedChatId);
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

  // The type chosen by tapping a pill. `parseSearchTypeSyntax` takes it as the
  // seed for `filters.type` and lets a `type:` token in the text overwrite it,
  // so the typed syntax wins a conflict — see `clearTypeSyntax` for why that is
  // the right way round, and for the other half that stops a tap ever creating
  // one. No reset effect is needed: `Sidebar` mounts this surface only while a
  // query is typed, so clearing the field unmounts it and the state goes with
  // it, which is «Все» again on the way back in.
  const [selectedType, setSelectedType] = useState<SearchTypeFilter>("all");
  const parsed = useMemo(() => parseSearchTypeSyntax(trimmedQuery, selectedType), [selectedType, trimmedQuery]);

  // The pills cover the types; nothing covers the rest of the grammar. See
  // `shouldOfferSearchSyntaxHint` for when it is offered and why using the
  // syntax withdraws it rather than dismissing it.
  //
  // The pane gate is not belt-and-braces. Below `md` the shell **hides** this
  // column — `isMobileChatOpen ? "hidden" : "flex"` in `MainLayout` — rather
  // than unmounting it, so with a chat open this surface is still mounted with
  // its query, and a popover anchored here would portal over the conversation.
  // That is the same `display:none` anchor that put the administration hint's
  // plate over the chat list on 2026-09-12, where it swallowed the pointer.
  const isPhone = useIsMobile();
  const paneOnScreen = !(isPhone && Boolean(selectedChatId));
  const syntaxHint = useHint(SEARCH_SYNTAX_HINT_ID, {
    enabled: paneOnScreen && shouldOfferSearchSyntaxHint(parsed),
  });
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

  // Only while nothing is filtered. Once a type is chosen the set is narrowed
  // to it, so every other count would read 0 — which is unknown stated as
  // empty. See the note on `SearchTypeFilters`.
  const typeCounts = useMemo(() => {
    if (parsed.filters.type !== "all") return null;
    const counts: Partial<Record<SearchTypeFilter, number>> = { all: results.length };
    for (const result of results) {
      counts[result.resultType] = (counts[result.resultType] ?? 0) + 1;
    }
    return counts;
  }, [parsed.filters.type, results]);

  const chooseType = useCallback(
    (next: SearchTypeFilter) => {
      setSelectedType(next);
      // Strip any `type:` token first, so the tap cannot lose to the text. The
      // ranges are measured against `parsed.raw`, which is the trimmed query
      // this surface parsed — passing the untrimmed one would shift every
      // offset by the leading whitespace.
      const stripped = clearTypeSyntax(parsed);
      if (stripped !== parsed.raw) setSearchQuery(stripped);
    },
    [parsed, setSearchQuery],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [parsed.query, parsed.filters.type, results.length]);

  const showEmpty = parsed.query.length > 0 && !search.loading && results.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="sidebar-global-search-results">
      {/* Flush under the search field — above the «ПОИСК» heading, not below it.
          Telegram has no heading between its field and its pill row, and the row
          belongs to the field: it narrows the query. Everything after it is about
          the results — the heading and its rule, the two database notices, and the
          chips of whatever the typed query happened to produce. Those chips stay
          down there on purpose: that row comes and goes, and a row that appears
          must not shove the results down from the top of the column.

          An earlier attempt at this moved the row above the notices only, which
          left the heading still standing between the field and the pills and
          changed nothing a reader could see.

          `active` is the *effective* type rather than the pill state, so a typed
          `type:chat` lights «Чаты» up and the control can never disagree with the
          text about what is being filtered. */}
      {/* The plate hangs under the row and lands on the results, which are
          content — never on the field, which is where a person is typing.
          `SearchTypeFilters` is a function component and cannot take a ref, so
          the anchor is this wrapper rather than the row itself. */}
      <KubHint
        open={syntaxHint.visible}
        onDismiss={syntaxHint.dismiss}
        side="bottom"
        align="start"
        text={SEARCH_SYNTAX_HINT_TEXT}
      >
        <div>
          <SearchTypeFilters active={parsed.filters.type} counts={typeCounts} onSelect={chooseType} compact />
        </div>
      </KubHint>

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


      {/* `parsed.raw`, not `query`: a chip carries the offsets it was measured
          at, and it was measured against the trimmed string this surface parsed.
          Handing it the untrimmed one cut a range shifted by every leading
          space, so removing a chip from a query typed with a leading space
          deleted the wrong characters. */}
      <SearchFilterChips parsed={parsed} query={parsed.raw} onChangeQuery={setSearchQuery} compact />

      <div
        // The floating capsule lies over this column on a phone. The room for
        // it is reserved inside the scroller, exactly as `ChatList` reserves
        // it — shrinking the container instead leaves a band of ground in the
        // shape of the old bar, which is the mistake that was made once
        // already. Below `md` only, because the capsule is `md:hidden`;
        // above it the original bottom padding stands.
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-2 py-3 pb-[calc(var(--kub-bottom-nav)+var(--kub-bottom-nav-gap)*2)] md:pb-3",
          search.migrationMissing && "pt-2",
        )}
      >
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
