/**
 * Whose profile a message's face and name open — and when they open none.
 *
 * ## Why this is a module rather than three lines in `MessageBubble`
 *
 * The same reason `lib/chatRowProfile.ts` is one, and the register records what
 * it cost to learn: D-283 was four lines inside a component, so the only
 * instrument that could see the decision was a browser, and no browser test
 * asked the question the label was promising. A decision that `node --test` can
 * run is a decision that can be mutated.
 *
 * ## Why the message author is the opener the compact tier was built for
 *
 * `docs/operations/reference-clients.md` §15.1 enumerated, by reading the
 * importers of Discord's wrapper module 342296, every act that opens its
 * popout. The list starts with **a message author's avatar and a message
 * author's username, as two separate anchors** — they are the commonest way a
 * person is opened in that product. In ours neither was pressable at all:
 * `MessageActorAvatar` sat in a plain `div` and the name in a plain `span`.
 *
 * ## The refusals, and that they are absences rather than dead controls
 *
 * §8 of the same document is this product's own rule: a control that cannot
 * work must be absent, not inert. So a face with no person behind it is simply
 * not a button.
 *
 *  - ~~**a bot** — there is a card to draw one day and it is not a person's.~~
 *    **Drawn since 2026-09-21.** A bot's face and name are anchors like a
 *    person's, and they open a different card: `lib/botProfile.ts` says what it
 *    holds and what a person's card holds that a bot's must not. The tier is
 *    the same rule, so a bot pressed in passing opens beside the message where
 *    there is a beside and takes the phone's screen where there is not. What is
 *    still refused below is refused for a reason that has not changed.
 *  - **a deleted bot, a deleted person** — there is no row to read.
 *  - **a system message** — nobody wrote it.
 *  - **an unresolvable actor** — `resolveMessageActor` answers `invalid` for a
 *    message carrying both a `user_id` and a `bot_id`, or a `sender` that is
 *    not the `user_id`. Drawing a card from either would be guessing.
 *
 * **Yourself is not a refusal.** Your own messages open your own card, because
 * hiding it would make the conversation inconsistent for exactly one reader;
 * the card refuses the action that makes no sense there («Открыть чат») and
 * keeps everything that does. `MemberCard` already states the same rule.
 */

import type { BotProfileSeed } from "./botProfile.ts";
import type { MessageActor } from "./messageActor.ts";

export type MessageAuthorProfileTarget =
  | { kind: "person"; userId: string }
  /**
   * The bot, with the row the message carried (D-263).
   *
   * The row travels rather than being looked up because it is already here and
   * already checked: `resolveMessageActor` answers `invalid` for a message
   * whose embedded bot is not the one its `bot_id` names, so a `bot` actor's
   * `bot` is that bot. The card still reads `bots` and `bot_commands` — this is
   * the first paint, not the answer.
   */
  | { kind: "bot"; botId: string; bot: BotProfileSeed }
  | { kind: "none"; reason: "deleted" | "system" | "invalid" };

export function messageAuthorProfileTarget(actor: MessageActor): MessageAuthorProfileTarget {
  switch (actor.kind) {
    case "user":
      return { kind: "person", userId: actor.id };
    case "bot":
      return { kind: "bot", botId: actor.id, bot: actor.bot };
    case "deleted_bot":
    case "deleted_user":
      return { kind: "none", reason: "deleted" };
    case "system":
      return { kind: "none", reason: "system" };
    default:
      return { kind: "none", reason: "invalid" };
  }
}

/** Whether the face and the name are pressable at all. */
export function messageAuthorOpensProfile(actor: MessageActor): boolean {
  return messageAuthorProfileTarget(actor).kind !== "none";
}
