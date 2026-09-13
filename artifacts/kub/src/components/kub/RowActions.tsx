"use client";

import { createPortal } from "react-dom";
// Direct paths, not the barrel: this module is meant to be exported from
// `./index.ts`, and importing the barrel from inside something it exports is a
// cycle. Bundlers usually survive it; the failure, when it comes, arrives as an
// undefined component at runtime rather than as an error with a cause.
import { KubIcon } from "./KubIcon";
import type { KubIconName } from "./icons";
import { readSafeAreaInsets } from "@/lib/safeArea";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * A row's actions, as a menu under the pointer or as a sheet from the foot of
 * the screen.
 *
 * Lifted out of `components/sidebar/ChatList.tsx`, where this pair was written
 * for chat rows, with two things changed and nothing else:
 *
 *  1. **The header is a slot**, not a chat. It was the only chat-specific part;
 *     `ChatAction` was already generic and the action button read nothing but
 *     the action.
 *  2. **Both are portalled to `document.body`, unconditionally, and the layer
 *     is a parameter.** This is not tidiness. A `position: fixed` overlay is
 *     confined by any ancestor carrying `backdrop-filter`, and
 *     `kub-glass-strong` carries one (`index.css:984-988`). Measured on
 *     2026-09-13 with a `fixed; inset: 0` probe inside the chat information
 *     panel: 379x900 against a 1440x900 viewport as a column, 378x618 against
 *     1000x800 floating — and **not** trapped on a phone, where that panel
 *     happens to be the whole screen. Trusting the phone's reading would ship a
 *     sheet confined to a 380px card on every computer. The panel also stands
 *     at `z-[60]`, so a reused `z-50` would render underneath it.
 *
 * The chat list passes the layer it always had, so nothing about it moves.
 */

export interface RowAction {
  id: string;
  label: string;
  icon: KubIconName;
  danger?: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

/** The menu's own size, used to decide which way it opens. */
export const ROW_MENU_WIDTH = 272;
const ROW_MENU_HEIGHT_ESTIMATE = 388;

/** What the chat list has always used, so lifting this changes nothing there. */
export const ROW_ACTIONS_DEFAULT_LAYER = 50;

export interface RowMenuPlacement {
  left: number;
  y: number;
  openUp: boolean;
  safeTop: number;
  safeBottom: number;
}

/**
 * Where a menu opened at this point may actually stand.
 *
 * The insets are read rather than assumed: on a tablet, or a phone held
 * sideways, the edges this is kept inside are the notch and the home indicator
 * rather than the glass. Zero everywhere else.
 */
export function rowMenuPlacement(position: { x: number; y: number }): RowMenuPlacement {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const safe = readSafeAreaInsets();
  const left = Math.min(
    Math.max(12 + safe.left, position.x),
    Math.max(12 + safe.left, viewportWidth - ROW_MENU_WIDTH - 12 - safe.right),
  );
  return {
    left,
    y: position.y,
    openUp: position.y > viewportHeight - safe.bottom - ROW_MENU_HEIGHT_ESTIMATE,
    safeTop: safe.top,
    safeBottom: safe.bottom,
  };
}

function RowActionButton({
  action,
  busy,
  sheet = false,
  onRun,
}: {
  action: RowAction;
  busy: boolean;
  sheet?: boolean;
  onRun: (action: RowAction) => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={action.disabled || busy}
      onClick={() => void onRun(action)}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-lg text-left text-sm transition-colors disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed",
        sheet ? "px-3 py-3" : "px-3 py-2.5",
        action.danger
          ? "text-[color:var(--kub-danger-text)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)]"
          : "text-[color:var(--kub-text)] kub-raise-hover",
      )}
    >
      <KubIcon
        name={busy ? "spinner" : action.icon}
        size={17}
        tone={action.danger ? "currentColor" : "muted"}
        className={cn("shrink-0", busy && "animate-spin")}
      />
      <span className="min-w-0 flex-1 truncate">{busy ? "Выполняем..." : action.label}</span>
    </button>
  );
}

interface RowActionsShared {
  header: ReactNode;
  actions: RowAction[];
  busyActionId: string | null;
  /** Above whatever this opens over. The chat list keeps its own; a panel needs more. */
  layer?: number;
  onClose: () => void;
  onRun: (action: RowAction) => void | Promise<void>;
}

/** Under the pointer, on a computer. */
export function RowActionMenu({
  header,
  actions,
  placement,
  busyActionId,
  layer = ROW_ACTIONS_DEFAULT_LAYER,
  onClose,
  onRun,
}: RowActionsShared & { placement: RowMenuPlacement }) {
  if (typeof document === "undefined") return null;
  const { left, y, openUp, safeTop, safeBottom } = placement;
  const style = openUp
    ? { left, bottom: Math.max(12 + safeBottom, window.innerHeight - y), zIndex: layer }
    : { left, top: Math.max(12 + safeTop, Math.min(y, window.innerHeight - 12 - safeBottom)), zIndex: layer };

  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: layer }} onClick={onClose} />
      <div
        role="menu"
        data-row-action-menu="desktop"
        data-chat-context-menu="desktop"
        className="kub-glass-strong fixed w-[272px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-[color:var(--kub-border-color)] py-1"
        style={style}
      >
        {header}
        <div className="max-h-[min(70vh,420px)] overflow-y-auto py-1">
          {actions.map((action) => (
            <RowActionButton
              key={action.id}
              action={action}
              busy={busyActionId === action.id}
              onRun={onRun}
            />
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** From the foot of the screen, under a finger. */
export function RowActionSheet({
  header,
  actions,
  busyActionId,
  layer = ROW_ACTIONS_DEFAULT_LAYER,
  onClose,
  onRun,
}: RowActionsShared) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-end bg-[color:var(--kub-bg)]/65 backdrop-blur-sm"
      style={{ zIndex: layer }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-row-action-menu="mobile"
        data-chat-context-menu="mobile"
        className="kub-glass-strong max-h-[82vh] w-full overflow-hidden rounded-t-2xl border-t border-[color:var(--kub-border-color)] pb-safe px-safe"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1.5 w-11 rounded-full bg-[var(--kub-surface-3)]" />
        {header}
        <div className="max-h-[calc(82vh-82px)] overflow-y-auto px-2 pb-3">
          {actions.map((action) => (
            <RowActionButton
              key={action.id}
              action={action}
              busy={busyActionId === action.id}
              sheet
              onRun={onRun}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The header shape both wear: an icon, a title, and a line under it. */
export function RowActionHeader({
  icon,
  iconTone = "muted",
  title,
  subtitle,
  avatar,
}: {
  icon?: KubIconName;
  iconTone?: "accent" | "muted" | "pink";
  title: string;
  subtitle?: string;
  avatar?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-[color:var(--kub-rule)] px-3 py-3">
      {avatar ?? (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--kub-surface-3)]">
          {icon && <KubIcon name={icon} size={17} tone={iconTone} />}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-[color:var(--kub-text)]">{title}</div>
        {subtitle && <div className="truncate text-xs text-[color:var(--kub-muted)]">{subtitle}</div>}
      </div>
    </div>
  );
}
