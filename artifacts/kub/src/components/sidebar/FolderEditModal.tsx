"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import type { Folder, FolderScope, ChatWithLastMessage, Profile } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { useIsManagerOrAdmin } from "@/hooks/useRole";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubModal, type KubIconName } from "@/components/kub";
import { cn } from "@/lib/utils";
import { FOLDER_NAME_MAX_LENGTH, limitText } from "@/lib/entityLimits";
import { requestAppConfirm } from "@/lib/appDialogs";
import { EmojiCategoryPicker } from "@/components/ui/EmojiCategoryPicker";
import { FOLDER_EMOJI_CATEGORIES } from "@/lib/emojiCatalog";
import { getChatDisplayInfo } from "@/lib/chatDisplay";

interface FolderEditModalProps {
  folder: Folder | null;
  onClose: () => void;
  folderChats: Record<string, Set<string>>;
  createFolder: (name: string, emoji: string | null, scope?: FolderScope) => Promise<Folder | null>;
  updateFolder: (id: string, patch: { name?: string; emoji?: string | null; scope?: FolderScope }) => Promise<{ ok: boolean; error?: string }>;
  deleteFolder: (id: string) => Promise<{ ok: boolean; error?: string }>;
  setChatsForFolder: (folderId: string, chatIds: string[]) => Promise<{ ok: boolean; error?: string }>;
  canManage: boolean;
}

export function FolderEditModal({
  folder,
  onClose,
  folderChats,
  createFolder,
  updateFolder,
  deleteFolder,
  setChatsForFolder,
  canManage,
}: FolderEditModalProps) {
  const { chats, currentUser } = useAppStore();
  const isStaff = useIsManagerOrAdmin();
  const supabase = createClient();

  const [name, setName] = useState(folder?.name ?? "");
  const [emoji, setEmoji] = useState<string | null>(folder?.emoji ?? null);
  const [scope, setScope] = useState<FolderScope>(folder?.scope ?? "personal");
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(() => {
    if (folder) return new Set(folderChats[folder.id] ?? []);
    return new Set();
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatorProfile, setCreatorProfile] = useState<Profile | null>(null);
  const [chatFilter, setChatFilter] = useState("");

  const filteredChats = useMemo(() => {
    const needle = chatFilter.trim().toLocaleLowerCase("ru-RU");
    if (!needle) return chats;
    return chats.filter((chat) => {
      const info = getChatDisplayInfo(chat, currentUser?.id);
      const memberNames = chat.members
        ?.flatMap((member) => [member.profile?.full_name, member.profile?.username])
        .filter(Boolean)
        .join(" ") ?? "";
      const haystack = [
        info.title,
        info.subtitle,
        chat.name,
        chat.description,
        chat.other_user?.full_name,
        chat.other_user?.username,
        memberNames,
      ].filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
      return haystack.includes(needle);
    });
  }, [chatFilter, chats, currentUser?.id]);

  const initializedForRef = useRef<string | null>(null);
  useEffect(() => {
    const fid = folder?.id ?? null;
    if (!fid) {
      initializedForRef.current = null;
      return;
    }
    if (initializedForRef.current === fid) return;
    if (!(fid in folderChats)) return;
    setSelectedChatIds(new Set(folderChats[fid] ?? []));
    initializedForRef.current = fid;
  }, [folder, folderChats]);

  useEffect(() => {
    let cancelled = false;
    const creatorId = folder?.created_by ?? folder?.user_id ?? null;
    if (!folder || folder.scope !== "shared" || !creatorId || creatorId === currentUser?.id) {
      setCreatorProfile(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", creatorId)
        .maybeSingle();
      if (!cancelled) setCreatorProfile((data as Profile | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [folder, currentUser?.id, supabase]);

  const toggleChat = (chatId: string) => {
    if (!canManage) return;
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim() || busy || !canManage) return;
    if (name.trim().length > FOLDER_NAME_MAX_LENGTH) {
      setError(`Название папки не должно быть длиннее ${FOLDER_NAME_MAX_LENGTH} символов.`);
      return;
    }
    setBusy(true);
    setError(null);
    let folderId = folder?.id;
    let lastErr: string | undefined;
    if (folder) {
      const r = await updateFolder(folder.id, { name, emoji, scope });
      if (!r.ok) lastErr = r.error;
    } else {
      const created = await createFolder(name, emoji, scope);
      folderId = created?.id;
      if (!created) lastErr = "Не удалось создать папку.";
    }
    if (!lastErr && folderId) {
      const r = await setChatsForFolder(folderId, [...selectedChatIds]);
      if (!r.ok) lastErr = r.error;
    }
    setBusy(false);
    if (lastErr) {
      setError(lastErr);
      return;
    }
    onClose();
  };

  const handleDelete = async () => {
    if (!folder || !canManage) return;
    const confirmed = await requestAppConfirm({
      title: "Удалить папку?",
      description: `Папка "${folder.name}" будет удалена. Чаты внутри папки не удаляются.`,
      confirmLabel: "Удалить",
      tone: "danger",
      icon: "delete",
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    const r = await deleteFolder(folder.id);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Не удалось удалить папку.");
      return;
    }
    onClose();
  };

  const showScopeSelector = isStaff && !folder;
  const isCreator = folder ? (folder.created_by ?? folder.user_id) === currentUser?.id : true;

  const titleNode = (
    <span className="flex items-center gap-1.5">
      {folder ? "Редактировать папку" : "Новая папка"}
      {folder?.scope === "shared" && (
        <KubIcon name="group" size={13} className="text-[color:var(--kub-cyan)]" label="Общая папка" />
      )}
      {folder?.scope === "system" && (
        <KubIcon name="lock" size={13} className="text-[color:var(--kub-muted)]" label="Системная папка" />
      )}
    </span>
  );

  return (
    <KubModal
      open={true}
      onClose={onClose}
      title={titleNode}
      icon={<KubIcon name="folderAdd" size={16} />}
      size="sm"
      className="sm:h-[min(760px,calc(100vh-32px))]"
      contentClassName="flex flex-col gap-3 px-5 py-4"
      scrollBody={false}
      footer={
        <div className="flex items-center gap-2 w-full">
          {folder && canManage && (
            <KubButton
              variant="ghost"
              size="md"
              onClick={handleDelete}
              disabled={busy}
              className="text-[color:var(--kub-danger)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)]"
              aria-label="Удалить папку"
            >
              <KubIcon name="delete" size={16} />
            </KubButton>
          )}
          {canManage ? (
            <KubButton
              fullWidth
              onClick={handleSave}
              disabled={!name.trim()}
              loading={busy}
            >
              {folder ? "Сохранить" : "Создать"}
            </KubButton>
          ) : (
            <KubButton variant="secondary" fullWidth onClick={onClose}>
              Закрыть
            </KubButton>
          )}
        </div>
      }
    >
      {!canManage && (
        <div className="rounded-xl px-3 py-2 text-xs bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]">
          Эту папку создал другой человек — её можно открыть, но не изменить.
        </div>
      )}

      {folder?.scope === "shared" && !isCreator && creatorProfile && (
        <div className="rounded-xl px-3 py-2 text-xs bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]">
          Общая папка. Создал:{" "}
          <span className="text-[color:var(--kub-text)] font-semibold">
            {creatorProfile.full_name ?? creatorProfile.username ?? "пользователь"}
          </span>
        </div>
      )}

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-[color:var(--kub-muted)]">
          Название
        </label>
        <input
          autoFocus={canManage}
          value={name}
          onChange={(e) => setName(limitText(e.target.value, FOLDER_NAME_MAX_LENGTH))}
          placeholder="Работа, Семья, Учёба…"
          maxLength={FOLDER_NAME_MAX_LENGTH}
          disabled={!canManage}
          className="w-full text-sm outline-none rounded-xl px-3 h-10 disabled:opacity-60 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)] focus:border-[color:var(--kub-cyan)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all"
        />
      </div>

      {showScopeSelector && (
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-[color:var(--kub-muted)]">
            Тип папки
          </label>
          <div className="flex rounded-xl p-0.5 bg-[var(--kub-bg)] border border-[color:var(--kub-border-color)]">
            {(
              [
                { v: "personal" as const, label: "Личная", icon: "lock" as KubIconName },
                { v: "shared" as const, label: "Общая", icon: "group" as KubIconName },
              ]
            ).map(({ v, label, icon }) => (
              <button
                key={v}
                type="button"
                onClick={() => setScope(v)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors",
                  scope === v
                    ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                    : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
                )}
              >
                <KubIcon name={icon} size={12} />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[color:var(--kub-muted)]">
            {scope === "shared"
              ? "Видна всем, кто состоит хотя бы в одном из чатов внутри."
              : "Видна только тебе."}
          </p>
        </div>
      )}

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-[color:var(--kub-muted)]">
          Иконка
        </label>
        <EmojiCategoryPicker
          categories={FOLDER_EMOJI_CATEGORIES}
          selected={emoji}
          onSelect={(value) => canManage && setEmoji(value)}
          allowEmpty
          disabled={!canManage}
          testIdPrefix="folder-icon"
        />
      </div>

      <div className="flex min-h-[150px] flex-1 flex-col">
        <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-[color:var(--kub-muted)]">
          Чаты в папке ({selectedChatIds.size})
        </label>
        <label className="mb-2 flex h-9 items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 focus-within:border-[color:var(--kub-cyan)]">
          <KubIcon name="search" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
          <input
            type="search"
            value={chatFilter}
            onChange={(event) => setChatFilter(event.target.value)}
            data-testid="folder-chat-search"
            placeholder="Найти чат или пользователя"
            className="min-w-0 flex-1 bg-transparent text-xs text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
          />
          {chatFilter && (
            <button
              type="button"
              onClick={() => setChatFilter("")}
              className="rounded-md p-1 text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)] hover:text-[color:var(--kub-text)]"
              aria-label="Очистить поиск чатов"
            >
              <KubIcon name="close" size={12} />
            </button>
          )}
        </label>
        <div
          data-testid="folder-chat-list"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]"
        >
          {chats.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[color:var(--kub-muted)]">
              У тебя пока нет чатов
            </p>
          ) : filteredChats.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-[color:var(--kub-muted)]">
              Чаты и пользователи не найдены
            </p>
          ) : (
            filteredChats.map((c: ChatWithLastMessage) => {
              const checked = selectedChatIds.has(c.id);
              const display = getChatDisplayInfo(c, currentUser?.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleChat(c.id)}
                  disabled={!canManage}
                  className="w-full flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[var(--kub-surface-3)] disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  <div
                    className={cn(
                      "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border",
                      checked
                        ? "bg-[var(--kub-cyan)] border-[var(--kub-cyan)]"
                        : "border-[color:var(--kub-border-color)] bg-transparent"
                    )}
                  >
                    {checked && <KubIcon name="check" size={10} className="text-[color:var(--kub-bg)]" />}
                  </div>
                  <ChatAvatar chat={c} size="sm" />
                  <span className="text-sm text-left truncate flex-1 text-[color:var(--kub-text)]">
                    {display.title}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger)] border border-[color:var(--kub-danger)]/30">
          {error}
        </div>
      )}
    </KubModal>
  );
}
