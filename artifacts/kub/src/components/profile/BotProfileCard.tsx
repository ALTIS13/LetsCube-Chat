"use client";

import { BotFaceAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon, KubNotice } from "@/components/kub";
import { BotTag } from "@/components/bots/BotTag";
import { FOCUS_RING } from "@/lib/controlSurface";
import { BOT_COMMANDS_EMPTY, type BotCommand } from "@/lib/botChatSurfaces";
import {
  BOT_PROFILE_COMMANDS_LABEL,
  BOT_PROFILE_DESCRIPTION_LABEL,
  BOT_PROFILE_UNREACHABLE,
  botProfileCommandLabel,
  botProfileCommandsPressable,
  type BotProfileCardModel,
} from "@/lib/botProfile";
import { cn } from "@/lib/utils";

/**
 * A bot, opened from its own face (D-263, third complaint).
 *
 * The complaint was «a bot's profile answers nothing», and what this draws is
 * the answer Discord's card gives on a phone rather than Telegram's — both read
 * on `P212C6000159` on 2026-09-21 and both written down in `lib/botProfile.ts`.
 * The short version: Telegram's card answers «what is this bot» and lists no
 * commands; Discord's answers «what can it do» and its most distinctive block
 * is «Команды». The owner rates Discord's bots highest and §7 makes Discord the
 * default, so the commands are here.
 *
 * **One surface, drawn in two containers.** There is no compact/full split the
 * way a person has one, and that is a decision rather than an omission: the
 * three things that make a person's summary a summary — a capped badge strip,
 * a clamped bio, a smaller face — have no counterpart here, and a card that
 * showed half a bot's commands would be a list you cannot use with a button to
 * go and use it. So the same body is placed beside the message where there is
 * room for a beside, and fills the phone where there is not.
 *
 * Every refusal is an absence, §8's rule: no presence line, no standing in this
 * chat, no mutual groups, no «Открыть чат» — the card is opened from inside the
 * conversation it would open. Telegram's card makes the first three refusals
 * too; what it puts in their place is a count of the bot's users, which this
 * product does not have and does not invent.
 */
export function BotProfileCard({
  model,
  onChooseCommand,
}: {
  model: BotProfileCardModel;
  /**
   * What a chosen row does. The draft itself is built by the container, which
   * knows the chat's type — `botProfileCommandDraft` — so the card stays a
   * function of the model alone and a test can hand it one.
   */
  onChooseCommand: (command: BotCommand) => void;
}) {
  const pressable = botProfileCommandsPressable(model);
  return (
    <div
      className="flex flex-col px-5 py-5"
      data-testid="bot-profile-card"
      data-bot-profile-id={model.botId}
      data-bot-profile-reachable={model.reachable ? "true" : "false"}
    >
      <div className="flex flex-col items-center text-center">
        <BotFaceAvatar botId={model.botId} name={model.name} avatarUrl={model.avatarUrl} size="lg" />
        <div className="mt-3 flex max-w-full items-center justify-center gap-1.5">
          <span
            className="min-w-0 text-base font-bold text-[color:var(--kub-text)] [overflow-wrap:anywhere]"
            data-testid="bot-profile-name"
          >
            {model.name}
          </span>
          {/* The same mark the chat header, the list row and the author line
              draw. D-236 is what happens when one surface invents its own. */}
          <BotTag />
        </div>
        <div
          className="mt-1 text-sm text-[color:var(--kub-muted)] [overflow-wrap:anywhere]"
          data-testid="bot-profile-handle"
        >
          {model.handle}
        </div>
      </div>

      {!model.reachable && (
        <div className="mt-4">
          {/* Said rather than left to be discovered: the rows below are absent
              for a reason, and a card that simply had no commands would read as
              a bot that registered none. */}
          <KubNotice tone="warn" title={BOT_PROFILE_UNREACHABLE}>
            Команды снова заработают, когда владелец включит его.
          </KubNotice>
        </div>
      )}

      {model.description && (
        <section className="mt-5" data-testid="bot-profile-description">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--kub-muted)]">
            {BOT_PROFILE_DESCRIPTION_LABEL}
          </h3>
          {/* Not clamped. A person's compact card clamps a bio because the full
              card carries the whole of it; there is no second surface here, so
              clamping would hide text with nowhere to go and read it. */}
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--kub-text)] [overflow-wrap:anywhere]">
            {model.description}
          </p>
        </section>
      )}

      {model.commandsSettled && (
        <section className="mt-5" data-testid="bot-profile-commands">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--kub-muted)]">
            {BOT_PROFILE_COMMANDS_LABEL}
          </h3>
          {model.commands.length === 0 ? (
            <p className="mt-1.5 text-sm text-[color:var(--kub-muted)]">{BOT_COMMANDS_EMPTY}</p>
          ) : (
            <ul className="mt-1.5 flex flex-col">
              {model.commands.map((command) => (
                <li key={command.command}>
                  <button
                    type="button"
                    data-bot-profile-command={command.command}
                    disabled={!pressable}
                    onClick={() => onChooseCommand(command)}
                    className={cn(
                      // A row, not a chip: Discord's own card shows chips and
                      // then opens a sheet whose rows carry the description,
                      // and a bot's commands are unusable without their
                      // descriptions. This card is that sheet without the trip.
                      "flex w-full min-h-11 flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left",
                      pressable ? "kub-raise-hover" : "cursor-default opacity-60",
                      FOCUS_RING,
                    )}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-[color:var(--kub-accent-text)]">
                      <KubIcon name="zap" size={14} tone="accent" className="shrink-0" />
                      {botProfileCommandLabel(command)}
                    </span>
                    <span className="w-full text-xs text-[color:var(--kub-muted)] [overflow-wrap:anywhere]">
                      {command.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
