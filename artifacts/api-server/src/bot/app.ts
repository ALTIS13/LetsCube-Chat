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
import {
  createBotManagementRouter,
  type BotManagementDependencies,
} from "#bot/managementRoutes";

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function safeLogPath(value: unknown): string {
  if (typeof value !== "string") return "unmatched";
  const pathname = value.split("?", 1)[0];
  if (pathname === "/healthz") return "/healthz";
  if (pathname?.startsWith("/bot/manage/v1/")) {
    return "/bot/manage/v1/:resource";
  }
  if (pathname?.startsWith("/bot/v1/")) return "/bot/v1/:method";
  return "unmatched";
}

export function createBotGatewayApp(input: {
  logger: Logger;
  handlers: BotMethodHandlers;
  tokenRepository: BotTokenRepository;
  management?: BotManagementDependencies;
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
      redact: [
        "req.headers.authorization",
        "req.headers.x-letscube-bot-webhook-secret",
        "req.headers['x-letscube-bot-webhook-secret']",
      ],
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
            path: safeLogPath(request.url),
          };
        },
        res(response) {
          return { statusCode: response.statusCode };
        },
      },
    }),
  );
  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, service: "letscube-bot-gateway" });
  });
  if (input.management) {
    app.use(
      "/bot/manage/v1",
      createBotManagementRouter(input.management),
    );
  }
  app.post(
    "/bot/v1/:method",
    express.json({ limit: "256kb", strict: true }),
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
