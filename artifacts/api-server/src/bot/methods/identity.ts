import type { BotMethodHandlers } from "#bot/methodRouter";
import type { BotMethodRepository } from "#bot/repository";

export function createIdentityHandlers(
  repository: BotMethodRepository,
): Pick<BotMethodHandlers, "getMe" | "getFile"> {
  return {
    async getMe(context) {
      return repository.getMe(context.bot.botId);
    },

    async getFile(context, input) {
      const metadata = await repository.lookupFile(
        context.bot.botId,
        input.chat_id,
        input.message_id,
      );
      const url = await repository.createSignedFileUrl(
        metadata.bucket,
        metadata.objectPath,
        60,
      );
      return {
        file_id: metadata.messageId,
        mime_type: metadata.mimeType,
        file_name: metadata.fileName,
        file_size: metadata.sizeBytes,
        url,
        expires_in: 60,
      };
    },
  };
}
