"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";

interface Folder {
  id: string | null;
  name: string;
  emoji: string | null;
  unread?: number;
}

interface FolderTabsProps {
  folders: Folder[];
  activeFolder: string | null;
  onFolderChange: (id: string | null) => void;
  /** When provided, renders a "+" tab at the end that triggers folder creation. */
  onCreate?: () => void;
  /**
   * When provided, clicking an already-active CUSTOM folder opens its edit
   * modal.  The "Все" folder (id === null) is excluded — it has nothing to edit.
   */
  onEdit?: (id: string) => void;
}

export function FolderTabs({ folders, activeFolder, onFolderChange, onCreate, onEdit }: FolderTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hide entirely only when there are no custom folders AND no "+"-affordance.
  if (folders.length <= 1 && !onCreate) return null;

  return (
    <div
      ref={scrollRef}
      className="flex items-center overflow-x-auto no-scrollbar flex-shrink-0"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
    >
      {folders.map((folder) => {
        const isActive = activeFolder === folder.id;
        const handleClick = () => {
          if (isActive && onEdit && folder.id !== null) onEdit(folder.id);
          else onFolderChange(folder.id);
        };
        return (
          <button
            key={folder.id ?? "all"}
            onClick={handleClick}
            className="relative flex items-center gap-1.5 px-4 py-3 text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0"
            style={{ color: isActive ? "var(--tg-accent)" : "var(--tg-text-secondary)" }}
          >
            {folder.emoji && <span className="text-sm">{folder.emoji}</span>}
            <span className="uppercase tracking-wide text-[11px]">{folder.name}</span>
            {(folder.unread ?? 0) > 0 && !isActive && (
              <span
                className="min-w-[16px] h-4 rounded-full text-[10px] font-semibold flex items-center justify-center px-1"
                style={{ background: "var(--tg-unread)", color: "#fff" }}
              >
                {folder.unread}
              </span>
            )}
            {isActive && (
              <span
                className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                style={{ background: "var(--tg-accent)" }}
              />
            )}
          </button>
        );
      })}
      {onCreate && (
        <button
          onClick={onCreate}
          title="Новая папка"
          className="flex items-center justify-center px-3 py-3 transition-colors flex-shrink-0 hover:bg-white/5"
          style={{ color: "var(--tg-text-secondary)" }}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
