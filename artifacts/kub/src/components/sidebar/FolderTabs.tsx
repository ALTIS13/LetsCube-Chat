"use client";

import { useEffect, useRef, useState, type WheelEvent } from "react";
import { KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";

interface Folder {
  id: string | null;
  name: string;
  emoji: string | null;
  unread?: number;
  shared?: boolean;
}

interface FolderTabsProps {
  folders: Folder[];
  activeFolder: string | null;
  onFolderChange: (id: string | null) => void;
  onCreate?: () => void;
  onEdit?: (id: string) => void;
}

export function FolderTabs({ folders, activeFolder, onFolderChange, onCreate, onEdit }: FolderTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const hidden = folders.length <= 1 && !onCreate;

  useEffect(() => {
    if (hidden) return;
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setCanScrollLeft(el.scrollLeft > 1);
      setCanScrollRight(el.scrollLeft < max - 1);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [hidden, folders.length]);

  useEffect(() => {
    if (hidden) return;
    const el = scrollRef.current;
    if (!el) return;
    const idx = folders.findIndex((f) => f.id === activeFolder);
    if (idx < 0) return;
    const target = el.children[idx] as HTMLElement | undefined;
    target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeFolder, folders, hidden]);

  if (hidden) return null;

  const scrollByStep = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
    }
  };

  return (
    // Deliberately no surface of its own. The strip sits inside the sidebar's
    // glass, so a second fill here would read as an opaque band punched through
    // the panel, and a second blur would be a blur of a blur.
    <div className="relative flex items-center flex-shrink-0 min-w-0 border-b border-[color:var(--kub-border-color)]">
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollByStep(-1)}
          aria-label="Прокрутить папки влево"
          // The fade is the panel's own fill, not a colour picked to match it:
          // read from --glass-fill it cannot drift when the material changes.
          className="absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center px-1.5 text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] transition-colors bg-gradient-to-r from-[var(--glass-fill)] from-60% to-transparent"
        >
          <KubIcon name="chevronLeft" size={14} />
        </button>
      )}

      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className="flex items-center overflow-x-auto no-scrollbar min-w-0 flex-1"
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
              className={cn(
                "kub-button kub-interactive relative flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide whitespace-nowrap transition-colors flex-shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
                isActive
                  ? "text-[color:var(--kub-accent-text)]"
                  : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
              )}
            >
              {folder.emoji && <span className="text-sm">{folder.emoji}</span>}
              {folder.shared && (
                <KubIcon
                  name="group"
                  size={11}
                  className={isActive ? "text-[color:var(--kub-accent-text)]" : "text-[color:var(--kub-muted)]"}
                  label="Общая папка"
                />
              )}
              <span>{folder.name}</span>
              {(folder.unread ?? 0) > 0 && !isActive && (
                <span className="min-w-[18px] h-[18px] rounded-full text-[12px] font-bold flex items-center justify-center px-1 bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]">
                  {folder.unread}
                </span>
              )}
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[var(--kub-cyan)] kub-glow-soft" />
              )}
            </button>
          );
        })}
        {onCreate && (
          <button
            onClick={onCreate}
            title="Новая папка"
            aria-label="Новая папка"
            className="kub-icon-action kub-interactive px-3 py-2.5 text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] kub-raise-hover transition-colors flex-shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
          >
            <KubIcon name="create" size={14} />
          </button>
        )}
      </div>

      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollByStep(1)}
          aria-label="Прокрутить папки вправо"
          className="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center px-1.5 text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] transition-colors bg-gradient-to-l from-[var(--glass-fill)] from-60% to-transparent"
        >
          <KubIcon name="chevronRight" size={14} />
        </button>
      )}
    </div>
  );
}
