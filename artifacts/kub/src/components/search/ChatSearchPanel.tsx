"use client";

import { useCallback, useMemo } from "react";
import { KubIcon } from "@/components/kub";
import { SearchFilterChips } from "@/components/search/SearchShared";
import { useChatMessageSearch } from "@/hooks/useChatMessageSearch";
import { requestChatMessageJump } from "@/lib/chatJumpEvents";
import { chatSearchResultTitle, formatSearchDate } from "@/lib/chatMessageSearch";
import { visibleConversation } from "@/lib/deletedMessages";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import type { MessageWithSender } from "@/types/database";

/**
 * In-chat search as a state of the LIST COLUMN, from `md`.
 *
 * `Sidebar` swaps its body to this the same way it swaps to
 * `SidebarSearchResults` for a global query — that surface is the precedent and
 * this one follows its shape rather than inventing a second one.
 *
 * Why the column and not the conversation. The overlay this replaces was the
 * phone's capsule worn at every width: measured at 1440 it was 969×214 holding
 * 320px of content, so its well showed two of seven matches whole and sliced a
 * third through its own text, rendered only the first six of the seven it had
 * counted, and covered 23% of the conversation being searched — while the
 * column beside it stood 360×900 showing fourteen chats nobody had asked about.
 * Here every match is rendered, the column scrolls, and the conversation is
 * covered by nothing.
 *
 * What it must keep, and does:
 *
 *  - the counter and the two steppers, because a person walks the matches with
 *    them rather than only clicking rows;
 *  - the jump landing on the exact message and highlighting it — the rows ask
 *    for it through `requestChatMessageJump`, the event the chat pane already
 *    listens to for notification and global-search jumps, so it is the one
 *    road and not a second copy of it;
 *  - the same engine as the phone's overlay (`useChatMessageSearch`), so the
 *    order of matches, the debounce and the fallback to loaded messages cannot
 *    differ between the two forms.
 *
 * No material of its own: it is the column's body, inside the one sheet of
 * glass `Sidebar` paints, exactly as the chat list and the global results are.
 */

const NO_MESSAGES: MessageWithSender[] = [];

const STEPPER =
  "kub-icon-action kub-interactive shrink-0 rounded-lg p-1.5 text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-cyan)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]";

export function ChatSearchPanel({ chatId }: { chatId: string }) {
  const chats = useAppStore((s) => s.chats);
  const held = useAppStore((s) => s.messages[chatId]);
  const selectedTopicId = useAppStore((s) => s.selectedTopicId);
  const closeChatSearch = useAppStore((s) => s.closeChatSearch);

  const chat = useMemo(() => chats.find((item) => item.id === chatId) ?? null, [chats, chatId]);
  const isForum = Boolean(chat?.is_forum);
  // The same conversation the pane draws: a private chat shows no deleted
  // message, so searching one must not offer a row that jumps to nothing.
  const conversation = useMemo(
    () => visibleConversation(held ?? NO_MESSAGES, chat?.type),
    [chat?.type, held],
  );

  // The topic goes with the request only for a forum. Elsewhere it is absent,
  // which is what every caller before this meant and keeps their jump on the
  // plain path — see `ChatMessageJumpDetail`.
  const onJumpTo = useCallback(
    (messageId: string, topicId?: string | null) => {
      requestChatMessageJump(chatId, messageId, isForum ? topicId ?? null : undefined);
    },
    [chatId, isForum],
  );

  const {
    query,
    setQuery,
    parsed,
    canSearch,
    results,
    total,
    idx,
    jumpTo,
    loading,
    rpcMissing,
    allTopics,
    setAllTopics,
  } = useChatMessageSearch({
    chatId,
    currentTopicId: selectedTopicId,
    isForum,
    messages: conversation,
    onJumpTo,
  });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="sidebar-chat-search">
      {/* `--kub-rule`, not the sheet-edge colour: a line between two blocks of
          one surface, where the column's own edge is the heavier of the two
          (rule 11). The global results' heading row is the same shape. */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-[color:var(--kub-rule)] px-3 py-2">
        <div className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
          Поиск в чате
        </div>
        {loading && <KubIcon name="spinner" size={13} tone="accent" />}
        <button
          type="button"
          onClick={closeChatSearch}
          data-testid="chat-search-close"
          className="kub-icon-action kub-interactive flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
          aria-label="Закрыть поиск в чате"
        >
          <KubIcon name="close" size={16} />
        </button>
      </div>

      {/* No perimeter on the well. The field is cut into `--kub-inset` and the
          step does the separating, as the composer's well does since the chat
          screen's option C; the sheet-edge colour is on a ratchet that only
          ever goes down (tests/unit/edge-vocabulary.test.mjs). */}
      <div className="flex-shrink-0 px-3 pt-3">
        <div className="kub-field h-9 min-w-0 gap-2 rounded-lg bg-[var(--kub-inset)] px-3 transition-all focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]">
          <KubIcon name="search" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
          <input
            autoFocus
            data-testid="chat-search-input"
            type="text"
            placeholder="Поиск в чате…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              // Escape empties the field first and leaves on the second press,
              // so a long query is not lost to one keystroke.
              if (query) setQuery("");
              else closeChatSearch();
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
          />
        </div>
      </div>

      {canSearch && (
        <div className="flex flex-shrink-0 items-center gap-1 px-3 pt-2">
          <span
            data-testid="chat-search-counter"
            className="min-w-0 flex-1 text-xs tabular-nums text-[color:var(--kub-muted)]"
          >
            {total > 0 ? `${idx + 1}/${total}` : "ничего не найдено"}
          </span>
          <button
            type="button"
            onClick={() => jumpTo(Math.max(0, idx - 1))}
            disabled={total === 0 || idx === 0}
            className={STEPPER}
            aria-label="Предыдущий"
            data-testid="chat-search-previous"
          >
            <KubIcon name="chevronUp" size={16} />
          </button>
          <button
            type="button"
            onClick={() => jumpTo(Math.min(total - 1, idx + 1))}
            disabled={total === 0 || idx === total - 1}
            className={STEPPER}
            aria-label="Следующий"
            data-testid="chat-search-next"
          >
            <KubIcon name="chevronDown" size={16} />
          </button>
        </div>
      )}

      <SearchFilterChips parsed={parsed} query={query} onChangeQuery={setQuery} compact />

      {(isForum || rpcMissing) && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 px-3 pt-2 text-[12px] text-[color:var(--kub-muted)]">
          {isForum && (
            <button
              type="button"
              onClick={() => setAllTopics((value) => !value)}
              className="kub-raise kub-interactive rounded-lg px-2 py-1 font-semibold transition hover:text-[color:var(--kub-accent-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
            >
              {allTopics ? "Все темы" : "Текущая тема"}
            </button>
          )}
          {rpcMissing && <span>Поиск сейчас выполняется по загруженным сообщениям.</span>}
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
        data-testid="chat-search-results"
      >
        {canSearch && total === 0 && (
          <p className="px-2 py-6 text-center text-xs text-[color:var(--kub-muted)]">
            Ничего не найдено в этом чате.
          </p>
        )}
        {/* Every match, not the first six. The column is the room the overlay
            did not have. */}
        <div className="space-y-1">
          {results.map((result, resultIndex) => {
            const active = resultIndex === idx;
            return (
              <button
                key={result.id}
                type="button"
                data-testid="chat-search-result"
                data-active={active ? "true" : undefined}
                onClick={() => jumpTo(resultIndex)}
                className={cn(
                  "flex w-full min-w-0 items-start gap-2 rounded-xl px-2 py-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
                  active
                    ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,var(--kub-surface-2))] text-[color:var(--kub-text)]"
                    : "kub-raise-hover",
                )}
              >
                <span className="mt-0.5 shrink-0 text-[12px] tabular-nums text-[color:var(--kub-muted)]">
                  {resultIndex + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[color:var(--kub-text)]">
                    {chatSearchResultTitle(result)}
                  </span>
                  {/* Two lines, wrapped — not one line cut off. The overlay had
                      to truncate at 969px; 360px of column with room to wrap
                      shows more of the message than the wide card did. */}
                  <span className="mt-0.5 line-clamp-2 block break-words text-[color:var(--kub-muted)] [overflow-wrap:anywhere]">
                    {result.snippet}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-[color:var(--kub-muted)]">
                  {formatSearchDate(result.createdAt)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
