import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'
import { sortChatsForSidebar } from '@/lib/chatSort'
import { shareChatList } from '@/lib/chatListChange'
import { clearUnread, samePreviewMessage } from '@/lib/chatListDelta'
import { sameData, shareById } from '@/lib/structuralSharing'
import type { Profile, ChatWithLastMessage, MessageWithSender } from '@/types/database'
import { sameActorClientMessage } from '@/lib/messageActor'
import { isHeartbeatOnlyProfileChange } from '@/lib/profileChange'

interface AppState {
  // Current user
  currentUser: Profile | null
  setCurrentUser: (user: Profile | null) => void

  // Selected chat
  selectedChatId: string | null
  setSelectedChatId: (id: string | null) => void

  // Selected topic within the active forum chat — null for non-forum chats.
  selectedTopicId: string | null
  setSelectedTopicId: (id: string | null) => void

  // Chats list
  chats: ChatWithLastMessage[]
  setChats: (chats: ChatWithLastMessage[]) => void
  updateChat: (chat: ChatWithLastMessage) => void
  updateChatLastMessage: (chatId: string, message: MessageWithSender) => void

  // Messages
  messages: Record<string, MessageWithSender[]>
  setMessages: (chatId: string, messages: MessageWithSender[]) => void
  /**
   * Insert OR replace by id. Used both for new messages from realtime AND for replacing
   * an optimistic message in place when the realtime echo arrives with richer data.
   */
  addMessage: (chatId: string, message: MessageWithSender) => void
  updateMessage: (chatId: string, message: MessageWithSender) => void
  /**
   * Optimistic helper: swap a message with a known oldId for one whose id may differ
   * (e.g. temporary `tmp:…` id → real DB uuid after INSERT returns).
   */
  replaceMessage: (chatId: string, oldId: string, message: MessageWithSender) => void
  removeMessage: (chatId: string, id: string) => void

  // Active folder
  activeFolderId: string | null
  setActiveFolderId: (id: string | null) => void

  // UI state
  showSidebar: boolean
  setShowSidebar: (show: boolean) => void
  searchQuery: string
  setSearchQuery: (q: string) => void

  /**
   * Active section in the mobile BottomNav. Drives which secondary surface
   * (search input focus, folder management, profile/settings) is open on top
   * of the chats list. Admin lives at its own route, not here.
   *
   * 'search' is a one-shot trigger: SidebarHeader focuses its search input
   * when this becomes 'search' and immediately resets the section back to
   * 'chats' so the tap acts like an action rather than a sticky tab.
   */
  mobileSection: 'chats' | 'search' | 'folders' | 'profile'
  setMobileSection: (section: 'chats' | 'search' | 'folders' | 'profile') => void

  // Reply/forward/edit state — composer-level UI flags
  replyToMessage: MessageWithSender | null
  setReplyToMessage: (msg: MessageWithSender | null) => void
  editingMessage: MessageWithSender | null
  setEditingMessage: (msg: MessageWithSender | null) => void
  /** When set, ForwardModal opens to pick a destination chat for these messages. */
  forwardingMessages: MessageWithSender[] | null
  setForwardingMessages: (messages: MessageWithSender[] | null) => void
  /**
   * Messages waiting above a chat's composer, forwarded there with the next
   * send, Telegram's way: the chat is picked first and a comment can be added.
   */
  pendingForward: { chatId: string; messages: MessageWithSender[] } | null
  setPendingForward: (forward: { chatId: string; messages: MessageWithSender[] } | null) => void
  /**
   * Selection mode. Kept here rather than in the list because the bar that
   * replaces the chat header lives outside the list. Scoped to one chat, so
   * switching chats can never act on messages that are no longer on screen.
   */
  messageSelection: { chatId: string; ids: string[] } | null
  setMessageSelection: (selection: { chatId: string; ids: string[] } | null) => void
  /** The messages the one «Удалить» dialog is open for. */
  messageDeleteRequest: { chatId: string; ids: string[] } | null
  setMessageDeleteRequest: (request: { chatId: string; ids: string[] } | null) => void

  // Mute
  mutedChatIds: string[]
  toggleMutedChat: (chatId: string) => void

  // Mark chat read (zero out unread_count in store)
  markChatRead: (chatId: string) => void

  // Cross-surface chat panel requests, used by sidebar context actions.
  chatPanelRequest: { chatId: string; panel: 'info' | 'search'; key: number } | null
  requestChatPanel: (chatId: string, panel: 'info' | 'search') => void
  clearChatPanelRequest: (key: number) => void

  /**
   * Which chat's in-chat search is open, if any.
   *
   * It lives here rather than in `ChatWindow` because from `md` the search is a
   * state of the LIST COLUMN — `Sidebar` swaps its body to the results, the way
   * it already does for a global query — while the thing being searched is the
   * chat pane beside it. Two columns, one piece of state, so neither owns it.
   * Below `md` the column is off screen entirely and the chat pane keeps the
   * floating overlay; both forms read this same flag.
   */
  chatSearch: { chatId: string } | null
  openChatSearch: (chatId: string) => void
  closeChatSearch: () => void

  /**
   * Whether the settings screen is open, wherever it is drawn.
   *
   * Here for the same reason `chatSearch` is: from `md` settings is a state of
   * the LIST COLUMN — `Sidebar` swaps its body to it — while the two places
   * that open it are the folder rail's side list and, below `md`, the header's
   * avatar menu. Neither of those owns the surface, so neither can own the
   * flag; it used to be a `useState` in each of them, which is why the screen
   * could be mounted twice.
   *
   * The two openers clear each other deliberately: one column cannot show both
   * the settings screen and an in-chat search, and whichever was asked for last
   * is the one a person is looking for.
   */
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
}


function compareMessages(a: MessageWithSender, b: MessageWithSender): number {
  const byCreatedAt = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (byCreatedAt !== 0) return byCreatedAt;
  return a.id.localeCompare(b.id);
}

function sortMessages(messages: MessageWithSender[]): MessageWithSender[] {
  return [...messages].sort(compareMessages);
}

function isSameLogicalMessage(
  current: ChatWithLastMessage["last_message"],
  next: MessageWithSender,
): boolean {
  if (!current) return false;
  if (current.id === next.id) return true;
  return Boolean(
    current.client_message_id &&
    next.client_message_id &&
    sameActorClientMessage(current, next),
  );
}

function shouldReplaceLastMessage(
  current: ChatWithLastMessage["last_message"],
  next: MessageWithSender,
): boolean {
  if (!current) return true;
  if (isSameLogicalMessage(current, next)) return true;
  const currentMs = new Date(current.created_at).getTime();
  const nextMs = new Date(next.created_at).getTime();
  if (!Number.isFinite(currentMs) || !Number.isFinite(nextMs)) return true;
  return nextMs >= currentMs;
}

function latestTimestamp(a: string | null | undefined, b: string | null | undefined): string {
  if (!a) return b ?? new Date().toISOString();
  if (!b) return a;
  const aMs = new Date(a).getTime();
  const bMs = new Date(b).getTime();
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  /**
   * Shallow-compare significant fields and DROP no-op writes.
   *
   * Why: `useHeartbeat` PATCH-ит `profiles.online_at` каждые 60 с.
   * `useUser` слушает realtime UPDATE на этой же строке и без этого
   * фильтра подменял бы ссылку `currentUser` на каждое heartbeat-эхо.
   * Любой коллбэк/эффект с `[currentUser]` в зависимостях после этого
   * пересоздавался → useChats/useFolders/useTasks начинали N+1 рефетч
   * и переподписку realtime-каналов. Это и есть storm-петля Task #48.
   *
   * Игнорируем изменения, где не изменилось ничего, кроме
   * `online_at`/`updated_at`. Возвращаем тот же `state`
   * (Object.is === true), zustand тогда не уведомляет подписчиков и
   * лишних рендеров не происходит.
   *
   * Сравниваем всё, кроме этих двух полей, а не список «значимых».
   * Список был именно таким и молча устарел: он не знал про
   * `profile_frame`/`profile_background`, поэтому выбор рамки проходил все
   * сравнения, стор возвращал тот же объект — и кнопка выглядела мёртвой,
   * хотя запись в базу проходила. Любой новый столбец профиля теперь
   * значим по умолчанию; пульс пишет только `online_at`, так что фильтр,
   * ради которого всё это писалось, остаётся закрытым.
   */
  setCurrentUser: (user) => set((state) => {
    if (!user || !state.currentUser) return { currentUser: user };
    const unchanged = isHeartbeatOnlyProfileChange(
      state.currentUser as unknown as Record<string, unknown>,
      user as unknown as Record<string, unknown>,
    );
    return unchanged ? state : { currentUser: user };
  }),

  selectedChatId: null,
  setSelectedChatId: (id) => set({ selectedChatId: id, selectedTopicId: null }),

  selectedTopicId: null,
  setSelectedTopicId: (id) => set({ selectedTopicId: id }),

  chats: [],
  // Every chat whose data did not change stays the object it was, so a row
  // renders only for its own change, and a list that did not change at all
  // wakes nobody (D-088). See `shareChatList`.
  setChats: (chats) => set((state) => {
    const next = shareChatList(state.chats, chats)
    return next === state.chats ? state : { chats: next }
  }),
  updateChat: (chat) =>
    set((state) => {
      let changed = false
      const chats = state.chats.map((c) => {
        if (c.id !== chat.id) return c
        const merged = { ...c, ...chat }
        if (sameData(merged, c)) return c
        changed = true
        return merged
      })
      return changed ? { chats } : state
    }),
  updateChatLastMessage: (chatId, message) =>
    set((state) => {
      let changed = false;
      const nextChats = state.chats.map((chat) => {
        if (chat.id !== chatId) return chat;
        if (!shouldReplaceLastMessage(chat.last_message, message)) return chat;
        // Another copy of the message the row already shows — the Realtime
        // row, the provisional one, the joined one — draws the same row, and
        // replacing it anyway rendered the row once per copy.
        if (isSameLogicalMessage(chat.last_message, message) && samePreviewMessage(chat.last_message, message)) {
          return chat;
        }
        changed = true;
        return {
          ...chat,
          last_message: message as ChatWithLastMessage["last_message"],
          updated_at: latestTimestamp(chat.updated_at, message.created_at),
        };
      });
      if (!changed) return state;
      return { chats: sortChatsForSidebar(nextChats, state.currentUser?.id ?? null) };
    }),

  messages: {},
  // A revalidation that brings back what is already on screen keeps every
  // message the object it was, and wakes nobody when nothing changed. Reopening
  // a chat used to render its history twice: from the store, and again when the
  // identical fetch landed (D-089).
  setMessages: (chatId, msgs) =>
    set((state) => {
      const existing = state.messages[chatId]
      const sorted = sortMessages(msgs)
      const next = existing ? shareById(existing, sorted, (m) => m.id) : sorted
      if (next === existing) return state
      return { messages: { ...state.messages, [chatId]: next } }
    }),
  addMessage: (chatId, message) =>
    set((state) => {
      const existing = state.messages[chatId] || []
      const idx = existing.findIndex((m) => m.id === message.id || sameActorClientMessage(m, message))
      // Upsert: if a message with this id is already in the store (e.g. optimistic copy
      // already replaced with real data, then realtime echo arrives), replace it in place
      // rather than appending a duplicate. A copy with the same data keeps the object.
      const next = idx === -1
        ? [...existing, message]
        : existing.map((m, i) => (i === idx && !sameData(m, message) ? message : m))
      const sorted = sortMessages(next)
      if (
        sorted.length === existing.length &&
        sorted.every((m, i) => m === existing[i])
      ) {
        return state
      }
      return { messages: { ...state.messages, [chatId]: sorted } }
    }),
  updateMessage: (chatId, message) =>
    set((state) => {
      const existing = state.messages[chatId] || []
      let changed = false
      const next = existing.map((m) => {
        if (m.id !== message.id || sameData(m, message)) return m
        changed = true
        return message
      })
      return changed ? { messages: { ...state.messages, [chatId]: next } } : state
    }),
  replaceMessage: (chatId, oldId, message) =>
    set((state) => {
      const existing = state.messages[chatId] || []
      const withoutOld = existing.filter((m) => m.id !== oldId && !sameActorClientMessage(m, message))
      const idx = withoutOld.findIndex((m) => m.id === message.id || sameActorClientMessage(m, message))
      const next = idx === -1
        ? [...withoutOld, message]
        : withoutOld.map((m, i) => (i === idx ? message : m))
      const sorted = shareById(existing, sortMessages(next), (m) => m.id)
      if (sorted === existing) return state
      return { messages: { ...state.messages, [chatId]: sorted } }
    }),
  removeMessage: (chatId, id) =>
    set((state) => {
      const existing = state.messages[chatId]
      if (!existing?.some((m) => m.id === id)) return state
      return {
        messages: {
          ...state.messages,
          [chatId]: existing.filter((m) => m.id !== id),
        },
      }
    }),

  activeFolderId: null,
  setActiveFolderId: (id) => set({ activeFolderId: id }),

  showSidebar: true,
  setShowSidebar: (show) => set({ showSidebar: show }),
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),

  mobileSection: 'chats',
  setMobileSection: (section) => set({ mobileSection: section }),

  replyToMessage: null,
  setReplyToMessage: (msg) => set({ replyToMessage: msg }),
  editingMessage: null,
  setEditingMessage: (msg) => set({ editingMessage: msg }),
  forwardingMessages: null,
  setForwardingMessages: (messages) => set({ forwardingMessages: messages && messages.length ? messages : null }),
  pendingForward: null,
  setPendingForward: (forward) =>
    set({ pendingForward: forward && forward.messages.length ? forward : null }),
  messageSelection: null,
  setMessageSelection: (selection) =>
    set({ messageSelection: selection && selection.ids.length ? selection : null }),
  messageDeleteRequest: null,
  setMessageDeleteRequest: (request) =>
    set({ messageDeleteRequest: request && request.ids.length ? request : null }),

  mutedChatIds: typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('ng_muted') ?? '[]')
    : [],
  toggleMutedChat: (chatId) =>
    set((state) => {
      const wasMuted = state.mutedChatIds.includes(chatId);
      const next = wasMuted
        ? state.mutedChatIds.filter((id) => id !== chatId)
        : [...state.mutedChatIds, chatId];
      if (typeof window !== 'undefined') localStorage.setItem('ng_muted', JSON.stringify(next));
      void persistChatPushPreference(state.currentUser?.id ?? null, chatId, !wasMuted);
      return { mutedChatIds: next };
    }),

  // Opening a chat with nothing unread used to rebuild the whole list anyway,
  // which rendered every row of the sidebar on every chat switch.
  markChatRead: (chatId) =>
    set((state) => {
      const chats = clearUnread(state.chats, chatId)
      return chats === state.chats ? state : { chats }
    }),

  chatPanelRequest: null,
  requestChatPanel: (chatId, panel) =>
    set((state) => ({
      chatPanelRequest: {
        chatId,
        panel,
        key: (state.chatPanelRequest?.key ?? 0) + 1,
      },
    })),
  clearChatPanelRequest: (key) =>
    set((state) => (
      state.chatPanelRequest?.key === key ? { chatPanelRequest: null } : state
    )),

  chatSearch: null,
  openChatSearch: (chatId) =>
    set((state) => (
      state.chatSearch?.chatId === chatId && !state.settingsOpen
        ? state
        : { chatSearch: { chatId }, settingsOpen: false }
    )),
  closeChatSearch: () => set((state) => (state.chatSearch === null ? state : { chatSearch: null })),

  settingsOpen: false,
  openSettings: () =>
    set((state) => (
      state.settingsOpen && state.chatSearch === null
        ? state
        : { settingsOpen: true, chatSearch: null }
    )),
  closeSettings: () => set((state) => (state.settingsOpen ? { settingsOpen: false } : state)),
}))

async function persistChatPushPreference(userId: string | null, chatId: string, muted: boolean) {
  if (!userId) return;
  try {
    const supabase = createClient();
    await supabase
      .from("chat_notification_preferences")
      .upsert(
        {
          chat_id: chatId,
          user_id: userId,
          push_enabled: !muted,
          muted_until: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "chat_id,user_id" },
      );
  } catch {
    // Local mute remains effective for the current device. DB-backed push mute
    // starts working as soon as the push preference migration is applied.
  }
}
