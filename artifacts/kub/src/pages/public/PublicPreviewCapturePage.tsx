import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppTopBar } from "@/components/layout/AppTopBar";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatSelectionBar } from "@/components/chat/ChatSelectionBar";
import { ForwardModal } from "@/components/chat/ForwardModal";
import { ChatListItem } from "@/components/sidebar/ChatListItem";
import { FolderTabs } from "@/components/sidebar/FolderTabs";
import { MediaViewer, type MediaViewerItem } from "@/components/chat/MediaViewer";
import { MediaSendDialog } from "@/components/chat/MediaSendDialog";
import { useIncomingMediaFiles } from "@/hooks/useIncomingMediaFiles";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import {
  MessageDeleteDialogHost,
  copySelectedMessages,
  useChatMessageSelection,
} from "@/components/chat/MessageSelectionChrome";
import { SidebarHeader } from "@/components/sidebar/SidebarHeader";
import { KubGlassLayer } from "@/components/kub";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { applyReactionPlan, planReactionToggle } from "@/lib/messageReactions";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";
import type { MessageWithSender } from "@/types/database";
import {
  isPublicPreviewCaptureEnabled,
  PUBLIC_PREVIEW_READY_ATTRIBUTE,
  previewChats,
  previewCurrentUser,
  previewForwardDraft,
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
 *
 * The conversation answers what is done to it — a reaction, a pin, a
 * deletion, a selection, a reply — locally, through the same components and the
 * same one-per-person rule the application uses, so a render of a message
 * action shows its real result. Nothing it does leaves the page.
 */
/**
 * The page stages nothing: there is no upload behind it. What it does share with
 * `ChatWindow` is the routing — the phone's limit check and the desktop's send
 * dialog — so the renders taken here show the decisions the conversation makes.
 */
function stageNothing() {
  return undefined;
}

export default function PublicPreviewCapturePage() {
  const [fixture, setFixture] = useState<PublicPreviewFixture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const setChats = useAppStore((state) => state.setChats);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setEditingMessage = useAppStore((state) => state.setEditingMessage);
  const forwardingMessages = useAppStore((state) => state.forwardingMessages);
  const setForwardingMessages = useAppStore((state) => state.setForwardingMessages);
  const pendingForward = useAppStore((state) => state.pendingForward);
  const setPendingForward = useAppStore((state) => state.setPendingForward);
  const setMessageDeleteRequest = useAppStore((state) => state.setMessageDeleteRequest);
  const currentUserId = useAppStore((state) => state.currentUser?.id ?? null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // The photo viewer, opened from a bubble exactly as `ChatWindow` opens it. No
  // product preview carries a picture, so it never opens during a capture; the
  // QA specs that zoom a photo inject one.
  const [openMedia, setOpenMedia] = useState<MediaViewerItem | null>(null);
  const [replyTo, setReplyTo] = useState<MessageWithSender | null>(null);
  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const { ref: chromeRef, height: chromeHeight } = useMeasuredHeight<HTMLDivElement>();
  const { ref: composerRef, height: composerHeight } = useMeasuredHeight<HTMLDivElement>();
  const {
    request: mediaSendRequest,
    handleIncomingFiles,
    closeRequest: closeMediaSendRequest,
  } = useIncomingMediaFiles(stageNothing);

  const chats = useMemo(() => (fixture ? previewChats(fixture) : []), [fixture]);
  const members = useMemo(() => (fixture ? previewMembers(fixture) : []), [fixture]);
  const activeChat = chats[0];
  const selection = useChatMessageSelection(activeChat?.id ?? "", messages);
  const commentDraft = useMemo(
    () => (fixture?.pendingForward?.comment ? { id: "preview-forward-comment", text: fixture.pendingForward.comment } : null),
    [fixture],
  );

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
      setMessages(previewMessages(injected));
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
    // A fixture may open with messages already waiting to be forwarded here —
    // the one state of that flow a single page can show.
    if (fixture?.pendingForward) {
      setPendingForward({ chatId: activeChat.id, messages: previewForwardDraft(fixture) });
    }
  }, [activeChat, chats, fixture, setChats, setPendingForward, setSelectedChatId]);

  const react = useCallback((messageId: string, emoji: string) => {
    if (!currentUserId) return;
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId) return message;
      const plan = planReactionToggle(message.reactions, currentUserId, emoji);
      const reactions = applyReactionPlan(message.reactions, currentUserId, plan, {
        messageId,
        createdAt: new Date().toISOString(),
      });
      return { ...message, reactions: reactions as MessageWithSender["reactions"] };
    }));
  }, [currentUserId]);

  const togglePin = useCallback((target: MessageWithSender) => {
    setMessages((current) =>
      current.map((message) => (message.id === target.id ? { ...message, pinned: !message.pinned } : message)),
    );
  }, []);

  const deleteLocally = useCallback(async (targets: MessageWithSender[], forEveryone: boolean) => {
    const ids = new Set(targets.map((message) => message.id));
    const now = new Date().toISOString();
    setMessages((current) =>
      forEveryone
        ? current.map((message) => (ids.has(message.id) ? { ...message, deleted_at: now } : message))
        : current.filter((message) => !ids.has(message.id)),
    );
    return { ok: true };
  }, []);

  const editLocally = useCallback(async (messageId: string, content: string) => {
    const now = new Date().toISOString();
    setMessages((current) =>
      current.map((message) => (message.id === messageId ? { ...message, content, edited_at: now } : message)),
    );
  }, []);

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
      // Mirrors MainLayout, background included: the shell is transparent so
      // the chrome blurs the page ambient. A capture that painted an opaque
      // --kub-bg here would photograph a product nobody ships.
      // The insets too: the scroll contracts are measured on this page, so it
      // has to be laid out around a notch exactly as `MainLayout` is.
      className="flex h-[100dvh] w-screen flex-col overflow-hidden px-safe"
      // The capture script waits for this attribute instead of a timeout, so a
      // slow first paint can never produce a half-rendered image.
      {...{ [PUBLIC_PREVIEW_READY_ATTRIBUTE]: "true" }}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AppTopBar />

        <div className="flex flex-1 overflow-hidden">
          <div
            className={cn(
              // Stands in for the `Sidebar` root, which this page does not
              // mount — it composes the column from the same parts, so it also
              // copies how `Sidebar` wears the material: a layer, not a filter
              // on the box, because `SidebarHeader` opens dialogs from in here.
              "relative h-full flex-shrink-0 flex-col border-r border-[color:var(--kub-border-color)] md:pb-safe",
              "md:flex md:w-[360px] lg:w-[380px] xl:w-[400px]",
              // A chat is open, so a narrow viewport shows the conversation
              // alone, which is what MainLayout does.
              "hidden",
            )}
          >
            <KubGlassLayer />
            {/* Positioned, like `Sidebar`'s body wrapper: the layer is
                positioned too, and two positioned boxes paint in tree order. */}
            <div className="relative flex min-h-0 flex-1 flex-col">
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
          </div>

          <div className="flex h-full flex-1 overflow-hidden">
            {/* The same three-layer conversation `ChatWindow` builds: the list
                runs the full height of the column and the chrome frosts over
                it. Copied rather than abstracted for the same reason the rest
                of this page is composed from shipping parts — but the geometry
                has to match, because the scroll contracts are measured here. */}
            <div className="relative flex h-full min-w-0 flex-1 flex-col">
              {/* The list first, the chrome after it: the three boxes are all
                  positioned with `z-index: auto`, so the last one in the markup
                  is the one that paints on top. `ChatWindow` orders them the
                  same way and for the same reason — see the note there. */}
              <MessageList
                chatId={activeChat.id}
                messages={messages}
                onReply={setReplyTo}
                onReaction={react}
                onEdit={(message) => setEditingMessage(message)}
                onDelete={() => undefined}
                onHideForMe={() => undefined}
                onTogglePin={togglePin}
                onForward={(message) => setForwardingMessages([message])}
                onOpenMedia={setOpenMedia}
                bottomRef={bottomRef}
                chatMembers={members}
                chatType={activeChat.type}
                myRole="owner"
                quickReactions={fixture.recentReactions}
                topInset={chromeHeight}
                bottomInset={composerHeight}
                layoutVersion={composerHeight}
              />
              <div ref={chromeRef} className="absolute inset-x-0 top-0 flex flex-col" data-testid="chat-chrome-stack">
                {selection.active ? (
                  <ChatSelectionBar
                    count={selection.selected.length}
                    canForward
                    canCopy
                    canDelete
                    onForward={() => setForwardingMessages(selection.selected)}
                    onCopy={() => {
                      copySelectedMessages(selection.selected, currentUserId);
                      selection.clear();
                    }}
                    onDelete={() =>
                      setMessageDeleteRequest({ chatId: activeChat.id, ids: selection.selected.map((message) => message.id) })
                    }
                    onCancel={selection.clear}
                  />
                ) : (
                  <ChatHeader chatId={activeChat.id} chat={activeChat} />
                )}
              </div>
              <div
                ref={composerRef}
                data-testid="chat-composer-dock"
                className="absolute inset-x-0 bottom-0"
                // The same inset `ChatWindow` gives its dock, so the scroll
                // contracts measured on this page hold on an iPhone too.
                style={{ paddingBottom: "max(var(--kub-keyboard-inset, 0px), var(--kub-safe-bottom))" }}
              >
                <MessageInput
                  chatId={activeChat.id}
                  replyTo={replyTo}
                  onCancelReply={() => setReplyTo(null)}
                  onSend={() => undefined}
                  onEdit={editLocally}
                  forwardDraft={pendingForward?.chatId === activeChat.id ? pendingForward.messages : null}
                  onCancelForward={() => setPendingForward(null)}
                  draftOverride={commentDraft}
                  onStageFiles={handleIncomingFiles}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      {forwardingMessages && (
        <ForwardModal
          messages={forwardingMessages}
          onClose={() => setForwardingMessages(null)}
          onForward={() => {
            // One page, one chat: the forward waits above this composer.
            setPendingForward({ chatId: activeChat.id, messages: forwardingMessages });
            setForwardingMessages(null);
            selection.clear();
          }}
        />
      )}
      <MessageDeleteDialogHost
        chatId={activeChat.id}
        messages={messages}
        chatType={activeChat.type}
        isSavedChat={false}
        otherName={activeChat.type === "private" ? getChatDisplayInfo(activeChat, currentUserId).title : null}
        currentUserId={currentUserId}
        onDelete={deleteLocally}
      />
      {mediaSendRequest && (
        <MediaSendDialog
          key={mediaSendRequest.id}
          files={mediaSendRequest.files}
          onCancel={closeMediaSendRequest}
          onSend={closeMediaSendRequest}
        />
      )}
      <MediaViewer media={openMedia} onClose={() => setOpenMedia(null)} />
    </div>
  );
}
