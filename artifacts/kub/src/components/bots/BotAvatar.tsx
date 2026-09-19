import { MessageActorAvatar } from "@/components/ui/ChatAvatar";
import type { BotLike } from "@/lib/chatBots";
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

/**
 * The same face, for a bot known only by what a list gave us.
 *
 * `chat_bots_available` answers five columns — id, username, display name,
 * description, picture — and `chat_bot_members` is read for the same five. That
 * is everything `MessageActorAvatar` looks at: `messageActorDisplayName` reads
 * the name and the никнейм, `messageActorAvatarUrl` reads the picture, and the
 * glyph comes from the actor's kind. The timestamps `BotProfile` also declares
 * are never touched, so they are filled with the epoch rather than fetched — a
 * second read of `bots` for two columns nothing draws would be a request spent
 * on satisfying a type.
 */
export function BotLikeAvatar({
  bot,
  size = "sm",
  className,
}: {
  bot: BotLike;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <MessageActorAvatar
      actor={{
        kind: "bot",
        id: bot.id,
        bot: {
          id: bot.id,
          username: bot.username,
          display_name: bot.display_name,
          description: bot.description ?? "",
          avatar_url: bot.avatar_url ?? null,
          state: "active",
          created_at: EPOCH,
          updated_at: EPOCH,
        },
      }}
      size={size}
      className={className}
    />
  );
}

/** Never read; see `BotLikeAvatar`. */
const EPOCH = "1970-01-01T00:00:00.000Z";
