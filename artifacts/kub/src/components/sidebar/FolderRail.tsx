"use client";

import { useAppStore } from "@/store/app.store";
import { KubIcon, KubTooltip } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { FOCUS_RING_INSET, PRESS_SINK } from "@/lib/controlSurface";
import { FOLDER_RAIL_WIDTH } from "@/lib/desktopChatList";
import { cn } from "@/lib/utils";

/**
 * The folder rail, at the left edge of a computer's window.
 *
 * Telegram Desktop's `windowFiltersWidth` is 72px and `FiltersMenu` holds the
 * folder buttons **and** `_menu`, the side-menu button, at the top of them —
 * which is why the owner's screenshot 3 has no menu button above the chat list.
 * Both of those are copied here.
 *
 * The horizontal strip above the list stays. Telegram ships the two
 * arrangements as a setting (changelog 5.7.3 beta and 5.8, November 2024), and
 * the owner's decision was a rail *beside* the strip, not instead of it.
 *
 * **No glass of its own.** The rail is inside the column `Sidebar` already
 * paints one `KubGlassLayer` behind, so the two share one sheet and are told
 * apart by a `--kub-rule` hairline — a line between things on one surface,
 * which is rule 11. A second `.kub-glass` here would buy nothing: the rail and
 * the list are one column, and two sheets of material with a hairline between
 * them read as a seam rather than as depth.
 *
 * Not, to be clear, because the desktop already stacks glass. The 2026-09-12
 * assessment said it did; the measurement it asked for refuted that (`306add0`
 * on `integration/message-actions`): the chat pane carries no material at any
 * width, and there is exactly one frosted layer under every capsule on a phone
 * as on a desktop. One sheet here is the simpler answer, not a rescue.
 *
 * The counts are the ones the product already computes for `FolderTabs`. The
 * rail is handed them rather than deriving its own, so there is one arithmetic
 * and one subscription to `useChats`.
 */

export interface FolderRailTab {
  id: string | null;
  name: string;
  emoji: string | null;
  unread?: number;
  shared?: boolean;
}

interface FolderRailProps {
  folders: FolderRailTab[];
  activeFolder: string | null;
  onFolderChange: (id: string | null) => void;
  onCreate?: () => void;
  onEdit?: (id: string) => void;
  onOpenSideMenu: () => void;
  sideMenuOpen: boolean;
}

export function FolderRail({
  folders,
  activeFolder,
  onFolderChange,
  onCreate,
  onEdit,
  onOpenSideMenu,
  sideMenuOpen,
}: FolderRailProps) {
  const currentUser = useAppStore((s) => s.currentUser);

  return (
    // From `md` only: a phone has the bottom capsule and the horizontal strip,
    // and neither is this track's to change.
    //
    // `border-r` in `--kub-rule`, not the sheet edge: the rail and the list are
    // two blocks sharing the column's one sheet of glass (rule 11).
    <nav
      aria-label="Папки"
      data-testid="folder-rail"
      data-kub-folder-rail=""
      className="relative hidden h-full shrink-0 flex-col border-r border-[color:var(--kub-rule)] md:flex"
      style={{ width: `${FOLDER_RAIL_WIDTH}px` }}
    >
      {/* The side-menu button, where `FiltersMenu::_menu` puts it. */}
      <div className="flex shrink-0 items-center justify-center py-2">
        <KubTooltip label="Меню" side="right">
          <button
            type="button"
            onClick={onOpenSideMenu}
            aria-label="Меню"
            aria-haspopup="dialog"
            aria-expanded={sideMenuOpen}
            data-testid="side-menu-button"
            className={cn(
              "kub-icon-action kub-interactive flex h-11 w-11 items-center justify-center rounded-xl p-1 transition-colors kub-raise-hover",
              FOCUS_RING_INSET,
              PRESS_SINK,
            )}
          >
            {currentUser ? (
              <UserAvatar user={currentUser} size="sm" />
            ) : (
              <span className="text-[color:var(--kub-muted)]">
                <KubIcon name="menu" size={18} />
              </span>
            )}
          </button>
        </KubTooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar pb-2">
        {folders.map((folder) => {
          const isActive = activeFolder === folder.id;
          const unread = folder.unread ?? 0;
          return (
            <button
              key={folder.id ?? "all"}
              type="button"
              onClick={() => {
                // The chosen folder edits, as it does in the strip.
                if (isActive && onEdit && folder.id !== null) onEdit(folder.id);
                else onFolderChange(folder.id);
              }}
              aria-label={folder.name}
              aria-pressed={isActive}
              data-testid="folder-rail-item"
              data-folder-id={folder.id ?? "all"}
              data-active={isActive ? "true" : "false"}
              className={cn(
                "kub-button kub-interactive relative flex w-full flex-col items-center gap-1 px-1 py-2.5 transition-colors kub-raise-hover",
                FOCUS_RING_INSET,
                PRESS_SINK,
                isActive
                  ? "text-[color:var(--kub-accent-text)]"
                  : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
              )}
            >
              {/* The chosen folder is told by an accent bar and accent words —
                  the vocabulary `FolderTabs` and a selected chat row already
                  speak. A resting veil here would be the hover, which is rule
                  5's 1.002 again. */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--kub-cyan)]"
                />
              )}

              <span className="relative flex h-6 items-center justify-center">
                {folder.emoji ? (
                  <span className="text-lg leading-none">{folder.emoji}</span>
                ) : folder.id === null ? (
                  <KubIcon name="chats" size={20} />
                ) : folder.shared ? (
                  <KubIcon name="group" size={20} />
                ) : (
                  <KubIcon name="folder" size={20} />
                )}
                {unread > 0 && (
                  <span
                    data-testid="folder-rail-count"
                    className="absolute -right-3 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </span>

              <span className="w-full truncate px-0.5 text-center text-[11px] font-semibold leading-tight">
                {folder.name}
              </span>
            </button>
          );
        })}

        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            aria-label="Новая папка"
            title="Новая папка"
            className={cn(
              "kub-icon-action kub-interactive flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-cyan)]",
              FOCUS_RING_INSET,
              PRESS_SINK,
            )}
          >
            <span className="flex h-6 items-center justify-center">
              <KubIcon name="create" size={18} />
            </span>
            <span className="w-full truncate px-0.5 text-center text-[11px] font-semibold leading-tight">
              Папка
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}
