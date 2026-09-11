import { useSyncExternalStore } from "react";

import {
  CHAT_CHROME_CAPSULES_ATTRIBUTE,
  CHAT_CHROME_DEPTH_ATTRIBUTE,
  CHAT_CHROME_OPTION_STORAGE_KEY,
  chatChromeFlags,
  resolveChatChromeOption,
  type ChatChromeFlags,
  type ChatChromeOption,
} from "@/lib/chatChromeOptions";

/**
 * Where the DEV design options for the phone chat screen meet the page. What
 * each option is lives in `lib/chatChromeOptions.ts`.
 *
 * The option is read once, as this module loads, from storage: the render script
 * sets it before the page opens, and a developer sets it by hand and reloads.
 * Nothing switches it under an open conversation, so no component has to
 * subscribe to it.
 *
 * In a production build `import.meta.env.DEV` is the literal `false`. Storage is
 * never read, no attribute is set, the stylesheet import below goes with its
 * branch, and every flag the hook returns is false.
 */

function readStoredOption(): string | null {
  try {
    return window.localStorage.getItem(CHAT_CHROME_OPTION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export const CHAT_CHROME_OPTION: ChatChromeOption =
  import.meta.env.DEV && typeof window !== "undefined"
    ? resolveChatChromeOption({ DEV: import.meta.env.DEV }, readStoredOption())
    : "current";

const FLAGS: ChatChromeFlags = chatChromeFlags(CHAT_CHROME_OPTION);

if (import.meta.env.DEV && typeof document !== "undefined" && CHAT_CHROME_OPTION !== "current") {
  const root = document.documentElement;
  if (FLAGS.capsules) root.setAttribute(CHAT_CHROME_CAPSULES_ATTRIBUTE, "");
  if (FLAGS.depth) root.setAttribute(CHAT_CHROME_DEPTH_ATTRIBUTE, "");
  // The one import of the options' stylesheet, and only when an option is
  // chosen: the current look is photographed without it loaded at all.
  void import("@/styles/chatChromeOptions.css");
}

/**
 * Below Tailwind's `md`, which is 48rem. From there the pane headers are no
 * longer the top of the screen (rule 13 of docs/operations/interface-material.md)
 * and the bars stay, so the capsules follow the width. The stylesheet's fades
 * use the same query.
 */
const PHONE_QUERY = "(max-width: 47.99rem)";

const NONE: ChatChromeFlags = { capsules: false, depth: false };
const noSubscription = () => () => undefined;
const notPhone = () => false;

function subscribeToPhone(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function isPhone() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
}

/**
 * The flags for the component asking. The capsules are a phone layout, so they
 * follow the width; the colour applies at every width. With no option chosen the
 * hook subscribes to nothing.
 */
export function useChatChromeOptions(): ChatChromeFlags {
  const phone = useSyncExternalStore(
    FLAGS.capsules ? subscribeToPhone : noSubscription,
    FLAGS.capsules ? isPhone : notPhone,
    notPhone,
  );
  if (!FLAGS.capsules && !FLAGS.depth) return NONE;
  return { capsules: FLAGS.capsules && phone, depth: FLAGS.depth };
}
