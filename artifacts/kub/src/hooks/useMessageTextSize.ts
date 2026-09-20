"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  clampMessageTextSize,
  MESSAGE_TEXT_LEADING_VAR,
  MESSAGE_TEXT_SIZE_DEFAULT_PX,
  MESSAGE_TEXT_SIZE_STORAGE_KEY,
  MESSAGE_TEXT_SIZE_VAR,
  messageTextLineHeight,
} from "@/lib/messageTextSize";

/**
 * The reader's message text size, kept on the device as the theme is.
 *
 * The decisions — the default, the range and why it is not Telegram's — live
 * in `@/lib/messageTextSize`, which imports nothing and is unit-tested. This
 * file is only the plumbing: read it, write it, put it on the document, and
 * tell every open pane when it changes.
 *
 * It is applied as two custom properties rather than a class, so the
 * conversation reads one number and a size taken while the page is open needs
 * no re-render of anything that is not text.
 */

const listeners = new Set<() => void>();

function readStored(): number {
  if (typeof localStorage === "undefined") return MESSAGE_TEXT_SIZE_DEFAULT_PX;
  try {
    return clampMessageTextSize(localStorage.getItem(MESSAGE_TEXT_SIZE_STORAGE_KEY));
  } catch {
    // Private mode, or a browser set to refuse site data.
    return MESSAGE_TEXT_SIZE_DEFAULT_PX;
  }
}

/** Put a size on the document. Exported so the shell can apply it before React. */
export function applyMessageTextSize(sizePx: number): void {
  if (typeof document === "undefined") return;
  const size = clampMessageTextSize(sizePx);
  const root = document.documentElement;
  root.style.setProperty(MESSAGE_TEXT_SIZE_VAR, `${size}px`);
  root.style.setProperty(MESSAGE_TEXT_LEADING_VAR, `${messageTextLineHeight(size)}px`);
}

let current: number | null = null;

function snapshot(): number {
  if (current === null) current = readStored();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab, or another window of the desktop shell, changing the size.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MESSAGE_TEXT_SIZE_STORAGE_KEY) return;
    current = readStored();
    applyMessageTextSize(current);
    for (const l of listeners) l();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** The size the product is rendering right now, and the way to change it. */
export function useMessageTextSize(): { size: number; setSize: (next: number) => void } {
  const size = useSyncExternalStore(subscribe, snapshot, () => MESSAGE_TEXT_SIZE_DEFAULT_PX);
  const setSize = useCallback((next: number) => {
    const value = clampMessageTextSize(next);
    current = value;
    try {
      localStorage.setItem(MESSAGE_TEXT_SIZE_STORAGE_KEY, String(value));
    } catch {
      // Unstorable is not unusable: the size still applies for this session.
    }
    applyMessageTextSize(value);
    for (const l of listeners) l();
  }, []);
  return { size, setSize };
}

/** Apply what was stored, once, as early as the application can. */
export function initMessageTextSize(): void {
  applyMessageTextSize(snapshot());
}
