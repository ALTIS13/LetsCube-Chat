"use client";

import { KubGlassLayer, KubIcon } from "@/components/kub";
import { SearchFilterChips } from "@/components/search/SearchShared";
import { useChatMessageSearch } from "@/hooks/useChatMessageSearch";
import { formatSearchDate } from "@/lib/chatMessageSearch";
import { mediaLabelForMessage } from "@/lib/searchQuery";
import type { MessageWithSender } from "@/types/database";

interface ChatSearchBarProps {
  chatId: string;
  currentTopicId?: string | null;
  isForum?: boolean;
  messages: MessageWithSender[];
  onClose: () => void;
  onJumpTo: (messageId: string, topicId?: string | null) => void | Promise<void>;
}

/**
 * In-chat search as a capsule floating over the conversation.
 *
 * **Below `md` only, since 2026-09-12.** This is the phone's form and the only
 * one possible there: below that width the chat list column is not on screen at
 * all, so there is nowhere else for the results to go. From `md` the same search
 * is a state of the list column — see `ChatSearchPanel` — and `ChatWindow`
 * mounts this one only on a phone, so the two never run at once.
 *
 * Its shape is deliberately unchanged. What it gives up is recorded rather than
 * fixed here: the well is capped and the set is sliced to six, so a seventh
 * match is counted and cannot be reached. On a phone there is no column to move
 * it into, and widening the capsule would cover more of the conversation than
 * it already does. The engine it runs on is shared with the column
 * (`useChatMessageSearch`), so the counter, the order and the jump cannot drift
 * between the two forms.
 */
export function ChatSearchBar({ chatId, currentTopicId, isForum = false, messages, onClose, onJumpTo }: ChatSearchBarProps) {
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
  } = useChatMessageSearch({ chatId, currentTopicId, isForum, messages, onJumpTo });

  return (
    // A panel floating under the header, as the pinned capsule does, rather
    // than a band across the conversation. It carries words over content it is
    // not part of, so it takes the covering glass, as a leaf: the filter chips
    // inside it may open something of their own (rule 3).
    <div className="relative mx-2 mt-1 flex flex-shrink-0 flex-col md:mx-4">
      <KubGlassLayer strong className="rounded-[1.375rem] border border-[color:var(--glass-line)]" />
      <div className="relative flex min-w-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <KubIcon name="search" size={14} className="text-[color:var(--kub-muted)]" />
        <input
          autoFocus
          type="text"
          placeholder="Поиск в чате…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
        />

        {loading && <KubIcon name="spinner" size={14} tone="accent" />}

        {canSearch && (
          <span className="flex-shrink-0 text-xs tabular-nums text-[color:var(--kub-muted)]">
            {total > 0 ? `${idx + 1}/${total}` : "ничего не найдено"}
          </span>
        )}

        <div className="flex items-center gap-0">
          <button
            type="button"
            onClick={() => jumpTo(Math.max(0, idx - 1))}
            disabled={total === 0 || idx === 0}
            className="rounded-lg p-1.5 text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-cyan)] disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            aria-label="Предыдущий"
          >
            <KubIcon name="chevronUp" size={16} />
          </button>
          <button
            type="button"
            onClick={() => jumpTo(Math.min(total - 1, idx + 1))}
            disabled={total === 0 || idx === total - 1}
            className="rounded-lg p-1.5 text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-cyan)] disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            aria-label="Следующий"
          >
            <KubIcon name="chevronDown" size={16} />
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[color:var(--kub-muted)] transition-colors kub-raise-hover"
          aria-label="Закрыть"
        >
          <KubIcon name="close" size={16} />
        </button>
      </div>

      <SearchFilterChips parsed={parsed} query={query} onChangeQuery={setQuery} compact />

      <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-[12px] text-[color:var(--kub-muted)]">
        {isForum && (
          <button
            type="button"
            onClick={() => setAllTopics((value) => !value)}
            className="rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2 py-1 font-semibold transition hover:border-[color:var(--kub-cyan)] hover:text-[color:var(--kub-accent-text)]"
          >
            {allTopics ? "Все темы" : "Текущая тема"}
          </button>
        )}
        {rpcMissing && (
          <span>Поиск сейчас выполняется по загруженным сообщениям.</span>
        )}
      </div>

      {canSearch && total > 0 && (
        <div className="max-h-36 space-y-1 overflow-y-auto px-3 pb-2">
          {results.slice(0, 6).map((result, resultIndex) => {
            const active = resultIndex === idx;
            return (
              <button
                key={result.id}
                type="button"
                onClick={() => jumpTo(resultIndex)}
                className={[
                  "flex w-full min-w-0 items-start gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition-colors",
                  active
                    ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,var(--kub-surface-2))] text-[color:var(--kub-text)]"
                    : "kub-raise-hover",
                ].join(" ")}
              >
                <span className="mt-0.5 shrink-0 text-[12px] tabular-nums text-[color:var(--kub-muted)]">
                  {resultIndex + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[color:var(--kub-text)]">
                    {result.senderName || mediaLabelForMessage(result.type, result.snippet) || "Сообщение"}
                  </span>
                  <span className="mt-0.5 block truncate text-[color:var(--kub-muted)]">
                    {result.snippet}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-[color:var(--kub-muted)]">
                  {formatSearchDate(result.createdAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
