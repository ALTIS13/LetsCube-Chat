import { randomUUID } from "node:crypto";

import express, { type ErrorRequestHandler, type Express } from "express";
import type { Logger } from "pino";
import pinoHttp from "pino-http";

import { BotApiError, toBotApiErrorResponse } from "#bot/errors";
import {
  createBotMethodRouter,
  type BotMethodHandlers,
} from "#bot/methodRouter";
import type { BotTokenRepository } from "#bot/repository";

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function createBotGatewayApp(input: {
  logger: Logger;
  handlers: BotMethodHandlers;
  tokenRepository: BotTokenRepository;
  requestId?: () => string;
}): Express {
  const app = express();
  const requestId = input.requestId ?? randomUUID;
  app.disable("x-powered-by");
  app.use(
    pinoHttp({
      logger: input.logger,
      genReqId() {
        const generated = requestId();
        return SAFE_ID.test(generated) ? generated : randomUUID();
      },
      redact: ["req.headers.authorization"],
      serializers: {
        req(request) {
          return {
            id:
              typeof request.id === "string" && SAFE_ID.test(request.id)
                ? request.id
                : "unknown",
            method:
              typeof request.method === "string"
                ? request.method.slice(0, 16)
                : undefined,
            path:
              typeof request.url === "string"
                ? request.url.split("?", 1)[0]?.slice(0, 256)
                : undefined,
          };
        },
        res(response) {
          return { statusCode: response.statusCode };
        },
      },
    }),
  );
  app.use(express.json({ limit: "256kb", strict: true }));
  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, service: "letscube-bot-gateway" });
  });
  app.post(
    "/bot/v1/:method",
    createBotMethodRouter({
      handlers: input.handlers,
      tokenRepository: input.tokenRepository,
    }),
  );

  const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
    const requestId =
      typeof request.id === "string" && SAFE_ID.test(request.id)
        ? request.id
        : "unknown";
    const status =
      error && typeof error === "object" && "status" in error
        ? (error as { status?: unknown }).status
        : undefined;
    const type =
      error && typeof error === "object" && "type" in error
        ? (error as { type?: unknown }).type
        : undefined;
    const safeError =
      status === 413 || type === "entity.too.large"
        ? new BotApiError("payload_too_large")
        : status === 400 || error instanceof SyntaxError
          ? new BotApiError("validation_failed")
          : new BotApiError("internal_error");
    const failure = toBotApiErrorResponse(safeError, requestId);
    response.status(failure.status).json(failure.body);
  };
  app.use(errorHandler);
  return app;
}
