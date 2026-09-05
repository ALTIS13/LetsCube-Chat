"use client";

import { useState } from "react";
import type { Folder, FolderScope, ChatWithLastMessage } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { FolderEditModal } from "./FolderEditModal";
import { cn } from "@/lib/utils";

interface FolderListModalProps {
  onClose: () => void;
  folders: Folder[];
  folderChats: Record<string, Set<string>>;
  activeFolder: string | null;
  onSelect: (id: string | null) => void;
  createFolder: (name: string, emoji: string | null, scope?: FolderScope) => Promise<Folder | null>;
  updateFolder: (id: string, patch: { name?: string; emoji?: string | null; scope?: FolderScope }) => Promise<{ ok: boolean; error?: string }>;
  deleteFolder: (id: string) => Promise<{ ok: boolean; error?: string }>;
  setChatsForFolder: (folderId: string, chatIds: string[]) => Promise<{ ok: boolean; error?: string }>;
  canManageFolder: (folder: Folder) => boolean;
}

/**
 * Mobile "Папки" screen reachable from BottomNav. Lists all folders the user
 * has access to plus an "Все чаты" entry, lets the user pick one (sets the
 * active folder filter), edit the folder, or create a new one. Renders as a
 * full-screen modal on mobile and as a centered dialog on `sm+`.
 */
export function FolderListModal({
  onClose,
  folders,
  folderChats,
  activeFolder,
  onSelect,
  createFolder,
  updateFolder,
  deleteFolder,
  setChatsForFolder,
  canManageFolder,
}: FolderListModalProps) {
  const { chats } = useAppStore();
  const [editing, setEditing] = useState<Folder | "new" | null>(null);

  const allUnread = chats.reduce((s, c: ChatWithLastMessage) => s + (c.unread_count ?? 0), 0);

  const handlePick = (id: string | null) => {
    onSelect(id);
    onClose();
  };

  return (
    <>
      <KubModal
        open
        onClose={onClose}
        title="Папки"
        icon={<KubIcon name="folderAdd" size={16} />}
        size="md"
        contentClassName="px-3 sm:px-4 py-3"
        footer={
          <KubButton
            fullWidth
            onClick={() => setEditing("new")}
            leftIcon={<KubIcon name="create" size={14} />}
          >
            Новая папка
          </KubButton>
        }
      >
        <FolderRow
          name="Все чаты"
          emoji={null}
          unread={allUnread}
          shared={false}
          isActive={activeFolder === null}
          onPick={() => handlePick(null)}
        />
        {folders.length === 0 ? (
          <p className="text-xs text-[color:var(--kub-muted)] mt-3 text-center">
            Создайте первую папку, чтобы группировать чаты.
          </p>
        ) : (
          folders.map((f) => {
            const inFolder = folderChats[f.id] ?? new Set<string>();
            const unread = chats
              .filter((c) => inFolder.has(c.id))
              .reduce((s, c) => s + (c.unread_count ?? 0), 0);
            return (
              <FolderRow
                key={f.id}
                name={f.name}
                emoji={f.emoji}
                unread={unread}
                shared={f.scope !== "personal"}
                isActive={activeFolder === f.id}
                onPick={() => handlePick(f.id)}
                onEdit={() => setEditing(f)}
                count={inFolder.size}
              />
            );
          })
        )}
      </KubModal>

      {editing !== null && (
        <FolderEditModal
          folder={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          folderChats={folderChats}
          createFolder={createFolder}
          updateFolder={updateFolder}
          deleteFolder={deleteFolder}
          setChatsForFolder={setChatsForFolder}
          canManage={editing === "new" ? true : canManageFolder(editing)}
        />
      )}
    </>
  );
}

interface FolderRowProps {
  name: string;
  emoji: string | null;
  unread: number;
  shared: boolean;
  isActive: boolean;
  count?: number;
  onPick: () => void;
  onEdit?: () => void;
}

function FolderRow({ name, emoji, unread, shared, isActive, count, onPick, onEdit }: FolderRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 mb-1.5 rounded-xl border transition-colors",
        isActive
          ? "bg-[color-mix(in_srgb,var(--kub-cyan)_12%,transparent)] border-[color:var(--kub-cyan)]/40"
          : "bg-[var(--kub-surface-2)] border-[color:var(--kub-border-color)] kub-raise-hover"
      )}
    >
      <button
        type="button"
        onClick={onPick}
        className="flex items-center gap-3 flex-1 min-w-0 px-3 py-3 text-left min-h-[48px]"
      >
        <span
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0",
            isActive
              ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
              : "bg-[var(--kub-bg)] text-[color:var(--kub-cyan)] border border-[color:var(--kub-border-color)]"
          )}
        >
          {emoji ?? <KubIcon name="folder" size={15} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold truncate text-[color:var(--kub-text)]">{name}</span>
            {shared && <KubIcon name="group" size={12} className="text-[color:var(--kub-cyan)]" />}
          </div>
          {typeof count === "number" && (
            <div className="text-[11px] text-[color:var(--kub-muted)]">
              {count} {pluralizeChats(count)}
            </div>
          )}
        </div>
        {unread > 0 && (
          <span className="min-w-[20px] h-5 rounded-full text-[11px] font-bold flex items-center justify-center px-1.5 bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] flex-shrink-0">
            {unread}
          </span>
        )}
      </button>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] mr-1"
          aria-label={`Редактировать папку «${name}»`}
        >
          <KubIcon name="edit" size={16} />
        </button>
      )}
    </div>
  );
}

function pluralizeChats(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "чат";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "чата";
  return "чатов";
}
