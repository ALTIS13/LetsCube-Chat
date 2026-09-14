"use client";

import { useCallback, useState } from "react";

import { KubIcon } from "@/components/kub";
import { showActionFeedback } from "@/lib/actionFeedback";
import { showAppAlert } from "@/lib/appDialogs";
import {
  BOT_CALLBACK_UNAVAILABLE,
  botButtonKey,
  type BotInlineKeyboard as BotInlineKeyboardRows,
} from "@/lib/botChatSurfaces";
import { botCallbackDoorMissing, pressBotCallback } from "@/lib/botCallback";
import { DISABLED_SINK, FOCUS_RING } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";

/**
 * The buttons a bot laid out under its message (D-125).
 *
 * Telegram's mechanic, and the parts of it that are decisions rather than
 * markup:
 *
 *   - **The keyboard is part of the message.** It sits under the bubble, in the
 *     bubble's own material and the bubble's own width, in the rows the bot
 *     wrote — never re-flowed, never re-ordered, never collapsed into a menu.
 *     A bot laying out «Да | Нет» in one row and «Отложить» beneath it is
 *     saying something with that arrangement.
 *   - **A press in flight says so on that button.** Not on the message and not
 *     on the whole keyboard: the other buttons stay pressable, because a bot is
 *     allowed to answer two presses, and freezing the question while one answer
 *     is in the air is a worse lie than letting both through.
 *   - **A failed press puts the button back.** The press is never swallowed —
 *     the button returns to its resting state and the reason is said out loud.
 *
 * Three things this deliberately does not do, each measured rather than
 * assumed — see `lib/botChatSurfaces.ts` for where each was read:
 *
 *   - **No URL buttons.** `private.bot_inline_keyboard_valid` allows a button
 *     exactly two keys, `text` and `callback_data`. A `{text, url}` button
 *     cannot be stored, so drawing one would be drawing a shape this product
 *     has no way to produce.
 *   - **No optimistic answer.** The bot's reply to a press is what the wrapper
 *     returns; nothing is shown as done before it comes back.
 *   - **No retry of its own.** A press is an event a bot may act on, so
 *     resending one without being asked could book the same shift twice.
 */
export function BotInlineKeyboard({
  messageId,
  keyboard,
}: {
  messageId: string;
  keyboard: BotInlineKeyboardRows;
}) {
  const [pending, setPending] = useState<string | null>(null);
  /**
   * The deployment has no door for a press (fact 4 of `botChatSurfaces.ts`).
   *
   * Seeded from the module flag so a keyboard scrolled into view after the
   * first press already knows, and set again from this keyboard's own answer so
   * that the one that was pressed updates without waiting for a re-render from
   * elsewhere.
   */
  const [doorMissing, setDoorMissing] = useState(() => botCallbackDoorMissing());

  const press = useCallback(
    async (key: string, callbackData: string) => {
      if (pending !== null || doorMissing) return;
      setPending(key);
      try {
        const result = await pressBotCallback({ messageId, callbackData });
        if (result.kind === "answered") {
          if (result.answer.alert) showAppAlert(result.answer.text, "Бот");
          else showActionFeedback({ kind: "info", title: result.answer.text, key: `bot-callback:${messageId}` });
          return;
        }
        if (result.failure === "missing") {
          setDoorMissing(true);
          return;
        }
        showActionFeedback({ kind: "error", title: result.message, key: `bot-callback:${messageId}:error` });
      } finally {
        // Always, and before anything else can return early: a button left
        // spinning after a failure is a press that was swallowed.
        setPending(null);
      }
    },
    [doorMissing, messageId, pending],
  );

  return (
    <div
      data-bot-keyboard="true"
      data-bot-keyboard-state={doorMissing ? "unavailable" : "ready"}
      className="mt-1 flex w-full max-w-full flex-col gap-1"
    >
      {keyboard.map((row, rowIndex) => (
        <div key={rowIndex} className="flex min-w-0 gap-1">
          {row.map((button, buttonIndex) => {
            const key = botButtonKey(rowIndex, buttonIndex);
            const busy = pending === key;
            return (
              <button
                key={key}
                type="button"
                data-bot-keyboard-button={key}
                data-bot-keyboard-busy={busy ? "true" : "false"}
                // Only the button whose press is in the air, and every button
                // once the door is known to be missing. Disabling the whole
                // keyboard for one press would be freezing the bot's question
                // while one of its answers is in flight, and a bot is allowed
                // to take two.
                disabled={doorMissing || busy}
                onClick={() => void press(key, button.callbackData)}
                // The incoming bubble's fill, because the keyboard is part of
                // what the bot said; the raise veil for the pointer, which is
                // the one step that works on a surface whose colour it does not
                // know (rule 5 of the material contract). No perimeter: the
                // fill is what separates it from the wallpaper, and the
                // sheet-edge colour is held to a ratchet.
                className={cn(
                  "kub-interactive relative flex min-h-9 min-w-0 flex-1 items-center justify-center rounded-xl bg-[var(--kub-message-in)] px-2 py-1.5 text-[13px] font-medium leading-tight text-[color:var(--kub-text)]",
                  // The pointer scale stays the design's; a finger gets the 44
                  // the product's touch-target bargain promises — the same two
                  // numbers `.kub-button` carries in index.css, written as a
                  // variant here because this control is not one.
                  "[@media(pointer:coarse)]:min-h-11",
                  FOCUS_RING,
                  // Sunk, not faded: a translucent control at reduced opacity
                  // shows the wallpaper through itself, which is the defect
                  // `control-vocabulary` names. `DISABLED_SINK` is the
                  // product's one answer for a control that is present and not
                  // offered.
                  DISABLED_SINK,
                  "kub-raise-hover",
                )}
                title={button.text}
              >
                {busy && <KubIcon name="spinner" size={14} className="mr-1.5 shrink-0 animate-spin" />}
                <span className="min-w-0 truncate">{button.text}</span>
              </button>
            );
          })}
        </div>
      ))}
      {doorMissing && (
        // Said once, under the keyboard whose buttons it explains, rather than
        // as a toast per press: it is a statement about the deployment, and a
        // toast that reappears on every press reads as a fault the person is
        // causing.
        <p role="status" className="px-1 text-[12px] leading-snug text-[color:var(--kub-muted)]">
          {BOT_CALLBACK_UNAVAILABLE}
        </p>
      )}
    </div>
  );
}
