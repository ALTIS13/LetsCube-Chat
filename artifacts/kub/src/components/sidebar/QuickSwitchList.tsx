"use client";

import type { QuickSwitchSection } from "@/lib/quickSwitch";
import type { ChatWithLastMessage } from "@/types/database";
import { ChatListItem } from "./ChatListItem";

/**
 * The search before anything is typed (tracker item 36, c; `lib/quickSwitch.ts`):
 * Discord's quick switcher offers where the reader was, drafts and unread
 * conversations, and so does this, in the list's own rows so a conversation
 * looks the same wherever it is found.
 *
 * The press must not take the focus from the field first — the list stands
 * only while the field is focused and empty, and a blur on the way to a click
 * would take the row away from under it — so the mouse's default is held back
 * and the field is left by the choice itself.
 */
export function QuickSwitchList({
  sections,
  chatsById,
  activeChatId,
  mutedChatIds,
  onOpen,
}: {
  sections: readonly QuickSwitchSection[];
  chatsById: ReadonlyMap<string, ChatWithLastMessage>;
  /** The row Enter opens, which the arrow keys move. */
  activeChatId: string | null;
  mutedChatIds: ReadonlySet<string>;
  onOpen: (chatId: string) => void;
}) {
  return (
    <div
      data-testid="quick-switch"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
      onMouseDown={(event) => event.preventDefault()}
    >
      {sections.map((section) => (
        <section key={section.id} aria-label={section.title} data-quick-switch-section={section.id}>
          <h3 className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--kub-muted)]">
            {section.title}
          </h3>
          {section.chatIds.map((chatId) => {
            const chat = chatsById.get(chatId);
            if (!chat) return null;
            return (
              <ChatListItem
                key={`${section.id}:${chatId}`}
                chat={chat}
                isSelected={chatId === activeChatId}
                isMuted={mutedChatIds.has(chatId)}
                onClick={onOpen}
              />
            );
          })}
        </section>
      ))}
    </div>
  );
}
