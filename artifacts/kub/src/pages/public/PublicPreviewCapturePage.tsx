import { useEffect, useMemo, useState } from "react";

import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { ChatListItem } from "@/components/sidebar/ChatListItem";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { KubIcon, KubLogo } from "@/components/kub";
import { useAppStore } from "@/store/app.store";
import {
  PUBLIC_PREVIEW_READY_ATTRIBUTE,
  previewChats,
  previewCurrentUser,
  previewMessages,
  readPublicPreviewFixture,
  type PublicPreviewFixture,
} from "@/lib/publicPreviewFixture";

/**
 * DEV-only capture surface for the public product previews.
 *
 * It deliberately renders the shipping `ChatListItem` and `MessageBubble`, so
 * the published images show the genuine interface rather than a redrawing of
 * it. Only the data is fictional, and it arrives by injection rather than by
 * import, so nothing here can carry demo content into a production bundle.
 *
 * There is no Supabase client, no session and no network call on this page.
 */
export default function PublicPreviewCapturePage() {
  const [fixture, setFixture] = useState<PublicPreviewFixture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const currentUserId = useAppStore((state) => state.currentUser?.id ?? null);

  useEffect(() => {
    try {
      const injected = readPublicPreviewFixture();
      if (!injected) {
        setError("No preview fixture was injected into this context.");
        return;
      }
      setCurrentUser(previewCurrentUser(injected));
      setFixture(injected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [setCurrentUser]);

  const chats = useMemo(() => (fixture ? previewChats(fixture) : []), [fixture]);
  const messages = useMemo(() => (fixture ? previewMessages(fixture) : []), [fixture]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--kub-bg)] p-8">
        <p className="max-w-md text-center text-sm text-[color:var(--kub-muted)]">{error}</p>
      </main>
    );
  }

  if (!fixture) return null;

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-[var(--kub-bg)]"
      // The capture script waits for this attribute instead of a timeout, so a
      // slow first paint can never produce a half-rendered image.
      {...{ [PUBLIC_PREVIEW_READY_ATTRIBUTE]: "true" }}
    >
      {/* Mirrors MainLayout: side by side from md, and with a chat open a narrow
          viewport shows the conversation alone, exactly as the app does. */}
      <aside className="hidden h-full shrink-0 flex-col border-r border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] md:flex md:w-[360px] lg:w-[380px]">
        <header className="flex items-center gap-3 px-4 py-4">
          <KubLogo size={32} />
          <span className="text-base font-semibold tracking-wide text-[color:var(--kub-text)]">LETSCUBE</span>
        </header>

        <div className="px-4 pb-3">
          <div className="flex min-h-10 items-center gap-2 rounded-lg bg-[var(--kub-bg)] px-3 text-sm text-[color:var(--kub-muted)]">
            <KubIcon name="search" size={16} tone="muted" />
            <span>Поиск</span>
          </div>
        </div>

        <nav className="flex-1 overflow-hidden" aria-label="Чаты">
          {chats.map((chat, index) => (
            <ChatListItem
              key={chat.id}
              chat={chat}
              isSelected={index === 0}
              onClick={() => undefined}
            />
          ))}
        </nav>
      </aside>

      <section className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-5 py-3">
          <ChatAvatar chat={chats[0]} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[color:var(--kub-text)]">
              {fixture.activeChat.name}
            </p>
            <p className="truncate text-xs text-[color:var(--kub-muted)]">{fixture.activeChat.members}</p>
          </div>
        </header>

        <div className="kub-grid-bg flex-1 overflow-hidden px-5 py-6">
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-end gap-1">
            {messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                isMe={message.user_id === currentUserId}
                isFirstInGroup={index === 0 || messages[index - 1].user_id !== message.user_id}
                isLastInGroup={
                  index === messages.length - 1 || messages[index + 1].user_id !== message.user_id
                }
                onReply={() => undefined}
                onReaction={() => undefined}
              />
            ))}
          </div>
        </div>

        <footer className="border-t border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-5 py-3">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <KubIcon name="attach" size={20} tone="muted" />
            <div className="min-h-10 flex-1 rounded-lg bg-[var(--kub-bg)] px-3 py-2 text-sm text-[color:var(--kub-muted)]">
              Сообщение
            </div>
            <KubIcon name="send" size={20} tone="accent" />
          </div>
        </footer>
      </section>
    </div>
  );
}
