import { BOT_MARK_LABEL, BOT_MARK_TITLE } from "@/lib/chatBots";
import { cn } from "@/lib/utils";

/**
 * «Бот», beside a name (D-236).
 *
 * The owner's words are the test: «выглядит будто я в диалоге просто с
 * человеком». One mark, one component, drawn identically on every surface that
 * names a conversation partner — the chat list row, the chat header, the
 * information card, a search result, a forward target, the author line above a
 * message. One of them saying «бот» while the rest do not would be its own
 * defect, and the cheapest way to keep that from happening is to leave the
 * surfaces no styling decision to make.
 *
 * It is not a `KubBadge`. That component's label takes the neutral interface
 * colour and its dot carries the tone, because D-011 measured the tone-as-text
 * pairing at 2.62:1 to 4.05:1 across the surfaces a *status* chip sits on — and
 * a status chip is what it is: «Активна», «Заблокирован», a role. This is not a
 * status. It is part of a name, it sits inside a line of 13-15px text that
 * truncates around it, and a 12px bordered pill with a coloured dot reads as a
 * second piece of information rather than as an annotation on the first. The
 * shape below is the mark the product already had above a bot's messages,
 * raised from 9px to 10px so that it is legible beside a 14px title.
 *
 * `--kub-accent-text` is the accent's own text token rather than `--kub-cyan`,
 * which is the pairing rule the badge learned the hard way: the fill value does
 * not clear 4.5:1 as ink. Measured on the 14% tint over `--kub-surface` it
 * clears in both themes.
 *
 * `shrink-0` is load-bearing, not tidiness: on a 360-point phone the chat row's
 * title is the thing that must give way, and without it the mark is what
 * collapses — leaving exactly the row the defect describes.
 */
export function BotTag({ className }: { className?: string }) {
  return (
    <span
      data-bot-tag="true"
      title={BOT_MARK_TITLE}
      aria-label={BOT_MARK_TITLE}
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm px-1 py-px",
        "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)]",
        "text-[10px] font-semibold uppercase leading-[14px] tracking-wide",
        "text-[color:var(--kub-accent-text)]",
        className,
      )}
    >
      {BOT_MARK_LABEL}
    </span>
  );
}
