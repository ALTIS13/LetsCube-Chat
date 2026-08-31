import type {
  BotMethodFingerprint,
  BotMethodHandlers,
} from "#bot/methodRouter";
import type { BotMethodRepository } from "#bot/repository";

export function createCommandHandlers(
  repository: BotMethodRepository,
  fingerprint: BotMethodFingerprint,
): Pick<BotMethodHandlers, "setMyCommands" | "getMyCommands"> {
  return {
    async setMyCommands(context, input) {
      const operation = await repository.replaceCommands({
        botId: context.bot.botId,
        commands: input.commands,
        idempotencyKey: input.idempotency_key,
        requestFingerprint: fingerprint("setMyCommands", input),
      });
      return operation.result;
    },

    async getMyCommands(context) {
      return repository.getCommands(context.bot.botId);
    },
  };
}
