"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar, UserAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";
import { mapPgError, prefixError } from "@/lib/errors";
import { avatarUploadPath, validateAvatarImage } from "@/lib/mediaUpload";
import type { ChatWithLastMessage, Profile, Message } from "@/types/database";

interface ChatInfoPanelProps {
  chat: ChatWithLastMessage;
  onClose: () => void;
}

type Tab = "info" | "members" | "media";

export function ChatInfoPanel({ chat, onClose }: ChatInfoPanelProps) {
  const { currentUser, setSelectedChatId, chats, setChats } = useAppStore();
  const supabase = createClient();
  const isGroup = chat.type === "group" || chat.type === "channel";
  const myRole: "owner" | "admin" | "member" | null =
    (chat.members?.find((m) => m.user_id === currentUser?.id)?.role as
      | "owner" | "admin" | "member" | undefined) ?? null;
  const isOwner = myRole === "owner";
  const isOwnerOrAdmin = myRole === "owner" || myRole === "admin";

  const [tab, setTab] = useState<Tab>("info");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(chat.name ?? "");
  const [description, setDescription] = useState(chat.description ?? "");
  const [saving, setSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  type MemberRow = Profile & { chat_role: "owner" | "admin" | "member" };
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [media, setMedia] = useState<Message[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

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

  const loadMedia = useCallback(async () => {
    setLoadingMedia(true);
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chat.id)
      .in("type", ["image", "video", "file"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setMedia(data as Message[]);
    setLoadingMedia(false);
  }, [chat.id, supabase]);

  useEffect(() => { if (tab === "media") loadMedia(); }, [tab, loadMedia]);

  const handleSave = async () => {
    setSaving(true);
    const { data } = await supabase
      .from("chats")
      .update({ name: name.trim() || null, description: description.trim() || null, updated_at: new Date().toISOString() })
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
      alert(validationError);
      return;
    }
    setAvatarError(null);
    const path = avatarUploadPath("chat", chat.id, file);
    const { data, error } = await supabase.storage.from("media")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      const message = prefixError("Не удалось загрузить аватар чата", error);
      setAvatarError(message);
      alert(message);
      return;
    }
    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(data.path);
    const { error: updateErr } = await supabase.from("chats").update({ avatar_url: publicUrl }).eq("id", chat.id);
    if (updateErr) {
      const message = prefixError("Не удалось сохранить аватар чата", updateErr);
      setAvatarError(message);
      alert(message);
      return;
    }
    setChats(chats.map((c) => c.id === chat.id ? { ...c, avatar_url: publicUrl } : c));
  };

  const handleLeave = async () => {
    if (!currentUser) return;
    if (!confirm("Покинуть этот чат?")) return;
    const { error } = await supabase.from("chat_members")
      .delete().eq("chat_id", chat.id).eq("user_id", currentUser.id);
    if (error) {
      // Most likely the last-owner protection (P0001).  Surface the
      // server-side message so the user understands why nothing happened.
      console.error("leave chat failed:", error);
      alert(mapPgError(error));
      return;
    }
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    onClose();
  };

  const handleRemoveMember = async (userId: string) => {
    const { error } = await supabase.from("chat_members")
      .delete().eq("chat_id", chat.id).eq("user_id", userId);
    if (error) {
      console.error("removeMember failed:", error);
      alert(prefixError("Не удалось удалить участника", error));
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
      alert(prefixError("Не удалось изменить роль", error));
      return;
    }
    setMembers((ms) => ms.map((m) => m.id === userId ? { ...m, chat_role: role } : m));
  };

  const roleLabel = (role: string) =>
    role === "owner" ? "Владелец" : role === "admin" ? "Администратор" : "";

  const otherUser = !isGroup ? (chat.other_user as Profile | null) : null;

  const tabLabels: Record<Tab, string> = { info: "Сведения", members: "Участники", media: "Медиа" };

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
          {isGroup ? "Информация о группе" : "Профиль пользователя"}
        </span>
        {isOwnerOrAdmin && !editing && (
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
            chat={{ id: chat.id, name: chat.name, avatar_url: chat.avatar_url ?? null, type: chat.type }}
            size="xl"
          />
          {isOwnerOrAdmin && (
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
              onChange={(e) => setName(e.target.value)}
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
            <div className="text-base font-semibold text-center text-[color:var(--kub-text)]">
              {isGroup ? chat.name : otherUser?.full_name ?? chat.name}
            </div>
            {isGroup ? (
              <div className="text-xs text-[color:var(--kub-muted)]">
                {chat.members?.length ?? 0} участников
              </div>
            ) : (
              <div className="text-xs text-[color:var(--kub-muted)]">
                {otherUser?.username ? `@${otherUser.username}` : "Без имени пользователя"}
              </div>
            )}
            {chat.description && (
              <p className="text-xs text-center text-[color:var(--kub-muted)]">
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
                className="flex items-center gap-3 w-full py-2 text-sm hover:bg-[var(--kub-surface-2)] rounded-xl px-2 transition-colors text-[color:var(--kub-text)]"
              >
                <KubIcon name="image" size={17} tone="muted" />
                Общие медиа
              </button>
              <button className="flex items-center gap-3 w-full py-2 text-sm hover:bg-[var(--kub-surface-2)] rounded-xl px-2 transition-colors text-[color:var(--kub-text)]">
                <KubIcon name="notifications" size={17} tone="muted" />
                Отключить уведомления
              </button>
              {isGroup && chat.type === "group" && isOwner && (
                <button
                  onClick={async () => {
                    const next = !chat.is_forum;
                    if (next && !confirm("Включить режим топиков? Все будущие сообщения попадут в топики.")) return;
                    if (!next && !confirm("Выключить режим топиков? Топики останутся, но сообщения снова будут в общем потоке.")) return;
                    const { error: updErr } = await supabase
                      .from("chats").update({ is_forum: next }).eq("id", chat.id);
                    if (updErr) {
                      console.error("toggle is_forum failed:", updErr);
                      alert(prefixError("Не удалось переключить режим топиков", updErr));
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
                  className="flex items-center gap-3 w-full py-2 text-sm hover:bg-[var(--kub-surface-2)] rounded-xl px-2 transition-colors text-[color:var(--kub-text)]"
                >
                  <KubIcon
                    name="hash"
                    size={17}
                    tone={chat.is_forum ? "accent" : "muted"}
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
              {isGroup && (
                <button
                  onClick={handleLeave}
                  className="flex items-center gap-3 w-full py-2 text-sm hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] rounded-xl px-2 transition-colors text-[color:var(--kub-danger)]"
                >
                  <KubIcon name="logout" size={17} />
                  Покинуть группу
                </button>
              )}
              <button
                onClick={async () => {
                  if (!confirm("Удалить все сообщения?")) return;
                  await supabase.from("messages").update({ deleted_at: new Date().toISOString() }).eq("chat_id", chat.id);
                }}
                className="flex items-center gap-3 w-full py-2 text-sm hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] rounded-xl px-2 transition-colors text-[color:var(--kub-danger)]"
              >
                <KubIcon name="delete" size={17} />
                Очистить историю
              </button>
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
                        onClick={() => {
                          if (confirm(`Удалить ${member.full_name ?? "участника"} из чата?`)) {
                            handleRemoveMember(member.id);
                          }
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
            {loadingMedia ? (
              <div className="text-center py-8 text-sm text-[color:var(--kub-muted)]">Загрузка…</div>
            ) : media.length === 0 ? (
              <div className="text-center py-8 text-sm text-[color:var(--kub-muted)]">Медиа пока нет</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1 mb-3">
                  {media.filter((m) => m.type === "image" || m.type === "video").map((m) => (
                    <div
                      key={m.id}
                      className="aspect-square rounded-lg overflow-hidden cursor-pointer border border-[color:var(--kub-border-color)]"
                      onClick={() => window.open(m.media_url!, "_blank")}
                    >
                      {m.type === "image" ? (
                        <img src={m.media_url!} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <video src={m.media_url!} className="w-full h-full object-cover" />
                      )}
                    </div>
                  ))}
                </div>
                {media.filter((m) => m.type === "file").map((m) => (
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
    </div>
  );
}
