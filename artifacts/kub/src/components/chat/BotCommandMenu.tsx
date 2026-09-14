"use client";

import { KubIcon } from "@/components/kub";
import {
  BOT_COMMANDS_EMPTY,
  BOT_COMMANDS_NO_MATCH,
  botCommandSlash,
  type BotCommand,
} from "@/lib/botChatSurfaces";
import { FOCUS_RING } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";

/**
 * The commands a bot registered, offered where they are used (D-126).
 *
 * One list with two doors, which is Telegram's arrangement: a «Команды» button
 * beside the field opens the whole list, and typing «/» filters the same list
 * in place. They are the same component because they are the same list — two
 * renderings of it would drift on the first change to a row, and the person
 * would meet two different menus for one bot.
 *
 * What choosing a row does is in `botCommandDraft`: it fills the field and
 * stops. It does not send. A command that takes an argument — «/shift 12» — is
 * unusable from a menu that sends on the choice, and a person who meant to read
 * the list has not agreed to say anything yet.
 *
 * The empty state is two sentences, not one: a bot with no commands at all and
 * a «/» that matches none of the ones it has are different facts, and one word
 * for both leaves the person retyping to find out which they hit.
 */
export function BotCommandMenu({
  commands,
  matches,
  onChoose,
  variant,
}: {
  /** Everything the bot registered, for telling «none» from «none matching». */
  commands: readonly BotCommand[];
  /** What to show now: all of them from the button, a filtered set from «/». */
  matches: readonly BotCommand[];
  onChoose: (command: BotCommand) => void;
  /** `menu` opened from the button, `typed` filtered by what is in the field. */
  variant: "menu" | "typed";
}) {
  const empty = commands.length === 0 ? BOT_COMMANDS_EMPTY : BOT_COMMANDS_NO_MATCH;

  return (
    <div
      data-testid="bot-command-menu"
      data-bot-command-variant={variant}
      role="listbox"
      aria-label="Команды бота"
      // The covering fill, because it opens over the conversation, and the lit
      // rim rather than the sheet-edge blue — the same choice `CAPSULE_GLASS`
      // makes for a surface that floats over a backdrop nobody chose, and for
      // the same reason: that colour's perimeters are held to a ratchet in
      // tests/unit/edge-vocabulary.test.mjs.
      // 420px, not the pane's width: at 1440 the chat pane is around 970 and
      // three rows of «/shift  Ближайшая смена» left two thirds of it empty,
      // which reads as a panel that failed to fill rather than a list. It is
      // the emoji sheet's arrangement — a capped panel over the conversation —
      // at the other end of the composer, because this one belongs to the
      // button that opened it. Below 444 the cap stops applying and the panel
      // is the field's width.
      className="kub-glass-strong mb-2 max-h-[240px] w-full max-w-[420px] overflow-y-auto rounded-xl border border-[color:var(--glass-line)] p-1"
    >
      {matches.length === 0 ? (
        <p className="px-3 py-2 text-xs text-[color:var(--kub-muted)]">{empty}</p>
      ) : (
        matches.map((command) => (
          <button
            key={command.command}
            type="button"
            role="option"
            aria-selected={false}
            data-bot-command={command.command}
            onClick={() => onChoose(command)}
            className={cn(
              "kub-raise-hover flex w-full min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-left",
              FOCUS_RING,
            )}
          >
            <KubIcon name="zap" size={14} tone="accent" className="shrink-0" />
            <span className="shrink-0 text-[13px] font-semibold text-[color:var(--kub-accent-text)]">
              {botCommandSlash(command)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--kub-muted)]">
              {command.description}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
