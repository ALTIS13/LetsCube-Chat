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
 * A phone turned sideways is still a phone (2026-09-30). Telegram Web A's
 * phone layout is `(max-width: 600px)`, plus a landscape clause written as
 * `(max-width: 950px and max-height: 450px)` — one malformed media feature,
 * which a browser evaluates as false (`src/hooks/useAppLayout.ts`, read
 * 2026-09-30) — so a landscape phone sends on Enter there. The native apps
 * do not change with the orientation, and neither does the keyboard. Ours
 * keeps the line break whenever the device's short side is a phone's.
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
  /** The screen's shorter side in CSS pixels, which turning the device does not change. */
  shortSide?: number;
}

/** Below this short side a touch device is a phone, whichever way it is held. */
const PHONE_SHORT_SIDE = 600;

export function enterSends(device: KeyboardDevice): boolean {
  const ios = /iPhone|iPad|iPod/i.test(device.userAgent) ||
    (/Macintosh/i.test(device.userAgent) && device.maxTouchPoints > 1);
  const android = /Android/i.test(device.userAgent);
  const phoneSized = device.phoneLayout
    || (typeof device.shortSide === "number" && device.shortSide > 0 && device.shortSide < PHONE_SHORT_SIDE);
  return !((ios || android) && phoneSized);
}

/** The same question, asked of this browser now: the layout can change with the window. */
export function enterSendsHere(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return true;
  return enterSends({
    userAgent: navigator.userAgent ?? "",
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    phoneLayout: window.matchMedia?.("(min-width: 48rem)").matches === false,
    shortSide: typeof screen === "undefined" ? undefined : Math.min(screen.width, screen.height),
  });
}
