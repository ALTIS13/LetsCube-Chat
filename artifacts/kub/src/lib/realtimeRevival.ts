/**
 * Asking the realtime socket whether it is alive when there is reason to doubt
 * it, and making it reconnect at once when it is not (tracker item 53).
 *
 * The socket's own watchdog is its heartbeat: every 25 s a ping, and an
 * unanswered one tears the socket down and reconnects. That is sound and it is
 * slow — after a change of network a socket can look open while its TCP
 * connection is gone, and the watchdog notices only at the next beat and one
 * more interval after it: up to fifty seconds in which nothing arrives and the
 * application looks dead. Phoenix's own return-to-the-page handler reconnects
 * only a socket that already *knows* it is closed, which a stranded one does
 * not.
 *
 * So on a moment of doubt — back online, the network type changed, the app
 * came back to the foreground — a heartbeat goes out at once, and if it is not
 * answered within `ANSWER_MS` a second one follows. A second beat while the
 * first is unanswered is exactly phoenix's heartbeat timeout: it tears the
 * socket down, errors the channels so that they rejoin, and reconnects. The
 * recovery is phoenix's own, only started when there is a reason rather than on
 * the clock. Only the public API is used (`sendHeartbeat`, `onHeartbeat`).
 *
 * The cost of being wrong is small by construction: a healthy socket answers
 * in a few hundred milliseconds and the second beat is never sent.
 *
 * Pure: the socket and the timers are parameters, so `node --test` drives both.
 */

export type HeartbeatStatus = "sent" | "ok" | "error" | "timeout" | "disconnected";

export interface RevivableSocket {
  isConnected(): boolean;
  connect(): void;
  sendHeartbeat(): unknown;
}

/** How long a probing heartbeat may go unanswered before the socket is replaced. */
export const ANSWER_MS = 4_000;

/**
 * Dispatched on `window` when a moment of doubt cut stranded reads or replaced
 * the socket, so the lists refetch as they do on `online`.
 */
export const CONNECTION_REVIVED_EVENT = "kub:connection-revived";

export type RevivalStep =
  /** The socket was closed and is being opened. */
  | "connect"
  /** A probe went out. */
  | "probe"
  /** A probe was already out; this doubt joins it. */
  | "probing";

export function createRealtimeRevival(
  socket: RevivableSocket,
  {
    answerMs = ANSWER_MS,
    onReplaced = () => {},
    timers = {
      set: (callback: () => void, ms: number): unknown => setTimeout(callback, ms),
      clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  }: {
    answerMs?: number;
    /** Called when an unanswered probe made the socket reconnect. */
    onReplaced?: () => void;
    timers?: { set: (callback: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
  } = {},
) {
  let probe: unknown = null;
  let answered = false;

  return {
    /** Feed every heartbeat status here; `ok` is the answer a probe waits for. */
    heartbeat(status: HeartbeatStatus) {
      if (status === "ok") answered = true;
    },

    /** A moment of doubt. */
    doubt(): RevivalStep {
      if (!socket.isConnected()) {
        socket.connect();
        return "connect";
      }
      if (probe !== null) return "probing";
      answered = false;
      void socket.sendHeartbeat();
      probe = timers.set(() => {
        probe = null;
        if (answered || !socket.isConnected()) return;
        // Unanswered: the second beat is phoenix's heartbeat timeout.
        void socket.sendHeartbeat();
        onReplaced();
      }, answerMs);
      return "probe";
    },

    dispose() {
      if (probe !== null) timers.clear(probe);
      probe = null;
    },
  };
}
