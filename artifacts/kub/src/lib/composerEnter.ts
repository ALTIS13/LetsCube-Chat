/**
 * What Enter does in a message field: send it, or start a new line (tracker
 * item 71). The owner, 2026-09-28: «по кнопке enter в клавиатуре телефона не
 * отправку сообщения, а перенос по строке как в telegram».
 *
 * Telegram Web A (`src/components/middle/composer/MessageInput.tsx`,
 * Ajaxy/telegram-tt master, read 2026-09-28): `isSendShortcut` answers false
 * whenever `isMobileDevice`, which is its phone layout on iOS or Android — so
 * on a phone the keyboard's Enter is a line break and the arrow sends — and on
 * anything else Enter sends and Shift+Enter breaks the line. Telegram for
 * Android and for iOS behave the same by default.
 *
 * Kept free of the browser, so `tests/unit/composer-enter.test.mts` can put a
 * phone and a computer side by side; `enterSendsHere` reads the real one.
 */

export interface KeyboardDevice {
  userAgent: string;
  /** An iPad asks for the desktop site and says «Macintosh»; its touch points give it away. */
  maxTouchPoints: number;
  /** Whether the application is in its phone layout, below `md`. */
  phoneLayout: boolean;
}

export function enterSends(device: KeyboardDevice): boolean {
  const ios = /iPhone|iPad|iPod/i.test(device.userAgent) ||
    (/Macintosh/i.test(device.userAgent) && device.maxTouchPoints > 1);
  const android = /Android/i.test(device.userAgent);
  return !((ios || android) && device.phoneLayout);
}

/** The same question, asked of this browser now: the layout can change with the window. */
export function enterSendsHere(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return true;
  return enterSends({
    userAgent: navigator.userAgent ?? "",
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    phoneLayout: window.matchMedia?.("(min-width: 48rem)").matches === false,
  });
}
