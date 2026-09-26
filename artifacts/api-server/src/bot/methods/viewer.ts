import type { BotMethodFingerprint, BotMethodHandlers } from "#bot/methodRouter";
import { projectBotViewerReceipt, type BotMethodRepository } from "#bot/repository";

export function createViewerInterfaceHandlers(
  repository: BotMethodRepository,
  fingerprint: BotMethodFingerprint,
): Pick<BotMethodHandlers, "setViewerInterface" | "editViewerInterface" | "closeViewerInterface"> {
  return {
    async setViewerInterface(context, input) {
      const operation = await repository.setViewerInterface({
        botId: context.bot.botId,
        tokenId: context.bot.tokenId,
        callbackQueryId: input.callback_query_id,
        state: input.state,
        idempotencyKey: input.idempotency_key,
        requestFingerprint: fingerprint("setViewerInterface", input),
      });
      return projectBotViewerReceipt(operation.result, "active");
    },
    async editViewerInterface(context, input) {
      const operation = await repository.editViewerInterface({
        botId: context.bot.botId,
        tokenId: context.bot.tokenId,
        interfaceId: input.interface_id,
        expectedVersion: input.expected_version,
        state: input.state,
        idempotencyKey: input.idempotency_key,
        requestFingerprint: fingerprint("editViewerInterface", input),
      });
      return projectBotViewerReceipt(operation.result, "active");
    },
    async closeViewerInterface(context, input) {
      const operation = await repository.closeViewerInterface({
        botId: context.bot.botId,
        tokenId: context.bot.tokenId,
        interfaceId: input.interface_id,
        expectedVersion: input.expected_version,
        idempotencyKey: input.idempotency_key,
        requestFingerprint: fingerprint("closeViewerInterface", input),
      });
      return projectBotViewerReceipt(operation.result, "closed");
    },
  };
}
