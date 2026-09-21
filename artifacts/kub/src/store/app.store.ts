import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'
import { sortChatsForSidebar } from '@/lib/chatSort'
import { shareChatList } from '@/lib/chatListChange'
import { clearUnread, samePreviewMessage } from '@/lib/chatListDelta'
import { sameData, shareById } from '@/lib/structuralSharing'
import type { Profile, ChatWithLastMessage, MessageWithSender } from '@/types/database'
import { sameActorClientMessage } from '@/lib/messageActor'
import { isHeartbeatOnlyProfileChange } from '@/lib/profileChange'
import type { BotProfileSeed } from '@/lib/botProfile'
import type { ProfileAnchor, ProfileOpener } from '@/lib/profileTier'
import {
  CHAT_MUTE_CACHE_KEY,
  CHAT_MUTE_OFF,
  EMPTY_CHAT_MUTES,
  MUTE_SIGNED_OUT,
  applyCachedMutes,
  applyLocalMute,
  applyMutesError,
  applyServerMutes,
  chatMuteFor,
  chatMutePreferenceFor,
  chatMutesForUser,
  mutedChatIdsAt,
  muteRefusalText,
  readCachedMutes,
  serializeCachedMutes,
  type ChatMuteOptionId,
  type ChatMutePreference,
  type ChatMutePreferenceRow,
  type ChatMuteSnapshot,
} from '@/lib/chatMute'
import { mapPgError } from '@/lib/errors'

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
  // 'folders' went with D-120: the tab that set it opened a second folder
  // surface beside the strip at the top of the chat list. 'search' is a
  // one-shot focus signal rather than a screen — see `SidebarHeader`.
  mobileSection: 'chats' | 'search' | 'profile'
  setMobileSection: (section: 'chats' | 'search' | 'profile') => void

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

  // Mute — the account's rows in `chat_notification_preferences`, not a note in
  // one browser (D-167). `mutedChatIds` is derived from them at an instant,
  // because a timed mute stops being one with nothing happening.
  chatMutes: ChatMuteSnapshot
  mutedChatIds: string[]
  /** Point the snapshot at a person; a different one empties it. */
  syncChatMuteUser: (userId: string | null) => void
  /** Show what this browser remembered — only until the account answers. */
  applyCachedChatMutes: (userId: string | null, raw: string | null) => void
  /** The account's own answer, which replaces whatever was on screen. */
  applyServerChatMutes: (userId: string | null, rows: ChatMutePreferenceRow[] | null) => void
  setChatMutesError: (userId: string | null, message: string) => void
  /** Re-derive the ids — for the moment a timed mute lifts. */
  refreshChatMutes: () => void
  /**
   * Write one chat's choice and say whether it landed. «off» lifts the mute.
   *
   * Resolves rather than returning void: the surfaces have to be able to show a
   * refusal, and the screen must not keep claiming a mute the account does not
   * have.
   */
  setChatMute: (chatId: string, option: ChatMuteOptionId | "off") => Promise<{ ok: boolean; error: string | null }>

  // Mark chat read (zero out unread_count in store)
  markChatRead: (chatId: string) => void

  // Cross-surface chat panel requests, used by sidebar context actions.
  chatPanelRequest: { chatId: string; panel: 'info' | 'search'; key: number } | null
  requestChatPanel: (chatId: string, panel: 'info' | 'search') => void
  clearChatPanelRequest: (key: number) => void

  /**
   * Whose profile is open over the shell, if anybody's (D-283).
   *
   * Here rather than in a component because the surfaces that need to open one
   * are in different columns and, for two of them, in different trees: the
   * chat list's row menu, and — once D-266 lands — a face in a call, which is
   * drawn in the capsule and in the information panel at once. A piece of
   * state one of them owned would make the other two import it, which is how
   * this product ended up with two profile modals before.
   *
   * **This is a person, never a conversation to open.** Naming one to *open*
   * is what D-283 was: the entry called `onChatSelect` and the act had a
   * consequence in somebody else's client. `profileOverlayChatId` below names a
   * place too, and the difference is the whole point — it says where the card
   * is being read **from**, so the card can say what is true there, and nothing
   * in this slice ever selects it.
   */
  profileOverlayUserId: string | null
  /**
   * How the person was asked for, which is what decides the surface.
   *
   * The **opener** is stored and the tier is derived on every render by
   * `resolveProfileTier`, rather than the other way round: a window narrowed
   * past `PROFILE_COMPACT_MIN_WIDTH` while a compact card stands must become
   * the full surface, and a tier frozen at open time cannot do that.
   */
  profileOverlayOpener: ProfileOpener
  /**
   * The place the person was opened from, or null.
   *
   * Discord's profile is keyed on `(userId, guildId)`, not on a person, and
   * this is that second half: a group or a channel is where a standing and a
   * join date are facts. A private conversation passes null — whoever opens
   * one becomes its owner, so its «Владелец» is an artefact of who pressed
   * first. `lib/profileChatContext.ts` owns the rule.
   */
  profileOverlayChatId: string | null
  /**
   * The box the person was opened from, in viewport coordinates, or null.
   *
   * Discord's popout is **beside what you pressed** — the conversation does not
   * move and the reader's eye does not leave the message. That is the property
   * that makes the small tier cheap, and a centred card does not have it.
   * `placeBeside` turns this box into a position; `null` means the caller had
   * no element to point at, and the surface falls back to the centred dialog
   * rather than pointing at the top-left corner.
   */
  profileOverlayAnchor: ProfileAnchor | null
  /** Whether «Полный профиль» has been pressed on the compact card. */
  profileOverlayEscalated: boolean
  openUserProfile: (
    userId: string,
    opener?: ProfileOpener,
    chatId?: string | null,
    anchor?: ProfileAnchor | null,
  ) => void
  /**
   * Discord's `view-profile` item, which is `POPOUT_CLOSE` followed by
   * `openUserProfileModal` — one act, not two surfaces open at once.
   */
  escalateUserProfile: () => void
  closeUserProfile: () => void

  /**
   * Which bot's card is open over the shell, if any (D-263).
   *
   * A second slice rather than a widened `profileOverlayUserId`, and the reason
   * is that a bot is not a person with fields missing. The person's card asks
   * `profiles`, carries presence, a standing in this chat and the groups you
   * share; a bot's asks `bots` and `bot_commands` and has none of those — §8's
   * rule again, that a control which cannot work is absent rather than drawn
   * empty. One union would have made every consumer of the person slice branch
   * on a kind, which is how a surface ends up drawing «был(а) недавно» for a
   * program.
   *
   * What the two do share is the tier: `resolveProfileTier` decides both, so a
   * bot pressed in passing opens beside the message where there is room for a
   * beside, and takes the phone's whole screen where there is not.
   *
   * Only one of the two is ever open. Opening either closes the other, because
   * they occupy the same place on the screen and «two cards» is not a state
   * anything here can draw.
   */
  botProfileId: string | null
  /**
   * The row the opener already had, so the card draws a name rather than a
   * skeleton.
   *
   * A bot's message carries its whole `bots` row (`resolveMessageActor` refuses
   * a message whose embedded bot is not the one it names), so the commonest
   * opener knows everything but the commands. A seed is never trusted for the
   * commands and never replaces a read that has answered; it is the first
   * paint and nothing else.
   */
  botProfileSeed: BotProfileSeed | null
  /** Where the card is being read from, which is what decides the addressing. */
  botProfileChatId: string | null
  botProfileOpener: ProfileOpener
  botProfileAnchor: ProfileAnchor | null
  openBotProfile: (
    botId: string,
    seed?: BotProfileSeed | null,
    opener?: ProfileOpener,
    chatId?: string | null,
    anchor?: ProfileAnchor | null,
  ) => void
  closeBotProfile: () => void

  /**
   * A draft the chat pane is asked to put in its composer, from outside it.
   *
   * The same shape `chatPanelRequest` uses and for the same reason: the asker
   * is mounted over the shell, not inside `ChatWindow`, and a `key` is what
   * makes the same text asked for twice arrive twice. Choosing a command on a
   * bot's card is the one caller today (D-263).
   */
  composerDraftRequest: { chatId: string; text: string; key: number } | null
  requestComposerDraft: (chatId: string, text: string) => void
  clearComposerDraftRequest: (key: number) => void

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

export const useAppStore = create<AppState>((set, get) => ({
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

  // Nothing is read from storage here. The old seed was
  // `localStorage.getItem('ng_muted')` — a bare array of chat ids with nobody's
  // name on it, shown to whoever opened the browser next. The cache is applied
  // through `applyCachedChatMutes`, which knows whose it is and stands aside as
  // soon as the account answers.
  chatMutes: EMPTY_CHAT_MUTES,
  mutedChatIds: [],

  syncChatMuteUser: (userId) =>
    set((state) => commitChatMutes(state, chatMutesForUser(state.chatMutes, userId))),

  applyCachedChatMutes: (userId, raw) =>
    set((state) => commitChatMutes(state, applyCachedMutes(state.chatMutes, readCachedMutes(raw), userId))),

  applyServerChatMutes: (userId, rows) =>
    set((state) => {
      const next = applyServerMutes(state.chatMutes, userId, rows);
      writeChatMuteCache(next);
      return commitChatMutes(state, next);
    }),

  setChatMutesError: (userId, message) =>
    set((state) => commitChatMutes(state, applyMutesError(state.chatMutes, userId, message))),

  refreshChatMutes: () => set((state) => commitChatMutes(state, state.chatMutes)),

  setChatMute: async (chatId, option) => {
    const userId = get().currentUser?.id ?? null;
    if (!userId) return { ok: false, error: MUTE_SIGNED_OUT };
    const muting = option !== 'off';
    const pref: ChatMutePreference = muting ? chatMutePreferenceFor(option, Date.now()) : CHAT_MUTE_OFF;

    // Optimistic, because the control that starts this is a menu item that
    // closes behind the press — the same reason `personalBlocksStore` is. The
    // row that was there is kept so a refusal can put it back: a screen that
    // keeps a mute the account does not have is this defect in miniature.
    const before = chatMuteFor(get().chatMutes, chatId);
    set((state) => commitChatMutes(state, applyLocalMute(state.chatMutes, userId, chatId, pref)));

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('chat_notification_preferences')
        .upsert(
          {
            chat_id: chatId,
            user_id: userId,
            push_enabled: pref.pushEnabled,
            muted_until: pref.mutedUntil,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'chat_id,user_id' },
        );
      if (error) throw error;
      writeChatMuteCache(get().chatMutes);
      return { ok: true, error: null };
    } catch (error) {
      // The cause goes to the log, where somebody who can act on it reads it;
      // the screen gets one sentence about the situation. The bare `catch {}`
      // this replaces is why a half-applied mute was invisible.
      console.error('[chat-mute] upsert failed.', (error as { code?: string })?.code ?? '', (error as { message?: string })?.message ?? '');
      set((state) => commitChatMutes(state, applyLocalMute(state.chatMutes, userId, chatId, before)));
      return { ok: false, error: muteRefusalText(muting, mapPgError(error)) };
    }
  },

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

  profileOverlayUserId: null,
  profileOverlayOpener: "named",
  profileOverlayChatId: null,
  profileOverlayAnchor: null,
  profileOverlayEscalated: false,
  openUserProfile: (userId, opener = "named", chatId = null, anchor = null) =>
    set(() => ({
      profileOverlayUserId: userId,
      profileOverlayOpener: opener,
      profileOverlayChatId: chatId,
      // Always replaced, never compared: the same person opened from a second
      // face is a different box, and the old short-circuit would have left the
      // popout pointing at the row the reader had already scrolled past.
      profileOverlayAnchor: anchor,
      profileOverlayEscalated: false,
      // The two cards are one place on the screen.
      botProfileId: null,
      botProfileSeed: null,
      botProfileAnchor: null,
    })),
  botProfileId: null,
  botProfileSeed: null,
  botProfileChatId: null,
  botProfileOpener: "named",
  botProfileAnchor: null,
  openBotProfile: (botId, seed = null, opener = "named", chatId = null, anchor = null) =>
    set(() => ({
      botProfileId: botId,
      botProfileSeed: seed,
      botProfileChatId: chatId,
      botProfileOpener: opener,
      botProfileAnchor: anchor,
      // The two cards are one place on the screen.
      profileOverlayUserId: null,
      profileOverlayAnchor: null,
      profileOverlayEscalated: false,
    })),
  closeBotProfile: () =>
    set((state) =>
      state.botProfileId === null
        ? state
        : { botProfileId: null, botProfileSeed: null, botProfileChatId: null, botProfileAnchor: null },
    ),

  composerDraftRequest: null,
  requestComposerDraft: (chatId, text) =>
    set((state) => ({
      composerDraftRequest: { chatId, text, key: (state.composerDraftRequest?.key ?? 0) + 1 },
    })),
  clearComposerDraftRequest: (key) =>
    set((state) => (state.composerDraftRequest?.key === key ? { composerDraftRequest: null } : state)),

  escalateUserProfile: () =>
    set((state) => (state.profileOverlayEscalated ? state : { profileOverlayEscalated: true })),
  closeUserProfile: () =>
    set((state) =>
      state.profileOverlayUserId === null && !state.profileOverlayEscalated
        ? state
        : {
            profileOverlayUserId: null,
            profileOverlayChatId: null,
            profileOverlayAnchor: null,
            profileOverlayEscalated: false,
          },
    ),

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

/**
 * Put a snapshot in, and re-derive the ids from it at this instant.
 *
 * The array is kept by identity when nothing in it changed: the sidebar renders
 * a row per change of that identity, and the timer that exists to notice a
 * lifted mute fires whether or not one lifted (D-088).
 */
function commitChatMutes(state: AppState, next: ChatMuteSnapshot): Partial<AppState> {
  const ids = mutedChatIdsAt(next, Date.now());
  const same =
    ids.length === state.mutedChatIds.length && ids.every((id, index) => id === state.mutedChatIds[index]);
  if (same && next === state.chatMutes) return state;
  return { chatMutes: next, mutedChatIds: same ? state.mutedChatIds : ids };
}

/**
 * Remember the account's answer so the next cold start is not blank.
 *
 * Written under the account's own id, which is the whole difference from
 * `ng_muted`: a cache that cannot say whose it is has to be shown to everybody
 * or to nobody, and it was shown to everybody.
 */
function writeChatMuteCache(state: ChatMuteSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    const serialized = serializeCachedMutes(state);
    if (serialized === null) localStorage.removeItem(CHAT_MUTE_CACHE_KEY);
    else localStorage.setItem(CHAT_MUTE_CACHE_KEY, serialized);
  } catch {
    // A browser refusing storage is not a reason to fail a mute; the account
    // has the row and the next read brings it back.
  }
}
