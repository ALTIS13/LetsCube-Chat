import type { Classification } from "#pf/lib/classify";
import { classify } from "#pf/lib/classify";
import { claimUpdate, releaseUpdate } from "#pf/store/updates";
import { upsertUser, type PocketFlowUser } from "#pf/store/users";
import { parseCallbackData } from "#pf/app/context";
import type { AppContext } from "#pf/app/context";
import type {
  IncomingCallbackQuery,
  IncomingMembership,
  IncomingMessage,
  Update,
} from "#pf/transport/types";

/**
 * Where an update goes.
 *
 * Features register here rather than being called from a growing `switch`, for
 * one reason that is worth stating: `/selftest` has to enumerate what the bot
 * can do, and a registry can be enumerated while a switch statement cannot. A
 * capability list written by hand next to a dispatch written by hand is two
 * lists that drift.
 */

export type MessageContext = {
  ctx: AppContext;
  message: IncomingMessage;
  user: PocketFlowUser;
  /** True when this arrived in a group rather than a one-to-one chat. */
  isGroup: boolean;
};

export type CommandContext = MessageContext & { command: string; args: string };

export type CallbackContext = {
  ctx: AppContext;
  query: IncomingCallbackQuery;
  user: PocketFlowUser;
  args: string[];
};

export type Feature = {
  name: string;
  /** Commands this feature owns, without the leading slash. */
  commands?: Record<string, (input: CommandContext) => Promise<void>>;
  /** Callback actions this feature owns, keyed by the action word. */
  callbacks?: Record<string, (input: CallbackContext) => Promise<void>>;
  /**
   * A plain (non-command) message. Return `true` if the feature took it.
   *
   * Asked in registration order, and the first `true` wins — so a feature that
   * is waiting for an answer («пришлите дату») must claim the message before
   * the inbox classifies it as a note.
   */
  onMessage?: (input: MessageContext, classification: Classification) => Promise<boolean>;
  onMembership?: (ctx: AppContext, membership: IncomingMembership) => Promise<void>;
  /** The commands this feature wants listed in the client's command menu. */
  commandList?: { command: string; description: string }[];
};

export type Router = {
  features: readonly Feature[];
  handle(ctx: AppContext, update: Update): Promise<void>;
  commandList(): { command: string; description: string }[];
};

/**
 * In a group, a bot that answers everything is a bot people remove (§9).
 *
 * The platform has its own privacy mode and, when it is on, only delivers
 * commands and mentions — but that is the platform's setting and a chat may
 * have it off. So the rule is enforced here as well: in a group, only a
 * command or a reply to one of our own messages is ours to act on. Relying on
 * the platform alone would mean the bot's manners depend on a setting made by
 * whoever added it.
 */
export function groupMessageIsForUs(
  message: IncomingMessage,
  classification: Classification,
  botUsername: string | null,
): boolean {
  if (classification.kind === "command") return true;
  if (!botUsername) return false;
  const text = message.text;
  if (!text) return false;
  // The same rule the client's own renderer uses for a mention: an `@` at the
  // start of a line or after whitespace, then the name. Matching a bare
  // substring would make «support@example.com» an address to the bot.
  const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mention = new RegExp(`(^|\\s)@${escaped}\\b`, "i");
  return mention.test(text);
}

function callbackAction(data: string): string {
  return parseCallbackData(data).action;
}

export function createRouter(features: readonly Feature[]): Router {
  // Two features claiming the same command or the same callback action is a
  // programming error that would otherwise show up as «the button sometimes
  // does the wrong thing», so it is refused at construction.
  const commands = new Map<string, (input: CommandContext) => Promise<void>>();
  const callbacks = new Map<string, (input: CallbackContext) => Promise<void>>();
  for (const feature of features) {
    for (const [name, handler] of Object.entries(feature.commands ?? {})) {
      if (commands.has(name)) {
        throw new Error(`command /${name} is claimed twice (${feature.name})`);
      }
      commands.set(name, handler);
    }
    for (const [action, handler] of Object.entries(feature.callbacks ?? {})) {
      if (callbacks.has(action)) {
        throw new Error(`callback action ${action} is claimed twice (${feature.name})`);
      }
      callbacks.set(action, handler);
    }
  }

  async function handleMessage(ctx: AppContext, message: IncomingMessage): Promise<void> {
    // A message from another bot is not input. Two bots in one group answering
    // each other is a loop that costs real money on a metered platform and is
    // trivially avoided.
    if (message.from.isBot) return;
    const userId = message.from.id;
    if (!userId) return;

    const user = await upsertUser(ctx.db, {
      userId,
      displayName: message.from.displayName,
      username: message.from.username,
      defaultTimeZone: ctx.config.defaultTimeZone,
    });
    const isGroup = message.chat.kind === "group";
    const classification = classify(message);
    const base: MessageContext = { ctx, message, user, isGroup };

    if (classification.kind === "command") {
      const handler = commands.get(classification.command);
      if (!handler) {
        // An unknown command in a group is somebody else's bot being
        // addressed; answering would be noise. In a private chat it is a
        // person who typed something, and silence reads as broken.
        if (!isGroup) {
          await ctx.bot.sendText({
            chatId: message.chat.id,
            text: "Не знаю такой команды. /help покажет, что я умею.",
          });
        }
        return;
      }
      await handler({ ...base, command: classification.command, args: classification.args });
      return;
    }

    if (isGroup && !groupMessageIsForUs(message, classification, ctx.botUsername ?? null)) return;

    for (const feature of features) {
      if (!feature.onMessage) continue;
      if (await feature.onMessage(base, classification)) return;
    }
  }

  async function handleCallback(ctx: AppContext, query: IncomingCallbackQuery): Promise<void> {
    const userId = query.from.id;
    if (!userId) return;
    const user = await upsertUser(ctx.db, {
      userId,
      displayName: query.from.displayName,
      username: query.from.username,
      defaultTimeZone: ctx.config.defaultTimeZone,
    });
    const { action, args } = parseCallbackData(query.data);
    const handler = callbacks.get(action);
    if (!handler) {
      // Answering anyway matters: on every platform with callback queries, a
      // press that is never answered leaves a spinner on the button. A button
      // whose feature was removed must still stop spinning.
      await ctx.bot.answerCallbackQuery(query.id, { text: "Эта кнопка больше не действует" });
      return;
    }
    await handler({ ctx, query, user, args });
  }

  return {
    features,
    commandList() {
      return features.flatMap((feature) => feature.commandList ?? []);
    },
    async handle(ctx, update) {
      const log = ctx.log.with({ update_id: update.updateId, kind: update.kind });

      if (update.kind === "unsupported") {
        // Claimed and dropped, but **said out loud**. §19 asks that an unknown
        // update from a future platform version not break the bot; it does not
        // ask for it to be invisible, and an unexplained silent drop is how a
        // delivery bug survives a month.
        await claimUpdate(ctx.db, update.updateId, update.kind);
        log.warn("update.unsupported", { raw_type: update.rawType });
        return;
      }

      const first = await claimUpdate(ctx.db, update.updateId, update.kind);
      if (!first) {
        log.debug("update.duplicate");
        return;
      }

      try {
        switch (update.kind) {
          case "message":
            await handleMessage(ctx, update.message);
            break;
          case "edited_message":
            // An edit is not a new instruction. Acting on it would let somebody
            // change what they asked for after the bot has already done it,
            // which is confusing rather than useful.
            log.debug("update.edit_ignored");
            break;
          case "callback_query":
            await handleCallback(ctx, update.callbackQuery);
            break;
          case "membership":
            for (const feature of features) {
              await feature.onMembership?.(ctx, update.membership);
            }
            break;
        }
      } catch (error) {
        // The claim is released so the update can be retried. Keeping it would
        // turn one transient failure into a message the bot ignores for good.
        await releaseUpdate(ctx.db, update.updateId);
        log.error("update.failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
        throw error;
      }
    },
  };
}

export { callbackAction };
