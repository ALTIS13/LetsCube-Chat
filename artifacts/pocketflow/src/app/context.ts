import type { PocketFlowConfig } from "#pf/config";
import type { Logger } from "#pf/lib/logger";
import type { Db } from "#pf/store/db";
import type { BotTransport, InlineButton, InlineKeyboard } from "#pf/transport/types";

/**
 * Everything a PocketFlow feature is allowed to reach.
 *
 * Passed rather than imported, so a test can hand a feature a fake transport
 * and an in-memory clock without a module registry. `now` is here for the same
 * reason: reminders and watchers are entirely about time, and a feature that
 * calls `Date.now()` directly cannot be tested without waiting.
 */
export type AppContext = {
  config: PocketFlowConfig;
  db: Db;
  bot: BotTransport;
  log: Logger;
  now: () => Date;
  /**
   * Our own `@username`, read once at startup with `getMe`.
   *
   * Optional because a test that exercises a private-chat feature has no need
   * of it. It is only read where the bot has to recognise being addressed in a
   * group, and the absence of it there means «nobody mentioned me», which is
   * the safe answer.
   */
  botUsername?: string | null;
};

/**
 * Callback data, parsed and built in one place.
 *
 * The platform caps `callback_data` at 128 bytes, so the encoding is
 * `action:arg1:arg2` and nothing clever. Two rules matter and both are §19's:
 *
 *   - **callback_data is not authorization.** It arrives from a client and can
 *     say anything. Every handler re-reads the object from the database and
 *     checks the presser owns it; the id in the data is a lookup, never a
 *     permission.
 *   - it must fit. `buildCallbackData` refuses to produce an over-long value
 *     rather than letting the platform reject the whole keyboard later, where
 *     the failure would look like «the buttons did not appear».
 */
export const CALLBACK_SEPARATOR = ":";
export const CALLBACK_MAX_BYTES = 128;

export function buildCallbackData(action: string, ...args: string[]): string {
  const data = [action, ...args].join(CALLBACK_SEPARATOR);
  if (Buffer.byteLength(data, "utf8") > CALLBACK_MAX_BYTES) {
    throw new Error(`callback_data too long for action ${action}`);
  }
  return data;
}

export function parseCallbackData(data: string): { action: string; args: string[] } {
  const [action = "", ...args] = data.split(CALLBACK_SEPARATOR);
  return { action, args };
}

/** A keyboard from rows of buttons, dropping any row that ended up empty. */
export function keyboard(...rows: InlineButton[][]): InlineKeyboard {
  return { rows: rows.filter((row) => row.length > 0) };
}

export function button(text: string, action: string, ...args: string[]): InlineButton {
  return { text, callbackData: buildCallbackData(action, ...args) };
}
