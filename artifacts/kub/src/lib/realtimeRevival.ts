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
 * A recovery also owns a bounded follow-up: a newly opened transport can remain
 * CONNECTING forever, before the SDK can send heartbeats. It is retried without
 * requiring another foreground/network event; healthy transports are left alone.
 *
 * The cost of being wrong is small by construction: a healthy socket answers
 * in a few hundred milliseconds and the second beat is never sent.
 *
 * Pure: the socket and the timers are parameters, so `node --test` drives both.
 */

export type HeartbeatStatus = "sent" | "ok" | "error" | "timeout" | "disconnected";

export interface RevivableSocket {
  isConnected(): boolean;
  /**
   * True while a handshake is already in progress. `connect()` will not
   * replace that transport: realtime-js returns, and phoenix returns while
   * its `conn` still exists.
   */
  isConnecting?(): boolean;
  connect(): void;
  /**
   * Drops the current transport and resolves once `connect()` can open
   * another. The client's own `disconnect` does not reconnect afterwards.
   */
  disconnect?(): Promise<unknown> | unknown;
  sendHeartbeat(): unknown;
}

/** How long a probing heartbeat may go unanswered before the socket is replaced. */
export const ANSWER_MS = 4_000;

/** A new transport can stall before OPEN, when the SDK heartbeat cannot run. */
export const CONNECTING_TIMEOUT_MS = 10_000;

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
  let disposed = false;
  let reconnecting = false;
  let recovery: { handle: unknown } | null = null;

  const clearRecovery = () => {
    if (recovery !== null) timers.clear(recovery.handle);
    recovery = null;
  };

  const watchConnection = () => {
    if (disposed || recovery !== null) return;
    const pending = { handle: null as unknown };
    recovery = pending;
    pending.handle = timers.set(() => {
      if (recovery !== pending) return;
      recovery = null;
      if (disposed || socket.isConnected()) return;
      reconnect();
    }, CONNECTING_TIMEOUT_MS);
  };

  const reconnect = () => {
    if (disposed || reconnecting) return;
    clearRecovery();
    // connect() cannot replace an existing handshake or run during its drop.
    if (socket.isConnecting?.() && socket.disconnect) {
      reconnecting = true;
      void (async () => {
        try {
          await socket.disconnect!();
          if (!disposed && !socket.isConnected()) {
            clearRecovery();
            socket.connect();
            watchConnection();
          }
        } catch {
          // A failed drop never authorizes connect; retry at the bounded cadence.
          watchConnection();
        } finally {
          reconnecting = false;
        }
      })();
    } else {
      try {
        socket.connect();
      } catch {
        // A transport constructor can refuse too; no uncaught timer callback.
      } finally {
        watchConnection();
      }
    }
  };

  return {
    /** Feed every heartbeat status here; `ok` is the answer a probe waits for. */
    heartbeat(status: HeartbeatStatus) {
      if (disposed) return;
      if (status === "ok") answered = true;
      // Also supervise the SDK's own heartbeat recovery, without a UI event.
      if (status === "timeout" || status === "disconnected") watchConnection();
    },

    /** A moment of doubt. */
    doubt(): RevivalStep {
      if (disposed || reconnecting) return "connect";
      if (!socket.isConnected()) {
        // A handshake left on the route that just died still counts as
        // connecting, so `connect()` leaves it there and no probe is sent.
        // Drop it first. `connect()` during the drop is refused as well
        // (`isDisconnecting`), so the new one waits until the drop settles.
        reconnect();
        return "connect";
      }
      if (probe !== null) return "probing";
      answered = false;
      void socket.sendHeartbeat();
      probe = timers.set(() => {
        probe = null;
        if (disposed || answered) return;
        if (!socket.isConnected()) { watchConnection(); return; }
        // Unanswered: the second beat is phoenix's heartbeat timeout.
        void socket.sendHeartbeat();
        onReplaced();
        watchConnection();
      }, answerMs);
      return "probe";
    },

    dispose() {
      disposed = true;
      if (probe !== null) timers.clear(probe);
      clearRecovery();
      probe = null;
    },
  };
}
