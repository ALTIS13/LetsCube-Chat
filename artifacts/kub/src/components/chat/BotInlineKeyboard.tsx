"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { KubIcon } from "@/components/kub";
import { showActionFeedback } from "@/lib/actionFeedback";
import { showAppAlert } from "@/lib/appDialogs";
import {
  BOT_CALLBACK_UNAVAILABLE,
  botButtonKey,
  type BotInlineKeyboard as BotInlineKeyboardRows,
} from "@/lib/botChatSurfaces";
import { botCallbackDoorMissing, pressBotCallback } from "@/lib/botCallback";
import { DISABLED_SINK, FOCUS_RING, PRESS_SINK_RAISED } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";

/**
 * The buttons a bot laid out under its message (D-125).
 *
 * Telegram's mechanic, and the parts of it that are decisions rather than
 * markup:
 *
 *   - **The keyboard is part of the message.** It sits under the bubble, in the
 *     bubble's own material one step nearer, in the bubble's own width, in the
 *     rows the bot wrote — never re-flowed, never re-ordered, never collapsed
 *     into a menu.
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
 *   - **No optimistic answer.** A press is acknowledged separately from the
 *     bot's later answer, and those two states have different wording.
 *   - **No retry of its own.** A press is an event a bot may act on, so
 *     resending one without being asked could book the same shift twice.
 */
export function BotInlineKeyboard({
  messageId,
  keyboard,
  inputFieldPlaceholder,
  inputVisibleToAll = false,
  onInputSubmit,
}: {
  messageId: string;
  keyboard: BotInlineKeyboardRows;
  inputFieldPlaceholder?: string | null;
  inputVisibleToAll?: boolean;
  onInputSubmit?: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft("");
  }, [inputFieldPlaceholder, messageId]);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());
  const requestsRef = useRef(new Set<AbortController>());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const request of requestsRef.current) request.abort();
      requestsRef.current.clear();
    };
  }, []);
  /**
   * A server without the press RPC cannot accept any button in this chat.
   * Cache that capability after the first missing-function response.
   */
  const [doorMissing, setDoorMissing] = useState(() => botCallbackDoorMissing());

  const press = useCallback(
    async (key: string, callbackData: string) => {
      if (pendingRef.current.has(key) || doorMissing) return;
      pendingRef.current.add(key);
      setPending(new Set(pendingRef.current));
      const request = new AbortController();
      requestsRef.current.add(request);
      try {
        const result = await pressBotCallback({ messageId, callbackData, signal: request.signal });
        if (!mountedRef.current || result.kind === "cancelled") return;
        if (result.kind === "answered") {
          if (result.answer.alert) showAppAlert(result.answer.text, "Бот", "alert", result.accountId);
          else showActionFeedback({
            kind: "info",
            title: result.answer.text,
            key: `bot-callback:${messageId}:${key}`,
            ownerUserId: result.accountId,
          });
          return;
        }
        if (result.failure === "missing") {
          setDoorMissing(true);
          return;
        }
        showActionFeedback({ kind: "error", title: result.message, key: `bot-callback:${messageId}:error` });
      } finally {
        requestsRef.current.delete(request);
        pendingRef.current.delete(key);
        if (mountedRef.current) setPending(new Set(pendingRef.current));
      }
    },
    [doorMissing, messageId],
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
            const busy = pending.has(key);
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
                // The incoming bubble's fill **and one raise veil over it**,
                // because the keyboard is part of what the bot said and stands
                // one step nearer than the sentence it answers (D-263).
                //
                // Until this change the button took `--kub-message-in` bare —
                // the identical token the bubble above it takes — so the fill
                // step between a bot's question and its answers was exactly
                // zero. Probed at 1440 in both themes: bubble rgb(30,38,64) and
                // button rgb(30,38,64) in the dark theme, rgb(255,255,255) and
                // rgb(255,255,255) in the light one, a ratio of 1.00:1. That is
                // rule 5's measured 1.002 in a new place, and rule 11 names the
                // shape it happened to: a **target** had lost the channel its
                // hover, press and disabled states speak in, so three answers
                // under a question read as three more messages from the bot.
                //
                // The ladder is `KubButton`'s `secondary`, which is the same
                // shape for the same reason — rest one veil, hover two, press
                // three sinks — and it is written out rather than reached for
                // through `kub-raise-hover`, which is a trap here: that class
                // and `.kub-raise` set the SAME single-layer `background-image`,
                // so a control carrying both already wears its hover at rest
                // and the hover stops existing. `edge-vocabulary.test.mjs` says
                // so in as many words, and the channel dialog's «Новый канал»
                // shipped with exactly that defect before it was measured.
                //
                // Still no perimeter, and still for the ratchet's reason: the
                // sheet-edge count is held at 194 and this needs none of it. The
                // veil is relative — «one step above whatever is under me» —
                // which is what lets one declaration read correctly on a fill
                // that is near-black in one theme and white in the other.
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
                  // Rest, hover, press: one veil, two, then three sinks. The
                  // hover is spelled out because two layers of one veil have no
                  // utility of their own, and the press is `PRESS_SINK_RAISED`
                  // rather than `PRESS_SINK` because in the light theme the two
                  // veils are the same value — two sink layers would land
                  // exactly where this control's hover already is, and a
                  // hovered button would show nothing when pressed.
                  "kub-raise hover:bg-[image:linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil)),linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil))]",
                  PRESS_SINK_RAISED,
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
      {inputFieldPlaceholder && (
        <form
          data-bot-input="true"
          className="mt-1 min-w-0"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text || !onInputSubmit) return;
            if (onInputSubmit(text)) setDraft("");
          }}
        >
          <div className="flex min-w-0 items-center gap-1 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-message-in)] p-1">
            <label htmlFor={`bot-input-${messageId}`} className="sr-only">Ответ боту</label>
            <input
              id={`bot-input-${messageId}`}
              data-bot-input-field="true"
              type="text"
              value={draft}
              maxLength={4096}
              autoComplete="off"
              enterKeyHint="send"
              placeholder={inputFieldPlaceholder}
              onChange={(event) => setDraft(event.target.value)}
              disabled={!onInputSubmit}
              className="min-h-9 min-w-0 flex-1 bg-transparent px-2 text-[14px] text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)] [@media(pointer:coarse)]:min-h-11"
            />
            <button
              type="submit"
              aria-label="Отправить ответ боту"
              disabled={!onInputSubmit || !draft.trim()}
              className={cn(
                "kub-interactive flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--kub-cyan)] text-white [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
                FOCUS_RING,
                DISABLED_SINK,
              )}
            >
              <KubIcon name="send" size={18} />
            </button>
          </div>
          {inputVisibleToAll && (
            <p className="px-1 pt-1 text-[12px] leading-snug text-[color:var(--kub-muted)]">
              Ответ увидят участники чата
            </p>
          )}
        </form>
      )}
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
