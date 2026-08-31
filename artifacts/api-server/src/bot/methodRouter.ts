import { createHmac } from "node:crypto";

import type { Request, RequestHandler } from "express";

import { BotApiError, botSuccess, toBotApiErrorResponse } from "#bot/errors";
import { createCommandHandlers } from "#bot/methods/commands";
import { createIdentityHandlers } from "#bot/methods/identity";
import {
  createMessageHandlers,
  type BotChatActionPublisher,
} from "#bot/methods/messages";
import type {
  AuthenticatedBot,
  BotMethodRepository,
  BotTokenRepository,
} from "#bot/repository";
import {
  botMethodNameSchema,
  parseBotMethodInput,
  type BotMethodInputMap,
  type BotMethodName,
} from "#bot/schemas";

export type BotMethodContext = {
  bot: AuthenticatedBot;
  requestId: string;
  signal?: AbortSignal;
};

export type BotMethodHandler<Method extends BotMethodName = BotMethodName> = (
  context: BotMethodContext,
  input: BotMethodInputMap[Method],
) => Promise<unknown>;

export type BotMethodHandlers = {
  [Method in BotMethodName]?: BotMethodHandler<Method>;
};

export type BotMethodFingerprint = (
  method: BotMethodName,
  input: unknown,
) => string;

export function createBotRequestFingerprint(
  pepper: string,
  method: BotMethodName,
  input: unknown,
): string {
  return createHmac("sha256", pepper)
    .update(JSON.stringify({ method, input }), "utf8")
    .digest("hex");
}

export function createTask3MethodHandlers(input: {
  repository: BotMethodRepository;
  fingerprint: BotMethodFingerprint;
  publishChatAction: BotChatActionPublisher;
}): BotMethodHandlers {
  return {
    ...createIdentityHandlers(input.repository),
    ...createMessageHandlers(
      input.repository,
      input.fingerprint,
      input.publishChatAction,
    ),
    ...createCommandHandlers(input.repository, input.fingerprint),
  };
}

export function combineBotMethodHandlers(
  ...handlerSets: BotMethodHandlers[]
): BotMethodHandlers {
  return Object.assign({}, ...handlerSets);
}

export function exactAuthorizationHeader(request: Request): string | undefined {
  const rawValues: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (name?.toLowerCase() === "authorization" && value !== undefined) {
      rawValues.push(value);
    }
  }
  const distinctValues = request.headersDistinct?.authorization;
  if (
    rawValues.length > 1 ||
    (distinctValues !== undefined && distinctValues.length > 1)
  ) {
    throw new BotApiError("unauthorized");
  }
  if (rawValues.length === 0) {
    if (distinctValues?.length === 1) return distinctValues[0];
    return undefined;
  }
  if (distinctValues && distinctValues.length !== 1) {
    throw new BotApiError("unauthorized");
  }
  return rawValues[0];
}

export function createBotMethodRouter(input: {
  handlers: BotMethodHandlers;
  tokenRepository: BotTokenRepository;
}): RequestHandler {
  return async (request, response) => {
    const requestId =
      typeof request.id === "string" && request.id.length <= 128
        ? request.id
        : "unknown";
    try {
      const methodValue = request.params.method;
      const parsedMethod = botMethodNameSchema.safeParse(methodValue);
      if (!parsedMethod.success) throw new BotApiError("method_not_found");
      const method = parsedMethod.data;
      const handler = input.handlers[method] as BotMethodHandler | undefined;
      if (typeof handler !== "function") {
        throw new BotApiError("method_not_found");
      }
      const bot = await input.tokenRepository.authenticateBotToken(
        exactAuthorizationHeader(request),
      );
      const body = parseBotMethodInput(method, request.body);
      const context: BotMethodContext = { bot, requestId };
      if (method === "getUpdates") {
        const abortController = new AbortController();
        request.once("aborted", () => abortController.abort());
        context.signal = abortController.signal;
      }
      const result = await handler(context, body);
      response.json(botSuccess(result));
    } catch (error) {
      const failure = toBotApiErrorResponse(error, requestId);
      response.status(failure.status).json(failure.body);
    }
  };
}
