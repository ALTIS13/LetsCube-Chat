/**
 * What the chat list says about the connection (tracker item 53).
 *
 * Telegram puts it where the list's title is: «Ожидание сети...» while the
 * device has no network (`WaitingForNetwork`), «Соединение...» while it has
 * one but not the server (`Connecting`) — both read on
 * translations.telegram.org on 2026-09-28, the English in `DrKLO/Telegram`'s
 * `strings.xml`. Telegram Desktop draws the same two words in a small plate at
 * the bottom left of its chat list rather than in a title.
 *
 * Here the server is the realtime socket: a list that looks current while
 * nothing is arriving is the report's «приходится перезапускать мессенджер» in
 * its quiet form. Two rules keep it from lying in the other direction:
 *
 * - **A grace.** A socket that is replaced — a heartbeat that went
 *   unanswered, a rejoin after a network change — is down for a moment on
 *   purpose; the words appear only after two seconds of it, so a recovery
 *   that works is not announced as a failure.
 * - **Only a connection that was up.** Until the socket has opened once in
 *   this run there is nothing to have lost, and a slow first connection is
 *   the application starting, not the network failing. The price, stated: a
 *   server unreachable from the very first second shows no words until the
 *   device itself says it is offline.
 *
 * Pure, so `node --test` drives it with a clock.
 */

export type ConnectionState = "online" | "connecting" | "waiting";

export const CONNECTION_GRACE_MS = 2_000;

export const CONNECTION_STATE_TEXT: Record<Exclude<ConnectionState, "online">, string> = {
  waiting: "Ожидание сети...",
  connecting: "Соединение...",
};

export interface ConnectionObservation {
  /** `navigator.onLine`: false only when the device is sure it has no network. */
  deviceOnline: boolean;
  /** Whether the realtime socket is open now. */
  socketOpen: boolean;
}

export interface ConnectionStateMachine {
  next(observation: ConnectionObservation): ConnectionState;
}

export function createConnectionStateMachine(now: () => number = Date.now): ConnectionStateMachine {
  let everOpen = false;
  let downSince: number | null = null;
  return {
    next({ deviceOnline, socketOpen }) {
      if (socketOpen) {
        everOpen = true;
        downSince = null;
      } else if (downSince === null) {
        downSince = now();
      }
      if (!deviceOnline) return "waiting";
      if (socketOpen || !everOpen || downSince === null) return "online";
      return now() - downSince >= CONNECTION_GRACE_MS ? "connecting" : "online";
    },
  };
}
