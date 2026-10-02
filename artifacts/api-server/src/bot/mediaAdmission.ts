import { BotApiError } from "#bot/errors";

const activeBots = new Set<string>();

export type BotMediaAdmission = {
  startHandler(): void;
  release(): void;
};

export function isMediaUploadMethod(method: unknown): boolean {
  return method === "sendPhoto" || method === "sendDocument" ||
    method === "sendVideo" || method === "sendVoice";
}

export function acquireMediaAdmission(botId: string): () => void {
  // One entry per active bot is both the per-bot permit and the global count.
  if (activeBots.size >= 4 || activeBots.has(botId)) {
    throw new BotApiError("rate_limited", 1);
  }
  activeBots.add(botId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeBots.delete(botId);
  };
}
