"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar, UserAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon, KubModal } from "@/components/kub";
import { cn } from "@/lib/utils";
import { mapPgError, prefixError } from "@/lib/errors";
import { avatarUploadPath, validateAvatarImage } from "@/lib/mediaUpload";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { requestAppConfirm, showAppAlert } from "@/lib/appDialogs";
import { MediaViewer, type MediaViewerItem } from "./MediaViewer";
import type { ChatWithLastMessage, Profile, Message } from "@/types/database";
import { CHAT_NAME_MAX_LENGTH, limitText } from "@/lib/entityLimits";

interface ChatInfoPanelProps {
  chat: ChatWithLastMessage;
  onClose: () => void;
  onClearForMe?: () => Promise<{ ok: boolean; error: string | null }>;
}

type Tab = "info" | "members" | "media";
const MEDIA_PAGE_SIZE = 12;

export function ChatInfoPanel({ chat, onClose, onClearForMe }: ChatInfoPanelProps) {
  const { currentUser, setSelectedChatId, chats, setChats, setMessages, mutedChatIds, toggleMutedChat } = useAppStore();
  const supabase = createClient();
  const display = getChatDisplayInfo(chat, currentUser?.id ?? null);
  const isSaved = display.isSaved;
  const isGroup = !isSaved && (chat.type === "group" || chat.type === "channel");
  const myRole: "owner" | "admin" | "member" | null =
    (chat.members?.find((m) => m.user_id === currentUser?.id)?.role as
      | "owner" | "admin" | "member" | undefined) ?? null;
  const isOwner = myRole === "owner";
  const isOwnerOrAdmin = !isSaved && (myRole === "owner" || myRole === "admin");
  const canEditChatProfile = isGroup && isOwnerOrAdmin;
  const canHidePrivateChat = chat.type === "private" && !isSaved;
  const isPinned = Boolean(chat.is_pinned);
  const isMuted = mutedChatIds.includes(chat.id);

  const [tab, setTab] = useState<Tab>("info");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(chat.name ?? "");
  const [description, setDescription] = useState(chat.description ?? "");
  const [saving, setSaving] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);
  const [leavingChat, setLeavingChat] = useState(false);
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
  const [leaveGroupOpen, setLeaveGroupOpen] = useState(false);
  const [destructiveError, setDestructiveError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  type MemberRow = Profile & { chat_role: "owner" | "admin" | "member" };
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [media, setMedia] = useState<Message[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaHasMore, setMediaHasMore] = useState(false);
  const [openMedia, setOpenMedia] = useState<MediaViewerItem | null>(null);

  useEffect(() => {
    if (!isGroup) return;
    supabase
      .from("chat_members")
      .select("role, profile:profiles(*)")
      .eq("chat_id", chat.id)
      .then(({ data }) => {
        if (data) setMembers(
          data.map((m) => ({ ...(m.profile as Profile), chat_role: m.role as "owner" | "admin" | "member" }))
        );
      });
  }, [chat.id, isGroup, supabase]);

  const loadMedia = useCallback(async (reset = false, offset = 0) => {
    if (!currentUser) {
      setMedia([]);
      setMediaHasMore(false);
      return;
    }
    setLoadingMedia(true);
    const start = reset ? 0 : offset;
    const { data: membership } = await supabase
      .from("chat_members")
      .select("cleared_at")
      .eq("chat_id", chat.id)
      .eq("user_id", currentUser.id)
      .maybeSingle();
    let query = supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chat.id)
      .in("type", ["image", "video", "file"])
      .is("deleted_at", null)
      .not("media_url", "is", null);
    if (membership?.cleared_at) {
      query = query.gt("created_at", membership.cleared_at);
    }
    const { data } = await query
      .order("created_at", { ascending: false })
      .range(start, start + MEDIA_PAGE_SIZE);
    if (data) {
      const page = (data as Message[]).slice(0, MEDIA_PAGE_SIZE);
      setMedia((current) => {
        const next = reset ? page : [...current, ...page];
        return Array.from(new Map(next.map((item) => [item.id, item])).values());
      });
      setMediaHasMore(data.length > MEDIA_PAGE_SIZE);
    }
    setLoadingMedia(false);
  }, [chat.id, currentUser, supabase]);

  useEffect(() => {
    if (tab === "media") {
      setMedia([]);
      setMediaHasMore(false);
      setOpenMedia(null);
      loadMedia(true);
    }
  }, [tab, loadMedia]);

  useEffect(() => {
    setMedia([]);
    setMediaHasMore(false);
    setOpenMedia(null);
  }, [chat.id]);

  const handleSave = async () => {
    setSaving(true);
    const trimmedName = name.trim();
    if (trimmedName.length > CHAT_NAME_MAX_LENGTH) {
      setSaving(false);
      return;
    }
    const { data } = await supabase
      .from("chats")
      .update({ name: trimmedName || null, description: description.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", chat.id)
      .select("*")
      .single();
    if (data) {
      setChats(chats.map((c) => c.id === chat.id ? { ...c, name: data.name, description: data.description } : c));
    }
    setSaving(false);
    setEditing(false);
  };

  const handleAvatarChange = async (file: File) => {
    if (!currentUser) return;
    const validationError = validateAvatarImage(file);
    if (validationError) {
      setAvatarError(validationError);
      showAppAlert(validationError, "Аватар не загружен");
      return;
    }
    setAvatarError(null);
    const path = avatarUploadPath("chat", chat.id, file);
    const { data, error } = await supabase.storage.from("media")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      const message = prefixError("Не удалось загрузить аватар чата", error);
      setAvatarError(message);
      showAppAlert(message, "Ошибка");
      return;
    }
    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(data.path);
    const { error: updateErr } = await supabase.from("chats").update({ avatar_url: publicUrl }).eq("id", chat.id);
    if (updateErr) {
      const message = prefixError("Не удалось сохранить аватар чата", updateErr);
      setAvatarError(message);
      showAppAlert(message, "Ошибка");
      return;
    }
    setChats(chats.map((c) => c.id === chat.id ? { ...c, avatar_url: publicUrl } : c));
  };

  const handleLeave = async () => {
    if (!currentUser || leavingChat) return;
    setDestructiveError(null);
    setLeavingChat(true);
    const { error } = await supabase.from("chat_members")
      .delete().eq("chat_id", chat.id).eq("user_id", currentUser.id);
    if (error) {
      // Most likely the last-owner protection (P0001).  Surface the
      // server-side message so the user understands why nothing happened.
      console.error("leave chat failed:", error);
      setDestructiveError(mapPgError(error));
      setLeavingChat(false);
      return;
    }
    setLeavingChat(false);
    setLeaveGroupOpen(false);
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    onClose();
  };

  const handleDeleteGroup = async () => {
    if (!isGroup || !isOwner || deletingChat) return;
    setDestructiveError(null);

    setDeletingChat(true);
    const { data, error } = await supabase
      .from("chats")
      .delete()
      .eq("id", chat.id)
      .select("id")
      .maybeSingle();
    setDeletingChat(false);

    if (error) {
      console.error("delete group chat failed:", error);
      setDestructiveError(prefixError("Не удалось удалить групповой чат", error));
      return;
    }

    if (!data) {
      setDestructiveError("Недостаточно прав для удаления этого чата.");
      return;
    }

    setDeleteGroupOpen(false);
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    onClose();
  };

  const handlePinToggle = async () => {
    const rpcName = isPinned ? "unpin_chat" : "pin_chat";
    const { error } = await supabase.rpc(rpcName, { p_chat_id: chat.id });
    if (error) {
      showAppAlert(prefixError(isPinned ? "Не удалось открепить чат" : "Не удалось закрепить чат", error), "Ошибка");
      return;
    }
    setChats(chats.map((c) =>
      c.id === chat.id
        ? { ...c, is_pinned: !isPinned, pinned_at: isPinned ? null : new Date().toISOString() }
        : c
    ));
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const handleClearForMe = async () => {
    if (!onClearForMe) return;
    const title = isSaved ? "Очистить избранное у себя?" : "Очистить историю у себя?";
    const body = "Сообщения и вложения будут скрыты только у вас. У других участников они останутся. Файлы из хранилища не удаляются.";
    const confirmed = await requestAppConfirm({
      title,
      description: body,
      confirmLabel: "Очистить",
      tone: "danger",
      icon: "delete",
    });
    if (!confirmed) return;
    const result = await onClearForMe();
    if (!result.ok) {
      showAppAlert(result.error ?? "Не удалось очистить историю у себя.", "Ошибка");
      return;
    }
    const clearedAt = new Date().toISOString();
    setMessages(chat.id, []);
    setChats(chats.map((c) =>
      c.id === chat.id
        ? { ...c, last_message: undefined, unread_count: 0, cleared_at: clearedAt }
        : c
    ));
    setMedia([]);
    setMediaHasMore(false);
    setOpenMedia(null);
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const handleHidePrivateChat = async () => {
    if (!canHidePrivateChat) return;
    const confirmed = await requestAppConfirm({
      title: "Удалить чат у себя?",
      description: "Чат исчезнет только из вашего списка. У собеседника история останется.",
      confirmLabel: "Удалить у себя",
      tone: "danger",
      icon: "logout",
    });
    if (!confirmed) return;
    const { error } = await supabase.rpc("hide_private_chat", { p_chat_id: chat.id });
    if (error) {
      showAppAlert(prefixError("Не удалось удалить чат у себя", error), "Ошибка");
      return;
    }
    setMessages(chat.id, []);
    setMedia([]);
    setMediaHasMore(false);
    setOpenMedia(null);
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
    onClose();
  };

  const handleRemoveMember = async (userId: string) => {
    const { error } = await supabase.from("chat_members")
      .delete().eq("chat_id", chat.id).eq("user_id", userId);
    if (error) {
      console.error("removeMember failed:", error);
      showAppAlert(prefixError("Не удалось удалить участника", error), "Ошибка");
      return;
    }
    setMembers((m) => m.filter((u) => u.id !== userId));
  };

  const setMemberRole = async (userId: string, role: "admin" | "member") => {
    const { error } = await supabase
      .from("chat_members").update({ role })
      .eq("chat_id", chat.id).eq("user_id", userId);
    if (error) {
      // Triggered by the role-change matrix (only owner) or the
      // last-owner protection trigger.
      console.error("setMemberRole:", error);
      showAppAlert(prefixError("Не удалось изменить роль", error), "Ошибка");
      return;
    }
    setMembers((ms) => ms.map((m) => m.id === userId ? { ...m, chat_role: role } : m));
  };

  const roleLabel = (role: string) =>
    role === "owner" ? "Владелец" : role === "admin" ? "Администратор" : "";

  const otherUser = !isGroup ? (chat.other_user as Profile | null) : null;
  const mediaGridItems = useMemo(
    () => media.filter((m) => m.type === "image" || m.type === "video"),
    [media],
  );
  const fileItems = useMemo(
    () => media.filter((m) => m.type === "file"),
    [media],
  );
  const visibleMediaGridItems = mediaGridItems;
  const hasMoreMedia = mediaHasMore;

  const tabLabels: Record<Tab, string> = { info: "Сведения", members: "Участники", media: "Медиа" };
  const actionRowClass =
    "inline-flex min-w-0 items-center gap-3 w-full py-2 text-sm rounded-xl px-2 transition-colors text-left hover:bg-[var(--kub-surface-2)]";
  const dangerActionRowClass =
    "inline-flex min-w-0 items-center gap-3 w-full py-2 text-sm rounded-xl px-2 transition-colors text-left text-[color:var(--kub-danger)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="flex flex-col h-full w-full md:w-80 flex-shrink-0 border-l bg-[var(--kub-surface)] border-[color:var(--kub-border-color)]">
      <div className="flex items-center gap-2 px-3 h-14 flex-shrink-0 border-b border-[color:var(--kub-border-color)]">
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-[var(--kub-surface-2)] transition-colors text-[color:var(--kub-muted)]"
          aria-label="Закрыть"
        >
          <KubIcon name="close" size={18} />
        </button>
        <span className="text-sm font-semibold text-[color:var(--kub-text)]">
          {isSaved ? "Избранное" : isGroup ? "Информация о группе" : "Профиль пользователя"}
        </span>
        {canEditChatProfile && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="ml-auto p-2 rounded-lg hover:bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]"
            aria-label="Редактировать"
          >
            <KubIcon name="edit" size={16} />
          </button>
        )}
        {editing && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto p-2 rounded-lg hover:bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]"
            aria-label="Сохранить"
          >
            <KubIcon name="check" size={16} />
          </button>
        )}
      </div>

      <div className="flex flex-col items-center py-6 px-4 gap-3 flex-shrink-0 border-b border-[color:var(--kub-border-color)] kub-grid-subtle">
        <div className="relative">
          <ChatAvatar
            chat={{ id: chat.id, name: display.title, avatar_url: chat.avatar_url ?? null, type: chat.type }}
            size="xl"
            isSaved={display.isSaved}
          />
          {canEditChatProfile && (
            <label className="absolute bottom-0 right-0 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan">
              <KubIcon name="camera" size={14} label="Сменить аватар" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarChange(f); }}
              />
            </label>
          )}
          {avatarError && (
            <div className="text-xs text-center text-[color:var(--kub-danger)]">
              {avatarError}
            </div>
          )}
        </div>

        {editing ? (
          <div className="w-full space-y-2">
            <input
              value={name}
              onChange={(e) => setName(limitText(e.target.value, CHAT_NAME_MAX_LENGTH))}
              maxLength={CHAT_NAME_MAX_LENGTH}
              className="w-full text-sm rounded-xl px-3 py-2 outline-none text-center font-semibold bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)]"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Описание…"
              rows={2}
              className="w-full text-sm rounded-xl px-3 py-2 outline-none resize-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)]"
            />
          </div>
        ) : (
          <>
            <div
              className="w-full max-w-full px-2 text-center text-base font-semibold leading-snug text-[color:var(--kub-text)] line-clamp-2 [overflow-wrap:anywhere]"
              title={display.title}
            >
              {display.title}
            </div>
            {isSaved ? (
              <div className="text-xs text-[color:var(--kub-muted)]">
                Личное пространство для сохранённых сообщений
              </div>
            ) : isGroup ? (
              <div className="text-xs text-[color:var(--kub-muted)]">
                {chat.members?.length ?? 0} участников
              </div>
            ) : (
              <div className="text-xs text-[color:var(--kub-muted)]">
                {otherUser?.username ? `@${otherUser.username}` : "Без имени пользователя"}
              </div>
            )}
            {chat.description && (
              <p className="max-w-full text-center text-xs text-[color:var(--kub-muted)] line-clamp-3 [overflow-wrap:anywhere]">
                {chat.description}
              </p>
            )}
          </>
        )}
      </div>

      {isGroup && (
        <div className="flex flex-shrink-0 border-b border-[color:var(--kub-border-color)]">
          {(["info", "members", "media"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "relative flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                tab === t ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
              )}
            >
              {t === "members"
                ? <KubIcon name="users" size={14} className="mx-auto mb-0.5" />
                : t === "media"
                  ? <KubIcon name="image" size={14} className="mx-auto mb-0.5" />
                  : null}
              {tabLabels[t]}
              {tab === t && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[var(--kub-cyan)] kub-glow-soft" />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {(tab === "info" || !isGroup) && (
          <div>
            {!isGroup && otherUser?.bio && (
              <div className="px-4 py-3 border-b border-[color:var(--kub-border-color)]">
                <div className="text-[10px] uppercase tracking-wider mb-1 text-[color:var(--kub-cyan)]">О себе</div>
                <div className="text-sm text-[color:var(--kub-text)]">{otherUser.bio}</div>
              </div>
            )}
            <div className="px-4 py-3 space-y-1">
              <button
                onClick={() => setTab("media")}
                className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
              >
                <KubIcon name="image" size={17} tone="muted" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">Общие медиа</span>
              </button>
              <button
                onClick={() => toggleMutedChat(chat.id)}
                className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
              >
                <KubIcon name={isMuted ? "notificationsOff" : "notifications"} size={17} tone={isMuted ? "accent" : "muted"} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {isMuted ? "Включить уведомления" : "Отключить уведомления"}
                </span>
              </button>
              {isGroup && chat.type === "group" && isOwner && (
                <button
                  onClick={async () => {
                    const next = !chat.is_forum;
                    const confirmed = await requestAppConfirm({
                      title: next ? "Включить режим топиков?" : "Выключить режим топиков?",
                      description: next
                        ? "Все будущие сообщения можно будет отправлять в общий раздел или выбранный топик."
                        : "Топики останутся в базе, но чат вернётся к обычному отображению.",
                      confirmLabel: next ? "Включить" : "Выключить",
                      icon: "hash",
                    });
                    if (!confirmed) return;
                    const { error: updErr } = await supabase
                      .from("chats").update({ is_forum: next }).eq("id", chat.id);
                    if (updErr) {
                      console.error("toggle is_forum failed:", updErr);
                      showAppAlert(prefixError("Не удалось переключить режим топиков", updErr), "Ошибка");
                      return;
                    }
                    setChats(chats.map((c) => c.id === chat.id ? { ...c, is_forum: next } : c));
                    if (next) {
                      const { data: existing } = await supabase
                        .from("topics").select("id").eq("chat_id", chat.id).eq("is_general", true).maybeSingle();
                      if (!existing) {
                        const { error: tErr } = await supabase.from("topics").insert({
                          chat_id: chat.id, name: "Общий", emoji: "💬", is_general: true, position: 0,
                        });
                        if (tErr) console.error("create general topic failed:", tErr);
                      }
                    }
                  }}
                  className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
                >
                  <KubIcon
                    name="hash"
                    size={17}
                    tone={chat.is_forum ? "accent" : "muted"}
                    className="shrink-0"
                  />
                  <span className="flex-1 text-left">Топики</span>
                  <span className={cn(
                    "text-[10px] uppercase tracking-wide font-semibold",
                    chat.is_forum ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]"
                  )}>
                    {chat.is_forum ? "Вкл" : "Выкл"}
                  </span>
                </button>
              )}
            </div>
            <div className="px-4 py-3 mt-2 border-t border-[color:var(--kub-border-color)]">
              <button
                onClick={handlePinToggle}
                className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
              >
                <KubIcon name={isPinned ? "pinOff" : "pin"} size={17} tone="muted" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{isPinned ? "Открепить чат" : "Закрепить чат"}</span>
              </button>
              {onClearForMe && (
                <button
                  onClick={handleClearForMe}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="delete" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {isSaved ? "Очистить избранное у себя" : "Очистить историю у себя"}
                  </span>
                </button>
              )}
              {canHidePrivateChat && (
                <button
                  onClick={handleHidePrivateChat}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="logout" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">Удалить чат у себя</span>
                </button>
              )}
              {isGroup && !isOwner && (
                <button
                  onClick={() => {
                    setDestructiveError(null);
                    setLeaveGroupOpen(true);
                  }}
                  disabled={leavingChat}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="logout" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{leavingChat ? "Выходим..." : "Покинуть группу"}</span>
                </button>
              )}
              {isGroup && isOwner && (
                <button
                  onClick={() => {
                    setDestructiveError(null);
                    setDeleteGroupOpen(true);
                  }}
                  disabled={deletingChat}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="userRemove" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {deletingChat ? "Удаление..." : "Удалить групповой чат"}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "members" && isGroup && (
          <div className="py-2">
            {members.map((member) => {
              const isSelf = member.id === currentUser?.id;
              const isMemberOwner = member.chat_role === "owner";
              const isMemberAdmin = member.chat_role === "admin";
              // Promote/demote matrix mirrors the SQL trigger
              // `enforce_chat_member_update`:
              //   • owner can change anyone (last-owner trigger guards
              //     the chat from going ownerless),
              //   • admin can promote member↔demote admin, but never
              //     touch owners and never create new owners.
              const canPromote = !isSelf && member.chat_role === "member" && isOwnerOrAdmin;
              const canDemote  = !isSelf && isMemberAdmin && isOwnerOrAdmin;
              const canRemove  = !isSelf && !isMemberOwner && (
                isOwner || (myRole === "admin" && member.chat_role === "member")
              );
              return (
                <div key={member.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--kub-surface-2)] group">
                  <UserAvatar user={member} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1 text-[color:var(--kub-text)]">
                      {isMemberOwner && <KubIcon name="crown" size={12} tone="pink" className="flex-shrink-0" label="Владелец" />}
                      {isMemberAdmin && <KubIcon name="shield" size={12} tone="accent" className="flex-shrink-0" label="Администратор" />}
                      <span className="truncate">{member.full_name ?? member.username ?? "Без имени"}</span>
                      {isSelf && <span className="text-xs flex-shrink-0 text-[color:var(--kub-muted)]">(вы)</span>}
                    </div>
                    {(isMemberOwner || isMemberAdmin) && (
                      <div className="text-xs text-[color:var(--kub-cyan)]">{roleLabel(member.chat_role)}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {canPromote && (
                      <button
                        onClick={() => setMemberRole(member.id, "admin")}
                        title="Сделать администратором"
                        aria-label="Сделать администратором"
                        className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-3)] transition-all text-[color:var(--kub-cyan)]"
                      >
                        <KubIcon name="chevronUp" size={14} />
                      </button>
                    )}
                    {canDemote && (
                      <button
                        onClick={() => setMemberRole(member.id, "member")}
                        title="Снять администратора"
                        aria-label="Снять администратора"
                        className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-3)] transition-all text-[color:var(--kub-muted)]"
                      >
                        <KubIcon name="shieldOff" size={14} />
                      </button>
                    )}
                    {canRemove && (
                      <button
                        onClick={async () => {
                          const confirmed = await requestAppConfirm({
                            title: "Удалить участника из чата?",
                            description: `${member.full_name ?? "Участник"} потеряет доступ к этому чату.`,
                            confirmLabel: "Удалить",
                            tone: "danger",
                            icon: "userRemove",
                          });
                          if (confirmed) void handleRemoveMember(member.id);
                        }}
                        title="Удалить из чата"
                        aria-label="Удалить из чата"
                        className="p-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--kub-danger)_15%,transparent)] transition-all text-[color:var(--kub-danger)]"
                      >
                        <KubIcon name="close" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "media" && (
          <div className="p-2">
            {loadingMedia && media.length === 0 ? (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="aspect-square animate-pulse rounded-lg bg-[var(--kub-surface-2)]"
                  />
                ))}
              </div>
            ) : media.length === 0 ? (
              <div className="text-center py-8 text-sm text-[color:var(--kub-muted)]">Медиа пока нет</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1 mb-3">
                  {visibleMediaGridItems.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      className="relative aspect-square overflow-hidden rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] text-left focus:outline-none focus:ring-2 focus:ring-[color:var(--kub-cyan)]"
                      onClick={() => setOpenMedia({
                        type: m.type as "image" | "video",
                        url: m.media_url!,
                        title: m.content ?? (m.type === "image" ? "Фото" : "Видео"),
                      })}
                    >
                      <MediaGalleryTile message={m} />
                    </button>
                  ))}
                </div>
                {hasMoreMedia && (
                  <button
                    type="button"
                    onClick={() => loadMedia(false, media.length)}
                    disabled={loadingMedia}
                    className="mb-3 w-full rounded-xl border border-[color:var(--kub-border-color)] px-3 py-2 text-sm text-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-2)]"
                  >
                    Показать ещё
                  </button>
                )}
                {fileItems.map((m) => (
                  <a
                    key={m.id}
                    href={m.media_url!}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--kub-surface-2)] transition-colors text-[color:var(--kub-text)]"
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]">
                      <KubIcon name="file" size={15} tone="accent" />
                    </div>
                    <span className="text-sm truncate">{m.content ?? "Файл"}</span>
                  </a>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <KubModal
        open={leaveGroupOpen}
        onClose={() => {
          if (!leavingChat) setLeaveGroupOpen(false);
        }}
        title="Покинуть группу?"
        description="Группа исчезнет из вашего списка. История у других участников останется."
        icon={<KubIcon name="logout" size={18} tone="danger" />}
        size="sm"
        mobileSheet={false}
        footer={(
          <>
            <button
              type="button"
              onClick={() => setLeaveGroupOpen(false)}
              disabled={leavingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)] disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleLeave}
              disabled={leavingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[color:var(--kub-danger)] px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {leavingChat ? "Выходим..." : "Покинуть"}
            </button>
          </>
        )}
      >
        {destructiveError ? (
          <div className="rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-sm text-[color:var(--kub-danger)]">
            {destructiveError}
          </div>
        ) : (
          <p className="text-sm text-[color:var(--kub-muted)]">
            Повторные нажатия будут заблокированы после подтверждения.
          </p>
        )}
      </KubModal>
      <KubModal
        open={deleteGroupOpen}
        onClose={() => {
          if (!deletingChat) setDeleteGroupOpen(false);
        }}
        title="Удалить групповой чат?"
        description="Это действие нельзя отменить. Чат и история исчезнут у всех участников."
        icon={<KubIcon name="userRemove" size={18} tone="danger" />}
        size="sm"
        mobileSheet={false}
        footer={(
          <>
            <button
              type="button"
              onClick={() => setDeleteGroupOpen(false)}
              disabled={deletingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)] disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleDeleteGroup}
              disabled={deletingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[color:var(--kub-danger)] px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {deletingChat ? "Удаляем..." : "Удалить"}
            </button>
          </>
        )}
      >
        {destructiveError ? (
          <div className="rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-sm text-[color:var(--kub-danger)]">
            {destructiveError}
          </div>
        ) : (
          <p className="text-sm text-[color:var(--kub-muted)]">
            Используется подтверждение внутри приложения, поэтому браузер не будет блокировать повторные системные окна.
          </p>
        )}
      </KubModal>
      <MediaViewer media={openMedia} onClose={() => setOpenMedia(null)} />
    </div>
  );
}

function MediaGalleryTile({ message }: { message: Message }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const kind = getMediaTileKind(message);
  const icon = kind === "video" ? "video" : kind === "gif" ? "image" : "image";
  const label = kind === "video" ? "Видео" : kind === "gif" ? "GIF" : "Фото";

  if (kind === "image" && message.media_url && !previewFailed) {
    return (
      <>
        <img
          src={message.media_url}
          alt={message.content ?? "Фото"}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.03]"
          onError={() => setPreviewFailed(true)}
        />
        <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/85">
          Фото
        </span>
      </>
    );
  }

  return (
    <div className={cn(
      "flex h-full w-full flex-col items-center justify-center gap-1 text-white",
      kind === "video"
        ? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kub-cyan)_18%,#111827),#0b0f18)]"
        : "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kub-pink)_16%,#111827),color-mix(in_srgb,var(--kub-cyan)_14%,#0b0f18))]"
    )}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/14 backdrop-blur">
        <KubIcon name={icon} size={18} className="text-white" />
      </span>
      <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80">
        {label}
      </span>
    </div>
  );
}

function getMediaTileKind(message: Message): "image" | "gif" | "video" {
  if (message.type === "video") return "video";
  const source = `${message.content ?? ""} ${message.media_url ?? ""}`.toLowerCase();
  if (source.includes(".gif")) return "gif";
  return "image";
}
