"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Camera, Edit2, Users, Image as ImageIcon, FileText, LogOut, Trash2, Bell, Check, Plus, Crown, Shield, ShieldOff, ChevronUp, Hash } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar, UserAvatar } from "@/components/ui/ChatAvatar";
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
  // Role of the current user in this chat — derived from `chat.members`.
  // Used to gate UI actions (rename, manage members, etc.).
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
  const [members, setMembers] = useState<(Profile & { role: string })[]>([]);
  const [media, setMedia] = useState<Message[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  // Load members
  useEffect(() => {
    if (!isGroup) return;
    supabase
      .from("chat_members")
      .select("role, profile:profiles(*)")
      .eq("chat_id", chat.id)
      .then(({ data }) => {
        if (data) setMembers(data.map((m) => ({ ...(m.profile as Profile), role: m.role })));
      });
  }, [chat.id, isGroup, supabase]);

  // Load media
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

  useEffect(() => {
    if (tab === "media") loadMedia();
  }, [tab, loadMedia]);

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
    const { data, error } = await supabase.storage.from("media")
      .upload(`chat-avatars/${chat.id}`, file, { upsert: true });
    if (error) return;
    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(data.path);
    await supabase.from("chats").update({ avatar_url: publicUrl }).eq("id", chat.id);
    setChats(chats.map((c) => c.id === chat.id ? { ...c, avatar_url: publicUrl } : c));
  };

  const handleLeave = async () => {
    if (!currentUser) return;
    if (!confirm("Покинуть этот чат?")) return;
    await supabase.from("chat_members").delete().eq("chat_id", chat.id).eq("user_id", currentUser.id);
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    onClose();
  };

  const handleRemoveMember = async (userId: string) => {
    await supabase.from("chat_members").delete().eq("chat_id", chat.id).eq("user_id", userId);
    setMembers((m) => m.filter((u) => u.id !== userId));
  };

  // Owner-only: promote a member → admin (or admin → member).
  // We don't allow self-demotion or touching the owner from this UI.
  const setMemberRole = async (userId: string, role: "admin" | "member") => {
    const { error } = await supabase
      .from("chat_members")
      .update({ role })
      .eq("chat_id", chat.id)
      .eq("user_id", userId);
    if (error) { console.error("setMemberRole:", error); return; }
    setMembers((ms) => ms.map((m) => m.id === userId ? { ...m, role } : m));
  };

  const roleLabel = (role: string) =>
    role === "owner" ? "Владелец" : role === "admin" ? "Администратор" : "";

  const otherUser = !isGroup ? (chat.other_user as Profile | null) : null;

  return (
    <div className="flex flex-col h-full w-full md:w-80 flex-shrink-0 border-l"
      style={{ background: "var(--tg-sidebar)", borderColor: "rgba(255,255,255,0.06)" }}>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-14 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors"
          style={{ color: "var(--tg-text-secondary)" }}>
          <X size={18} />
        </button>
        <span className="text-sm font-semibold" style={{ color: "var(--tg-text)" }}>
          {isGroup ? "Информация о группе" : "Профиль пользователя"}
        </span>
        {isOwnerOrAdmin && !editing && (
          <button onClick={() => setEditing(true)} className="ml-auto p-2 rounded-full hover:bg-white/10"
            style={{ color: "var(--tg-accent)" }}>
            <Edit2 size={16} />
          </button>
        )}
        {editing && (
          <button onClick={handleSave} disabled={saving} className="ml-auto p-2 rounded-full hover:bg-white/10"
            style={{ color: "var(--tg-accent)" }}>
            <Check size={16} />
          </button>
        )}
      </div>

      {/* Avatar + name block */}
      <div className="flex flex-col items-center py-6 px-4 gap-3 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="relative">
          <ChatAvatar
            chat={{ id: chat.id, name: chat.name, avatar_url: chat.avatar_url ?? null, type: chat.type }}
            size="xl"
          />
          {isOwnerOrAdmin && (
            <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
              style={{ background: "var(--tg-accent)" }}>
              <Camera size={14} color="#fff" />
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarChange(f); }} />
            </label>
          )}
        </div>

        {editing ? (
          <div className="w-full space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full text-sm rounded-xl px-3 py-2 outline-none text-center font-semibold"
              style={{ background: "var(--tg-input)", color: "var(--tg-text)" }} />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Описание…" rows={2}
              className="w-full text-sm rounded-xl px-3 py-2 outline-none resize-none"
              style={{ background: "var(--tg-input)", color: "var(--tg-text)" }} />
          </div>
        ) : (
          <>
            <div className="text-base font-semibold text-center" style={{ color: "var(--tg-text)" }}>
              {isGroup ? chat.name : otherUser?.full_name ?? chat.name}
            </div>
            {isGroup ? (
              <div className="text-xs" style={{ color: "var(--tg-text-secondary)" }}>
                {chat.members?.length ?? 0} участников
              </div>
            ) : (
              <div className="text-xs" style={{ color: "var(--tg-text-secondary)" }}>
                {otherUser?.username ? `@${otherUser.username}` : "Без имени пользователя"}
              </div>
            )}
            {chat.description && (
              <p className="text-xs text-center" style={{ color: "var(--tg-text-secondary)" }}>
                {chat.description}
              </p>
            )}
          </>
        )}
      </div>

      {/* Tabs */}
      {isGroup && (
        <div className="flex flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {(["info", "members", "media"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className="flex-1 py-2.5 text-xs font-medium capitalize transition-colors"
              style={{
                color: tab === t ? "var(--tg-accent)" : "var(--tg-text-secondary)",
                borderBottom: tab === t ? "2px solid var(--tg-accent)" : "2px solid transparent",
              }}>
              {t === "members" ? <Users size={14} className="mx-auto mb-0.5" /> : t === "media" ? <ImageIcon size={14} className="mx-auto mb-0.5" /> : null}
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Info tab (or private chat info) */}
        {(tab === "info" || !isGroup) && (
          <div>
            {!isGroup && otherUser?.bio && (
              <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="text-xs mb-1" style={{ color: "var(--tg-text-secondary)" }}>О себе</div>
                <div className="text-sm" style={{ color: "var(--tg-text)" }}>{otherUser.bio}</div>
              </div>
            )}
            {/* Quick actions */}
            <div className="px-4 py-3 space-y-1">
              <button className="flex items-center gap-3 w-full py-2 text-sm hover:bg-white/5 rounded-xl px-2 transition-colors"
                style={{ color: "var(--tg-text)" }}
                onClick={() => setTab("media")}>
                <ImageIcon size={17} style={{ color: "var(--tg-text-secondary)" }} />
                Общие медиа
              </button>
              <button className="flex items-center gap-3 w-full py-2 text-sm hover:bg-white/5 rounded-xl px-2 transition-colors"
                style={{ color: "var(--tg-text)" }}>
                <Bell size={17} style={{ color: "var(--tg-text-secondary)" }} />
                Отключить уведомления
              </button>
              {/* Forum-mode toggle: groups only, owner-only.  Enabling creates
                  a default "Общий" topic so the chat isn't empty after the flip. */}
              {isGroup && chat.type === "group" && isOwner && (
                <button
                  onClick={async () => {
                    const next = !chat.is_forum;
                    if (next && !confirm("Включить режим топиков? Все будущие сообщения попадут в топики.")) return;
                    if (!next && !confirm("Выключить режим топиков? Топики останутся, но сообщения снова будут в общем потоке.")) return;
                    const { error: updErr } = await supabase
                      .from("chats")
                      .update({ is_forum: next })
                      .eq("id", chat.id);
                    if (updErr) {
                      console.error("toggle is_forum failed:", updErr);
                      alert("Не удалось переключить режим топиков: " + updErr.message + ".\n\nСкорее всего, не применена SQL-миграция в Supabase. Открой SQL Editor и выполни миграцию из supabase/migrations/20260427_topics.sql.");
                      return;
                    }
                    setChats(chats.map((c) => c.id === chat.id ? { ...c, is_forum: next } : c));
                    if (next) {
                      // Create the default "Общий" topic if there isn't one yet.
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
                  className="flex items-center gap-3 w-full py-2 text-sm hover:bg-white/5 rounded-xl px-2 transition-colors"
                  style={{ color: "var(--tg-text)" }}>
                  <Hash size={17} style={{ color: chat.is_forum ? "var(--tg-accent)" : "var(--tg-text-secondary)" }} />
                  <span className="flex-1 text-left">Топики</span>
                  <span className="text-xs" style={{ color: chat.is_forum ? "var(--tg-accent)" : "var(--tg-text-secondary)" }}>
                    {chat.is_forum ? "включены" : "выключены"}
                  </span>
                </button>
              )}
            </div>
            {/* Danger zone */}
            <div className="px-4 py-3 mt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              {isGroup && (
                <button onClick={handleLeave}
                  className="flex items-center gap-3 w-full py-2 text-sm hover:bg-white/5 rounded-xl px-2 transition-colors"
                  style={{ color: "#ef4444" }}>
                  <LogOut size={17} />
                  Покинуть группу
                </button>
              )}
              <button onClick={async () => {
                if (!confirm("Удалить все сообщения?")) return;
                await supabase.from("messages").update({ deleted_at: new Date().toISOString() }).eq("chat_id", chat.id);
              }}
                className="flex items-center gap-3 w-full py-2 text-sm hover:bg-white/5 rounded-xl px-2 transition-colors"
                style={{ color: "#ef4444" }}>
                <Trash2 size={17} />
                Очистить историю
              </button>
            </div>
          </div>
        )}

        {/* Members tab */}
        {tab === "members" && isGroup && (
          <div className="py-2">
            {members.map((member) => {
              const isSelf = member.id === currentUser?.id;
              const isMemberOwner = member.role === "owner";
              const isMemberAdmin = member.role === "admin";
              // Permissions for the action buttons next to each member.
              // Owner: full control over admins and members (not over self/owner).
              // Admin: can only kick plain members.
              const canPromote = isOwner && !isSelf && member.role === "member";
              const canDemote  = isOwner && !isSelf && isMemberAdmin;
              const canRemove  = !isSelf && !isMemberOwner && (
                isOwner || (myRole === "admin" && member.role === "member")
              );
              return (
                <div key={member.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 group">
                  <UserAvatar user={member} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1" style={{ color: "var(--tg-text)" }}>
                      {isMemberOwner && (
                        <Crown size={12} className="flex-shrink-0" style={{ color: "#f5b50a" }} />
                      )}
                      {isMemberAdmin && (
                        <Shield size={12} className="flex-shrink-0" style={{ color: "var(--tg-accent)" }} />
                      )}
                      <span className="truncate">{member.full_name ?? member.username ?? "Без имени"}</span>
                      {isSelf && (
                        <span className="text-xs flex-shrink-0" style={{ color: "var(--tg-text-secondary)" }}>(вы)</span>
                      )}
                    </div>
                    {(isMemberOwner || isMemberAdmin) && (
                      <div className="text-xs" style={{ color: "var(--tg-accent)" }}>{roleLabel(member.role)}</div>
                    )}
                  </div>

                  {/* Hover actions — promote / demote / kick */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {canPromote && (
                      <button
                        onClick={() => setMemberRole(member.id, "admin")}
                        title="Сделать администратором"
                        className="p-1.5 rounded-full hover:bg-white/10 transition-all"
                        style={{ color: "var(--tg-accent)" }}
                      >
                        <ChevronUp size={14} />
                      </button>
                    )}
                    {canDemote && (
                      <button
                        onClick={() => setMemberRole(member.id, "member")}
                        title="Снять администратора"
                        className="p-1.5 rounded-full hover:bg-white/10 transition-all"
                        style={{ color: "var(--tg-text-secondary)" }}
                      >
                        <ShieldOff size={14} />
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
                        className="p-1.5 rounded-full hover:bg-white/10 transition-all"
                        style={{ color: "#ef4444" }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Media tab */}
        {tab === "media" && (
          <div className="p-2">
            {loadingMedia ? (
              <div className="text-center py-8 text-sm" style={{ color: "var(--tg-text-secondary)" }}>Загрузка…</div>
            ) : media.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: "var(--tg-text-secondary)" }}>Медиа пока нет</div>
            ) : (
              <>
                {/* Images/videos grid */}
                <div className="grid grid-cols-3 gap-1 mb-3">
                  {media.filter((m) => m.type === "image" || m.type === "video").map((m) => (
                    <div key={m.id} className="aspect-square rounded-lg overflow-hidden cursor-pointer"
                      onClick={() => window.open(m.media_url!, "_blank")}>
                      {m.type === "image" ? (
                        <img src={m.media_url!} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <video src={m.media_url!} className="w-full h-full object-cover" />
                      )}
                    </div>
                  ))}
                </div>
                {/* Files list */}
                {media.filter((m) => m.type === "file").map((m) => (
                  <a key={m.id} href={m.media_url!} target="_blank" rel="noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors"
                    style={{ color: "var(--tg-text)" }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(82,136,193,0.2)" }}>
                      <FileText size={15} style={{ color: "var(--tg-accent)" }} />
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
