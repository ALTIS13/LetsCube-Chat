import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import express, { type Express, type NextFunction, type Request, type Response } from "express";

import { createBotWebhookRoute, type BotWebhookRoute } from "#pf/http/botWebhookRoute";
import { createHookRoute, HOOK_ROUTE_PATH, type RateLimiter } from "#pf/http/hookRoute";
import type { PocketFlowConfig } from "#pf/config";
import type { Logger } from "#pf/lib/logger";
import type { Db } from "#pf/store/db";
import type { BotTransport, Update } from "#pf/transport/types";

/**
 * PocketFlow's HTTP surface: three routes and nothing else (§18).
 *
 *   `GET  /healthz`      — is the process alive
 *   `POST /bot/updates`  — the platform's updates, when TRANSPORT=webhook
 *   `POST /hook/:id`     — the user-facing webhook inbox (§5)
 *
 * No body parser is registered, deliberately. Both POST routes read their own
 * body with an explicit byte bound, and `express.json()` would read the body
 * *before* the routes get to decide whether the caller is even allowed to send
 * one — which is precisely the ordering the inbox exists to avoid.
 *
 * `trust proxy` is left off, also deliberately: nothing here makes a decision
 * from the client's IP address, so there is no reason to start believing a
 * header that anybody can set.
 */

export const BOT_WEBHOOK_PATH = "/bot/updates";

/** The URL to hand `setWebhook`. The platform requires https and a secret token. */
export function botWebhookUrl(publicBaseUrl: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}${BOT_WEBHOOK_PATH}`;
}

export type HttpServerDeps = {
  config: PocketFlowConfig;
  db: Db;
  bot: BotTransport;
  log: Logger;
  /**
   * Where an incoming update goes. Required for `TRANSPORT=webhook`; without
   * it the update route is not mounted at all, because a route that accepts
   * updates nobody handles is worse than a 404 — it acknowledges them.
   */
  onUpdate?: (update: Update) => void | Promise<void>;
  host?: string;
  perWebhookLimiter?: RateLimiter;
  globalLimiter?: RateLimiter;
  maxHookBodyBytes?: number;
};

export type PocketFlowHttpApp = {
  app: Express;
  /** Resolves when every accepted update has finished. */
  drain(): Promise<void>;
};

export function createApp(deps: HttpServerDeps): PocketFlowHttpApp {
  const app = express();
  // The version of a framework is not information a stranger needs.
  app.disable("x-powered-by");
  app.disable("etag");

  const startedAt = Date.now();
  app.get("/healthz", (_request: Request, response: Response) => {
    // Liveness, not readiness. It deliberately does not touch the database:
    // a probe that fails during a brief Postgres blip would restart a process
    // that was about to recover, and a health check that causes the outage it
    // reports is a familiar way to make one worse.
    response.status(200).json({
      ok: true,
      platform: deps.bot.platform,
      transport: deps.config.transport,
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  let updates: BotWebhookRoute | null = null;
  if (deps.config.transport === "webhook") {
    const secret = deps.config.webhookSecret;
    if (secret === null) {
      // `loadConfig` already refuses this combination; repeating the check
      // here means a future caller that builds a config by hand cannot mount
      // an update route with no secret on it.
      throw new Error("TRANSPORT=webhook requires WEBHOOK_SECRET");
    }
    if (!deps.onUpdate) {
      throw new Error("TRANSPORT=webhook requires an onUpdate handler");
    }
    updates = createBotWebhookRoute({
      bot: deps.bot,
      log: deps.log,
      secret,
      onUpdate: deps.onUpdate,
    });
    app.post(BOT_WEBHOOK_PATH, updates.handle);
  }

  app.post(
    HOOK_ROUTE_PATH,
    createHookRoute({
      db: deps.db,
      bot: deps.bot,
      log: deps.log,
      maxBodyBytes: deps.maxHookBodyBytes,
      perWebhookLimiter: deps.perWebhookLimiter,
      globalLimiter: deps.globalLimiter,
    }),
  );

  // A GET on a webhook address is somebody testing it in a browser. Saying
  // «POST here» is more useful than the default HTML 404, and `Allow` is what
  // a client is entitled to on a 405. The update path is listed only when it
  // is mounted: under polling it does not exist, and 405 would claim it does.
  const postOnlyPaths = updates ? [HOOK_ROUTE_PATH, BOT_WEBHOOK_PATH] : [HOOK_ROUTE_PATH];
  app.all(postOnlyPaths, (_request: Request, response: Response) => {
    response.setHeader("Allow", "POST");
    response
      .status(405)
      .json({ ok: false, error: { code: "method_not_allowed", message: "use POST" } });
  });

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ ok: false, error: { code: "not_found" } });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    deps.log.error("http.unhandled", {
      error: error instanceof Error ? error.message : "unknown",
    });
    if (!response.headersSent) {
      response.status(500).json({ ok: false, error: { code: "internal_error" } });
    }
  });

  return {
    app,
    drain: async () => {
      await updates?.drain();
    },
  };
}

export type RunningServer = {
  port: number;
  url: string;
  close(): Promise<void>;
};

export async function startHttpServer(deps: HttpServerDeps): Promise<RunningServer> {
  const { app, drain } = createApp(deps);
  const host = deps.host ?? "0.0.0.0";
  const server: Server = await new Promise((resolve, reject) => {
    const listening = app.listen(deps.config.port, host);
    listening.once("error", reject);
    listening.once("listening", () => resolve(listening));
  });

  // Slowloris in two lines: a connection that sends headers forever, and one
  // that sends a body forever. Node's defaults are generous for a browser and
  // far too generous for a machine-to-machine endpoint.
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 15_000;

  const address = server.address() as AddressInfo | null;
  const port = address?.port ?? deps.config.port;
  deps.log.info("http.listening", { port, transport: deps.config.transport });

  return {
    port,
    url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`,
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Without this, a sender holding a keep-alive connection open keeps
        // the process alive until its timeout — which looks exactly like a
        // hung shutdown.
        server.closeIdleConnections();
      });
      // Updates accepted before the close still have to finish; this is the
      // half of a graceful shutdown that a plain `server.close()` misses.
      await drain();
    },
  };
}
