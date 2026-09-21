"use client";

import { BotTag } from "@/components/bots/BotTag";
import { useCallback } from "react";
import { useLocation } from "wouter";
import { KubIcon } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useAvatarMediaUrl } from "@/hooks/useMediaObjectUrl";
import { EDGE_ARROW_CLASS, useEdgeScroll } from "@/hooks/useEdgeScroll";
import type { GlobalSearchResult, GlobalSearchResultType } from "@/hooks/useGlobalSearch";
import { useRoleAccess } from "@/hooks/useRole";
import { showAppAlert } from "@/lib/appDialogs";
import { createBotChat, findBotChats } from "@/lib/botCallback";
import {
  BOT_CHAT_OPEN_FAILED,
  BOT_CHAT_UNAVAILABLE,
  chooseBotChat,
} from "@/lib/botChatSurfaces";
import { CHAT_OPEN_SIGNED_OUT } from "@/lib/plainMessages";
import { requestChatMessageJump } from "@/lib/chatJumpEvents";
import { FOCUS_RING, PRESS_FILLED, PRESS_SINK_RAISED } from "@/lib/controlSurface";
import { safeOpenChat } from "@/lib/safeOpenChat";
import {
  parseAdvancedSearchQuery,
  removeSearchChip,
  type ParsedSearchQuery,
  type SearchEntityFilter,
} from "@/lib/searchQuery";
import { cn } from "@/lib/utils";
import { LOCATION_RESULT_PATH, canOpenLocationResult } from "@/lib/searchResultAccess";
import { useAppStore } from "@/store/app.store";
import { chatAddressPath } from "@/lib/chatRoute";

export type SearchTypeFilter = SearchEntityFilter;

export const SEARCH_FILTERS: { id: SearchTypeFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "user", label: "Люди" },
  { id: "bot", label: "Боты" },
  { id: "chat", label: "Чаты" },
  { id: "message", label: "Сообщения" },
  { id: "task", label: "Задачи" },
  { id: "location", label: "Локации" },
  { id: "media", label: "Медиа" },
  { id: "command", label: "Команды" },
];

export const SEARCH_SECTION_LABELS: Record<GlobalSearchResultType, string> = {
  user: "Люди",
  bot: "Боты",
  chat: "Чаты",
  message: "Сообщения",
  task: "Задачи",
  location: "Локации",
  command: "Команды",
};

export function SearchResultsList({
  sections,
  activeIndex = -1,
  onHover,
  onOpen,
  compact = false,
  testIdPrefix = "global-search-result",
}: {
  sections: { type: GlobalSearchResultType; results: GlobalSearchResult[]; startIndex: number }[];
  activeIndex?: number;
  onHover?: (index: number) => void;
  onOpen: (result: GlobalSearchResult) => void | Promise<void>;
  compact?: boolean;
  testIdPrefix?: string;
}) {
  if (sections.length === 0) return null;
  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {sections.map((section) => (
        <SearchSection
          key={section.type}
          type={section.type}
          title={SEARCH_SECTION_LABELS[section.type]}
          results={section.results}
          activeIndex={activeIndex}
          startIndex={section.startIndex}
          onHover={onHover}
          onOpen={onOpen}
          compact={compact}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </div>
  );
}

export function SearchSection({
  type,
  title,
  results,
  activeIndex,
  startIndex,
  onHover,
  onOpen,
  compact = false,
  testIdPrefix = "global-search-result",
}: {
  type: GlobalSearchResultType;
  title: string;
  results: GlobalSearchResult[];
  activeIndex: number;
  startIndex: number;
  onHover?: (index: number) => void;
  onOpen: (result: GlobalSearchResult) => void | Promise<void>;
  compact?: boolean;
  testIdPrefix?: string;
}) {
  if (results.length === 0) return null;
  return (
    <section data-search-section={type}>
      <div className={cn(
        "px-2 pb-1 text-[12px] font-bold uppercase tracking-[0.16em] text-[color:var(--kub-muted)]",
        compact && "px-1.5 text-[12px]",
      )}>
        {title}
      </div>
      <div className="space-y-1">
        {results.map((result, offset) => {
          const index = startIndex + offset;
          const active = activeIndex === index;
          return (
            <button
              key={`${result.resultType}:${result.id}`}
              type="button"
              data-testid={`${testIdPrefix}-${result.resultType}`}
              data-search-result-type={result.resultType}
              onMouseEnter={() => onHover?.(index)}
              onClick={() => void onOpen(result)}
              className={cn(
                "flex w-full min-w-0 items-center gap-3 rounded-2xl text-left transition-colors",
                compact ? "px-2.5 py-2" : "px-3 py-2.5",
                // The keyboard cursor mixes into transparent, not into
                // --kub-surface-2: mixing into a surface makes the row opaque
                // and pins it to an elevation the panel around it has already
                // passed. The hover is the veil for the same reason.
                active
                  ? "bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]"
                  : "kub-raise-hover",
              )}
            >
              <SearchResultIcon result={result} compact={compact} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className={cn("truncate font-semibold text-[color:var(--kub-text)]", compact ? "text-[13px]" : "text-sm")}>
                    {result.title}
                  </span>
                  {result.resultType === "bot" && <BotTag />}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[color:var(--kub-muted)]">
                  {result.subtitle && <span className="truncate">{result.subtitle}</span>}
                  {result.snippet && (
                    <>
                      {result.subtitle && <span className="shrink-0">·</span>}
                      <span className="truncate">{cleanSnippet(result.snippet)}</span>
                    </>
                  )}
                </div>
              </div>
              <KubIcon name="chevronRight" size={compact ? 13 : 15} className="shrink-0 text-[color:var(--kub-muted)]" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function SearchEmptyState({
  title = "Ничего не найдено",
  description = "Попробуйте имя, @никнейм, название чата, фразу из сообщения или фильтр по типу.",
  compact = false,
}: {
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 text-center", compact ? "min-h-[180px]" : "min-h-[220px]")}>
      <span className="kub-raise mb-3 flex h-12 w-12 items-center justify-center rounded-2xl text-[color:var(--kub-muted)]">
        <KubIcon name="search" size={22} />
      </span>
      <div className="text-sm font-semibold text-[color:var(--kub-text)]">{title}</div>
      <div className="mt-1 max-w-sm text-xs leading-relaxed text-[color:var(--kub-muted)]">{description}</div>
    </div>
  );
}

/**
 * The type filters, as a row of pills under the search field.
 *
 * `SEARCH_FILTERS` has always held these nine, and until this row existed
 * nothing consumed it: the only way to narrow results by type was to type
 * `type:message` into the query, with no control anywhere that offered it.
 * This is that control, built from the same list — not a second vocabulary
 * beside it.
 *
 * Telegram's arrangement, from the folder row it puts directly under its own
 * search field: fully rounded pills, scrolled sideways, the chosen one filled,
 * the rest muted and unbordered, counts as small secondary badges. `FolderTabs`
 * is this product's own version of that row and the metrics come from it — the
 * 12px semibold label, the horizontal scroll, the accent language. Two things
 * are deliberately not copied from it:
 *
 *  - **its underline.** That is a tab's active treatment and cannot be worn by
 *    a pill; a fill is what the reference shows and what reads at this size.
 *  - **its uppercase.** «Сообщения» set in capitals is both long and loud, and
 *    the two rows never appear together — `Sidebar` mounts the folder strip
 *    only while no query is typed, and this one only while one is — so there is
 *    no inconsistency to see.
 *
 * The active fill is `--kub-cyan` with `--kub-bg` ink, which is the pair this
 * product has already measured; `text-white` on the accent is 3.55:1 and is
 * held out by `control-vocabulary`. The inactive pill rests on `kub-raise` and
 * answers the cursor by changing its *text* colour only: a resting veil plus a
 * hover veil is the 1.002 of rule 5, a hover that has stopped existing. Neither
 * state carries a border — rule 11's nested box, separated by a step of
 * material — so the row adds nothing to the perimeter ratchet.
 *
 * Counts are shown only while nothing is filtered, and that is honesty rather
 * than restraint. Once a type is chosen the query is narrowed to it, so every
 * other type's result count is unknown — not zero. Rendering the zeros would
 * state, in the one place a person looks to decide where to go next, that there
 * is nothing there.
 *
 * The row scrolls, and since D-156 it says so. Nine pills do not fit a 360px
 * column and `overflow-x-auto no-scrollbar` drew no bar, no fade and no arrow,
 * so four of the nine types did not exist as far as a reader was concerned and
 * a mouse without a horizontal wheel had nothing to grab. The mechanism is
 * `useEdgeScroll` — `FolderTabs`' own, lifted out of it so this is the same row
 * behaviour rather than a second implementation of it.
 */
export function SearchTypeFilters({
  active,
  counts,
  onSelect,
  compact = false,
}: {
  active: SearchTypeFilter;
  /** Results per type in the current set, or null while a type is chosen. */
  counts: Partial<Record<SearchTypeFilter, number>> | null;
  onSelect: (type: SearchTypeFilter) => void;
  compact?: boolean;
}) {
  // `FolderTabs`' mechanism, not a second copy of it. `revision` is what tells
  // the hook to measure again: the counts appear and disappear with the choice,
  // which changes the row's content width while the row's own box keeps its
  // size — and an observer watching that box cannot see it.
  const { scrollRef, canScrollLeft, canScrollRight, handleWheel, arrowProps } = useEdgeScroll<HTMLDivElement>({
    revision: `${active}:${counts ? "counts" : "bare"}`,
  });

  return (
    // No surface of its own, for the reason `FolderTabs` gives: this sits
    // inside the sidebar's glass, and a second fill here would read as an
    // opaque band punched through the panel. The wrapper earns its place by
    // being the containing block for the arrows: they are pinned to its edges
    // and overlay the row's own padding, so each fade starts at the edge of the
    // column rather than one pill inside it.
    <div className={cn("relative flex items-center", compact ? "px-3 py-2" : "mt-2 pb-0.5")}>
      {canScrollLeft && (
        <button
          {...arrowProps("left", "Прокрутить фильтры влево")}
          // Hidden below `md`. The row is dragged on a phone, as Telegram's own
          // is, and there the arrow is drawn over the pill text: the box is about
          // 26px, so the fade never reaches transparency, and `--glass-fill` is
          // translucent — over a filled pill it hides nothing. `FolderTabs` keeps
          // its arrows at every width because it shipped that way; the gate is
          // here rather than in the hook so it cannot spread to it.
          className={cn(EDGE_ARROW_CLASS.left, "hidden md:flex")}
        >
          <KubIcon name="chevronLeft" size={14} />
        </button>
      )}

      {/* The scrolling element keeps the group role and the test id: it is the
          row of pills, and what a reader and a spec are pointed at should not
          become a positioning wrapper because one was needed. */}
      <div
        role="group"
        aria-label="Фильтр по типу"
        data-testid="search-type-filters"
        ref={scrollRef}
        onWheel={handleWheel}
        className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto no-scrollbar"
      >
        {SEARCH_FILTERS.map((filter) => {
          const isActive = filter.id === active;
          const count = counts?.[filter.id] ?? 0;
          return (
            <button
              key={filter.id}
              type="button"
              data-testid={`search-type-filter-${filter.id}`}
              data-active={isActive ? "true" : undefined}
              aria-pressed={isActive}
              onClick={() => onSelect(filter.id)}
              className={cn(
                // No `h-*` or `min-h-*`: `.kub-button` carries the 44px floor on
                // a coarse pointer, and a height utility on the same element
                // outranks it silently. Padding only.
                "kub-button kub-interactive flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold whitespace-nowrap transition-colors",
                FOCUS_RING,
                isActive
                  ? `bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] ${PRESS_FILLED}`
                  : `kub-raise text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] ${PRESS_SINK_RAISED}`,
              )}
            >
              <span>{filter.label}</span>
              {count > 0 && (
                // On the filled pill the number is the label's own ink on the
                // measured pair; giving it a chip of its own would dilute the
                // fill underneath it and cost contrast nobody has measured.
                <span
                  className={cn(
                    "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[12px] font-bold",
                    isActive ? "text-[color:var(--kub-bg)]" : "bg-[var(--kub-inset)] text-[color:var(--kub-muted)]",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {canScrollRight && (
        <button
          {...arrowProps("right", "Прокрутить фильтры вправо")}
          // Hidden below `md`. The row is dragged on a phone, as Telegram's own
          // is, and there the arrow is drawn over the pill text: the box is about
          // 26px, so the fade never reaches transparency, and `--glass-fill` is
          // translucent — over a filled pill it hides nothing. `FolderTabs` keeps
          // its arrows at every width because it shipped that way; the gate is
          // here rather than in the hook so it cannot spread to it.
          className={cn(EDGE_ARROW_CLASS.right, "hidden md:flex")}
        >
          <KubIcon name="chevronRight" size={14} />
        </button>
      )}
    </div>
  );
}

export function SearchFilterChips({
  parsed,
  query,
  onChangeQuery,
  compact = false,
}: {
  parsed: ParsedSearchQuery;
  query: string;
  onChangeQuery: (nextQuery: string) => void;
  compact?: boolean;
}) {
  if (parsed.chips.length === 0) return null;
  return (
    <div className={cn("flex gap-1.5 overflow-x-auto", compact ? "px-3 py-2" : "mt-2 pb-0.5")}>
      {parsed.chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          data-testid={`search-filter-chip-${chip.key}`}
          onClick={() => onChangeQuery(removeSearchChip(query, chip))}
          className={cn(
            "kub-raise inline-flex shrink-0 items-center gap-1 rounded-lg border border-[color:var(--kub-border-color)] font-semibold text-[color:var(--kub-muted)] transition hover:border-[color:var(--kub-cyan)] hover:text-[color:var(--kub-accent-text)]",
            compact ? "h-7 px-2 text-[12px]" : "h-8 px-2.5 text-xs",
          )}
          title="Убрать фильтр"
          aria-label={`Убрать фильтр: ${chip.label}`}
        >
          <span>{chip.label}</span>
          <KubIcon name="close" size={compact ? 11 : 12} />
        </button>
      ))}
    </div>
  );
}

/*
 * `SearchProfilePreview` — «Мини-профиль» — was deleted here on 2026-09-21.
 *
 * It was the third surface this product drew for a person, and the one
 * `docs/operations/reference-clients.md` §15.1 named as «the drift the
 * consolidation feared, arriving from the one direction nobody was
 * watching»: no badges, no presence, no escalation, and its fields taken
 * from whatever the search row happened to carry rather than from a read of
 * the person. Activating a person in the results now opens the profile
 * overlay (`openUserProfile(id, "named")`), which reads the same store both
 * real surfaces read.
 *
 * The one capability it had that neither of the others did — copying the
 * никнейм — moved rather than went: `components/profile/ProfileUsernameLine.tsx`
 * is now a shared leaf of both cards.
 */

function SearchResultIcon({ result, compact = false }: { result: GlobalSearchResult; compact?: boolean }) {
  // D-208. A bare `<img src={column}>`: the one avatar shape that does not
  // go through `AvatarImage`, so routing that component left this one
  // behind. Unconditional, because it sits above an early return. In
  // `"public"` mode it is `result.avatarUrl`, unchanged.
  const avatarUrl = useAvatarMediaUrl(result.avatarUrl);
  if (result.resultType === "user" && result.profile) {
    return <UserAvatar user={result.profile} size="sm" />;
  }
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", compact ? "h-8 w-8" : "h-8 w-8")}
      />
    );
  }
  const iconName =
    result.resultType === "bot"
      ? "bot"
      : result.resultType === "chat"
      ? "chatBubble"
      : result.resultType === "message"
        ? "chatRect"
        : result.resultType === "task"
          ? "tasks"
          : result.resultType === "location"
            ? "mapPin"
            : result.resultType === "command"
              ? "zap"
              : "user";
  return (
    // The slot an avatar would have filled, so it is cut into the row rather
    // than raised off it — and unlike the veil it does not move with the row's
    // state. Measured: veiled, this plate lightened under the cursor and under
    // the keyboard cursor until the cyan glyph on it fell to 2.73:1 and 2.65:1,
    // below the 3:1 a non-text shape needs. On --kub-inset it is 5.12:1 dark
    // and 4.70:1 light in every row state.
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--kub-inset)] text-[color:var(--kub-cyan)]">
      <KubIcon name={iconName} size={16} />
    </span>
  );
}

export function useSearchResultActions({ onAfterOpen }: { onAfterOpen?: () => void }) {
  const [, setLocation] = useLocation();
  const currentUser = useAppStore((s) => s.currentUser);
  const setMobileSection = useAppStore((s) => s.setMobileSection);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const { isStaff, isAdmin, checking: roleChecking } = useRoleAccess();
  const openUserProfile = useAppStore((s) => s.openUserProfile);

  const closeAfterOpen = useCallback(() => {
    onAfterOpen?.();
  }, [onAfterOpen]);

  /**
   * Opening a bot found in search (D-127).
   *
   * Two halves, and only one of them works on this deployment today:
   *
   *   - **A chat that already exists opens.** `chat_bot_members` is readable by
   *     an ordinary account, so the chats shared with this bot can be found and
   *     one of them opened, and that needs nothing new from the server. Before
   *     this, even an existing bot chat could not be reached from search.
   *   - **A chat that does not exist has to be created**, and
   *     `public.chat_bot_members` has SELECT and no other verb for
   *     `authenticated` — no INSERT grant, no INSERT policy, and no RPC that
   *     does it. So the create is asked for by name and, while nothing answers
   *     to that name, the person is told plainly rather than shown a modal that
   *     describes the deployment. `lib/botCallback.ts` carries the exact
   *     signature the server half needs.
   *
   * Deliberately not `openPrivateChat`: that RPC takes a `target_user_id` and
   * joins `profiles`, and a bot is neither. `bot-client-integration-contract`
   * pins that the two are not confused.
   */
  const openBotFromSearch = useCallback(
    async (botId: string) => {
      const me = useAppStore.getState().currentUser?.id;
      if (!me) {
        showAppAlert(CHAT_OPEN_SIGNED_OUT, "Бот");
        return;
      }
      const { candidates, mine } = await findBotChats(botId, me);
      let chatId = chooseBotChat(candidates, mine);
      if (!chatId) {
        const created = await createBotChat(botId);
        if (created.kind === "missing") {
          showAppAlert(BOT_CHAT_UNAVAILABLE, "Бот");
          return;
        }
        if (created.kind === "failed") {
          showAppAlert(BOT_CHAT_OPEN_FAILED, "Бот");
          return;
        }
        chatId = created.chatId;
      }
      const opened = await safeOpenChat(chatId, {
        unavailableMessage: BOT_CHAT_OPEN_FAILED,
        unavailableTitle: "Бот",
      });
      if (!opened) return;
      // The conversation's own address, never «/» (D-293). Since
      // `054bf8ee` a conversation has one, and `useChatAddress` gives the
      // newly selected chat that address the moment it is selected — so
      // pushing «/» afterwards is read by the reconciler as a Back press out
      // of the conversation and closes it again. Measured: the history trail
      // for a bot opened from search was «push /chat/<id>» then «push /», and
      // `selectedChatId` came back null.
      setLocation(chatAddressPath(chatId));
      closeAfterOpen();
    },
    [closeAfterOpen, setLocation],
  );

  const activateResult = useCallback(
    async (result: GlobalSearchResult) => {
      if (result.resultType === "command") {
        runSearchCommand(result.id, { setLocation, setMobileSection, setSearchQuery, closeAfterOpen });
        return;
      }

      if (result.resultType === "user") {
        // The third profile surface, closed (D-283's follow-up). This used to
        // set `previewProfile` and draw «Мини-профиль» — a sheet over the
        // results with no badges, no presence and no escalation, built from
        // whatever fields the search row happened to carry. The assessment
        // called it «the drift the consolidation feared, arriving from the one
        // direction nobody was watching», and it was right: it was a third
        // implementation of a person reading a fourth source.
        //
        // The opener is **named**, not a glance: a reader who typed a name and
        // chose a person from a list has asked for that person, and Discord
        // opens its full modal directly for every act of that kind — a route, a
        // user link, a widget card — reserving the popout for a face met in
        // passing (§15.1).
        //
        // The results are deliberately left standing underneath rather than
        // closed. That is what the sheet's «Назад к результатам» was for, and a
        // layer over them does it without a control that has to claim to know
        // where the reader came from.
        openUserProfile(result.id, "named");
        return;
      }

      if (result.resultType === "bot") {
        await openBotFromSearch(result.id);
        return;
      }

      if (result.resultType === "chat" && result.chatId) {
        const opened = await safeOpenChat(result.chatId, {
          unavailableMessage: "Чат недоступен или был удалён.",
          unavailableTitle: "Чат недоступен",
        });
        if (opened) {
      // The conversation's own address, never «/» (D-293). Since
      // `054bf8ee` a conversation has one, and `useChatAddress` gives the
      // newly selected chat that address the moment it is selected — so
      // pushing «/» afterwards is read by the reconciler as a Back press out
      // of the conversation and closes it again. Measured: the history trail
      // for a bot opened from search was «push /chat/<id>» then «push /», and
      // `selectedChatId` came back null.
          setLocation(chatAddressPath(result.chatId));
          closeAfterOpen();
        }
        return;
      }

      if (result.resultType === "message" && result.chatId && result.messageId) {
        const opened = await safeOpenChat(result.chatId, {
          unavailableMessage: "Сообщение недоступно или чат был удалён.",
          unavailableTitle: "Сообщение недоступно",
        });
        if (opened) {
          // The message's address, so a reload lands on the same message —
          // which is what `054bf8ee` built the second segment for.
          setLocation(chatAddressPath(result.chatId, result.messageId));
          closeAfterOpen();
          window.setTimeout(() => requestChatMessageJump(result.chatId!, result.messageId!), 250);
          window.setTimeout(() => requestChatMessageJump(result.chatId!, result.messageId!), 700);
        }
        return;
      }

      if (result.resultType === "task" && result.taskId) {
        setLocation(`/tasks?task=${encodeURIComponent(result.taskId)}`);
        closeAfterOpen();
        return;
      }

      if (result.resultType === "location") {
        // D-139, the second half of the same rule. The list already drops
        // what cannot be opened (`openableSearchResults`); this stops a row
        // that was drawn before the role read finished from acting. The gate
        // was `isStaff` and the route is `isAdmin`, so a manager used to be
        // navigated and silently redirected back to the dashboard.
        if (canOpenLocationResult({ isStaff, isAdmin, checking: roleChecking })) {
          setLocation(LOCATION_RESULT_PATH);
          closeAfterOpen();
        }
      }
    },
    [
      closeAfterOpen,
      isAdmin,
      isStaff,
      openBotFromSearch,
      roleChecking,
      setLocation,
      setMobileSection,
      setSearchQuery,
    ],
  );

  return {
    activateResult,
    currentUser,
  };
}

export function buildCommandResults({
  query,
  type,
  canAccessTasks,
  isStaff,
}: {
  query: string;
  type: SearchTypeFilter;
  canAccessTasks: boolean;
  isStaff: boolean;
}): GlobalSearchResult[] {
  if (type !== "all" && type !== "command") return [];
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  const commands: GlobalSearchResult[] = [
    {
      resultType: "command",
      id: "open-chats",
      title: "Открыть чаты",
      subtitle: "Перейти к мессенджеру",
      source: "command",
      rank: 100,
    },
    {
      resultType: "command",
      id: "focus-chat-search",
      title: "Поиск в списке чатов",
      subtitle: "Поиск по чатам, людям, сообщениям и задачам",
      source: "command",
      rank: 90,
    },
  ];

  if (canAccessTasks) {
    commands.push({
      resultType: "command",
      id: "open-tasks",
      title: "Открыть задачи",
      subtitle: "Задачи локации",
      source: "command",
      rank: 90,
    });
  }

  if (isStaff) {
    commands.push({
      resultType: "command",
      id: "open-admin",
      title: "Открыть админ-панель",
      subtitle: "Пользователи, роли, локации",
      source: "command",
      rank: 80,
    });
  }

  if (!needle) return commands;
  return commands.filter((command) => `${command.title} ${command.subtitle ?? ""}`.toLocaleLowerCase("ru-RU").includes(needle));
}

export function parseSearchTypeSyntax(query: string, selected: SearchTypeFilter): ParsedSearchQuery {
  return parseAdvancedSearchQuery(query, selected);
}

export function groupSearchResults(results: GlobalSearchResult[]): { type: GlobalSearchResultType; results: GlobalSearchResult[]; startIndex: number }[] {
  const groups: { type: GlobalSearchResultType; results: GlobalSearchResult[]; startIndex: number }[] = [];
  let cursor = 0;
  const order: GlobalSearchResultType[] = ["chat", "user", "bot", "message", "task", "location", "command"];
  for (const type of order) {
    const items = results.filter((result) => result.resultType === type);
    if (items.length === 0) continue;
    groups.push({ type, results: items, startIndex: cursor });
    cursor += items.length;
  }
  return groups;
}

export function mergeSearchResults(primary: GlobalSearchResult[], secondary: GlobalSearchResult[], limit: number): GlobalSearchResult[] {
  const seen = new Set<string>();
  const merged: GlobalSearchResult[] = [];
  for (const result of [...primary, ...secondary]) {
    const key = `${result.resultType}:${result.resultType === "chat" ? result.chatId ?? result.id : result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
    if (merged.length >= limit) break;
  }
  return merged;
}

function runSearchCommand(
  commandId: string,
  helpers: {
    setLocation: (to: string) => void;
    setMobileSection: (section: "chats" | "search" | "folders" | "profile") => void;
    setSearchQuery: (query: string) => void;
    closeAfterOpen: () => void;
  },
) {
  switch (commandId) {
    case "open-tasks":
      helpers.setLocation("/tasks");
      break;
    case "open-admin":
      helpers.setLocation("/admin");
      break;
    case "focus-chat-search":
      helpers.setLocation("/");
      helpers.setSearchQuery("");
      helpers.setMobileSection("search");
      break;
    case "open-chats":
    default:
      helpers.setLocation("/");
      helpers.setMobileSection("chats");
      break;
  }
  helpers.closeAfterOpen();
}

function cleanSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeUsernameSubtitle(value: string | null | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  return clean.replace(/^@+/, "") || null;
}
