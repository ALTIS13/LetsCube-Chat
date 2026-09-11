import type { Page, WebSocketRoute } from "@playwright/test";

/**
 * A Supabase Realtime server, as far as a page can tell: the Phoenix protocol
 * that `@supabase/realtime-js` 2.x speaks (serializer `2.0.0`, frames
 * `[join_ref, ref, topic, event, payload]`), mocked with `page.routeWebSocket`.
 *
 * It answers joins with server-side ids for each `postgres_changes` binding,
 * replies to heartbeats and every other push that waits for one, and delivers a
 * change to every joined channel whose binding matches its table, event and
 * `column=eq.value` filter — which is what the real server does, so a message
 * reaches both the sidebar's channel and the open chat's. Nothing leaves the
 * machine: no connection to any server is ever made.
 *
 * `dropConnections` closes the sockets from the server side, so the client
 * reconnects and rejoins exactly as it does after a real outage.
 */

type Binding = { id: number; event: string; schema: string; table: string; filter?: string };
type Channel = { topic: string; joinRef: string | null; bindings: Binding[] };
type Socket = { ws: WebSocketRoute; channels: Map<string, Channel>; open: boolean };

export interface RealtimeChange {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: Record<string, unknown>;
  old_record?: Record<string, unknown>;
}

export class RealtimeFixture {
  private readonly sockets: Socket[] = [];
  private nextBindingId = 1;
  /** Every topic joined, in order, across reconnects. */
  readonly joins: string[] = [];

  async install(page: Page): Promise<void> {
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => this.accept(ws));
  }

  /** Whether a channel whose topic contains `part` is joined on an open socket. */
  isJoined(part: string): boolean {
    return this.sockets.some((socket) => socket.open && [...socket.channels.keys()].some((topic) => topic.includes(part)));
  }

  /** How many joins of a topic containing `part` there have been, reconnects included. */
  joinCount(part: string): number {
    return this.joins.filter((topic) => topic.includes(part)).length;
  }

  /** Delivers a change to every matching channel. Returns the number of channels it reached. */
  emit(change: RealtimeChange): number {
    let delivered = 0;
    for (const socket of this.sockets) {
      if (!socket.open) continue;
      for (const channel of socket.channels.values()) {
        const ids = channel.bindings
          .filter((binding) =>
            binding.table === change.table &&
            (binding.event === "*" || binding.event === change.type) &&
            matchesFilter(binding.filter, change.record),
          )
          .map((binding) => binding.id);
        if (!ids.length) continue;
        delivered += 1;
        socket.ws.send(JSON.stringify([
          channel.joinRef,
          null,
          channel.topic,
          "postgres_changes",
          {
            ids,
            data: {
              schema: "public",
              table: change.table,
              commit_timestamp: new Date().toISOString(),
              type: change.type,
              record: change.record,
              old_record: change.old_record ?? {},
              columns: [],
              errors: null,
            },
          },
        ]));
      }
    }
    return delivered;
  }

  async dropConnections(): Promise<void> {
    for (const socket of this.sockets) {
      if (!socket.open) continue;
      socket.open = false;
      socket.channels.clear();
      await socket.ws.close({ code: 4000, reason: "fixture outage" }).catch(() => undefined);
    }
  }

  private accept(ws: WebSocketRoute) {
    const socket: Socket = { ws, channels: new Map(), open: true };
    this.sockets.push(socket);
    ws.onMessage((raw) => {
      // Typing broadcasts are binary frames; nothing here needs them.
      if (typeof raw !== "string") return;
      let frame: unknown;
      try {
        frame = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(frame)) return;
      const [joinRef, ref, topic, event, payload] = frame as [
        string | null,
        string | null,
        string,
        string,
        Record<string, unknown> | undefined,
      ];

      if (event === "phx_join") {
        const config = (payload?.config ?? {}) as {
          postgres_changes?: Array<{ event: string; schema: string; table: string; filter?: string }>;
        };
        const bindings = (config.postgres_changes ?? []).map((binding) => ({ ...binding, id: this.nextBindingId++ }));
        socket.channels.set(topic, { topic, joinRef, bindings });
        this.joins.push(topic);
        reply(ws, joinRef, ref, topic, {
          postgres_changes: bindings.map(({ id, event: bindingEvent, schema, table, filter }) =>
            filter === undefined ? { id, event: bindingEvent, schema, table } : { id, event: bindingEvent, schema, table, filter },
          ),
        });
        return;
      }
      if (event === "phx_leave") {
        socket.channels.delete(topic);
        reply(ws, joinRef, ref, topic, {});
        return;
      }
      // Heartbeats, access tokens and anything else that waits for an answer.
      if (ref !== null) reply(ws, joinRef, ref, topic, {});
    });
    ws.onClose(() => {
      socket.open = false;
      socket.channels.clear();
    });
  }
}

function reply(ws: WebSocketRoute, joinRef: string | null, ref: string | null, topic: string, response: unknown) {
  ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response }]));
}

function matchesFilter(filter: string | undefined, record: Record<string, unknown>): boolean {
  if (!filter) return true;
  const match = filter.match(/^([a-z_]+)=eq\.(.+)$/);
  if (!match) return true;
  return String(record[match[1]]) === match[2];
}
