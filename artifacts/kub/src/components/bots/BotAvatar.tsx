import { MessageActorAvatar } from "@/components/ui/ChatAvatar";
import type { BotSummary } from "@/lib/botManagement";

/**
 * A bot's face, drawn the same way everywhere it appears (D-145, row B-03).
 *
 * The list drew a robot tile for every bot and never looked at `avatar_url`, so
 * an owner who had just uploaded a picture saw it on the settings header and
 * nowhere else — and the settings header drew it as a bare `<img>` that showed
 * an empty box if the file failed to load.
 *
 * Both now go through `MessageActorAvatar`, which is the component chat already
 * uses for a bot: it prefers the stored picture, falls back to the robot glyph
 * on the actor's own colour when there is none, and falls back to it again when
 * the picture 404s. That last part is the reason not to keep a local `<img>`
 * here — a bot avatar lives in Storage behind a policy, and a removed object
 * used to leave a blank square.
 *
 * A deleted bot is handed over as `deleted_bot` rather than `bot`, which is how
 * `resolveMessageActor` classifies the same row: its picture is gone with it,
 * and the glyph is the honest thing to draw.
 */
export function BotAvatar({
  bot,
  size = "md",
  className,
}: {
  bot: BotSummary;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <MessageActorAvatar
      actor={bot.state === "deleted" ? { kind: "deleted_bot", id: bot.id } : { kind: "bot", id: bot.id, bot }}
      size={size}
      className={className}
    />
  );
}
