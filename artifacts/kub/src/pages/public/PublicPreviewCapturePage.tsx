import { useEffect, useMemo, useRef, useState } from "react";

import { AppTopBar } from "@/components/layout/AppTopBar";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatListItem } from "@/components/sidebar/ChatListItem";
import { FolderTabs } from "@/components/sidebar/FolderTabs";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { SidebarHeader } from "@/components/sidebar/SidebarHeader";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";
import {
  isPublicPreviewCaptureEnabled,
  PUBLIC_PREVIEW_READY_ATTRIBUTE,
  previewChats,
  previewCurrentUser,
  previewMembers,
  previewMessages,
  readPublicPreviewFixture,
  type PublicPreviewFixture,
} from "@/lib/publicPreviewFixture";

/**
 * DEV-only capture surface for the public product previews.
 *
 * Every surface here is a shipping component: `AppTopBar`, `SidebarHeader`,
 * `FolderTabs`, `ChatListItem`, `ChatHeader`, `MessageList` and `MessageInput`.
 * An earlier revision redrew four of them as static markup, and the published
 * images ended up showing states the product cannot produce: a send button on
 * an empty composer, a mobile conversation with no way back, a members subtitle
 * with the wrong plural, and the authentication backdrop behind the chat. Using
 * the real components is what keeps the previews from drifting at all.
 *
 * The layout mirrors `MainLayout`: the top bar spans both panes, the sidebar
 * appears from `md` at the same widths, and a narrow viewport with a chat open
 * shows the conversation alone.
 *
 * Only the data is fictional, and it arrives by injection rather than by
 * import, so nothing here can carry demo content into a production bundle.
 */
export default function PublicPreviewCapturePage() {
  const [fixture, setFixture] = useState<PublicPreviewFixture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const setChats = useAppStore((state) => state.setChats);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const chats = useMemo(() => (fixture ? previewChats(fixture) : []), [fixture]);
  const messages = useMemo(() => (fixture ? previewMessages(fixture) : []), [fixture]);
  const members = useMemo(() => (fixture ? previewMembers(fixture) : []), [fixture]);
  const activeChat = chats[0];

  useEffect(() => {
    // Defence in depth. The binding in App.tsx already folds away in a
    // production build; this makes the page inert even if some future path
    // manages to mount it.
    if (!isPublicPreviewCaptureEnabled()) {
      setError("The preview capture surface is disabled in this build.");
      return;
    }
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

  // The real components read the chat list and the selection from the store,
  // exactly as the application does.
  useEffect(() => {
    if (!activeChat) return;
    setChats(chats);
    setSelectedChatId(activeChat.id);
  }, [activeChat, chats, setChats, setSelectedChatId]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--kub-bg)] p-8">
        <p className="max-w-md text-center text-sm text-[color:var(--kub-muted)]">{error}</p>
      </main>
    );
  }

  if (!fixture || !activeChat) return null;

  return (
    <div
      className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-[var(--kub-bg)]"
      // The capture script waits for this attribute instead of a timeout, so a
      // slow first paint can never produce a half-rendered image.
      {...{ [PUBLIC_PREVIEW_READY_ATTRIBUTE]: "true" }}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AppTopBar />

        <div className="flex flex-1 overflow-hidden">
          <div
            className={cn(
              "h-full flex-shrink-0 flex-col border-r border-[color:var(--kub-border-color)]",
              "md:flex md:w-[360px] lg:w-[380px] xl:w-[400px]",
              // A chat is open, so a narrow viewport shows the conversation
              // alone, which is what MainLayout does.
              "hidden",
            )}
          >
            <SidebarHeader />
            <FolderTabs
              folders={[{ id: null, name: "Все", emoji: null }]}
              activeFolder={null}
              onFolderChange={() => undefined}
            />
            <div className="flex-1 overflow-hidden">
              {chats.map((chat) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  isSelected={chat.id === activeChat.id}
                  onClick={() => undefined}
                />
              ))}
            </div>
          </div>

          <div className="flex h-full flex-1 overflow-hidden">
            <div className="flex h-full min-w-0 flex-1 flex-col">
              <ChatHeader chatId={activeChat.id} chat={activeChat} />
              <MessageList
                messages={messages}
                onReply={() => undefined}
                onReaction={() => undefined}
                bottomRef={bottomRef}
                chatMembers={members}
                chatType={activeChat.type}
                myRole="owner"
              />
              <MessageInput
                chatId={activeChat.id}
                replyTo={null}
                onCancelReply={() => undefined}
                onSend={() => undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
