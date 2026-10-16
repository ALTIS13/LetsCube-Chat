import type { Notification } from "@/types/database";

export type NotificationFeedRowV2 = Readonly<Omit<Notification, "alert_origin">>;
export type NotificationFeedCursorV2 = { created_at: string; id: string };
export type NotificationFeedPageV2 = { v: 2; rows: NotificationFeedRowV2[]; next: NotificationFeedCursorV2 | null };
export type NotificationFeedLookupV2 = { v: 2; rows: NotificationFeedRowV2[]; unavailable_ids: string[] };
export type NotificationFeedOpenV2 = {
  v: 2; barrier_event_id: string; page: NotificationFeedPageV2; lookup: NotificationFeedLookupV2;
};
export type NotificationFeedEventV2 = {
  event_id: string; recipient_id: string; notification_id: string | null;
  event_kind: "created" | "changed" | "removed" | "invalidate"; created_at: string;
};
export type NotificationFeedOwnerV2 = Readonly<{ userId: string; sessionId: string; accountEpoch: number }>;
export type NotificationFeedResyncV2 = "gap" | "overflow" | "protocol" | "read_error" | "timeout";
export type NotificationFeedPortsV2 = {
  isCurrent(owner: NotificationFeedOwnerV2): boolean;
  subscribe(receive: (event: unknown) => void, status: (status: string) => void): () => void;
  open(args: { p_limit: 30; p_held_ids: string[] }): PromiseLike<unknown>;
  page(args: { p_limit: 30 }): PromiseLike<unknown>;
  lookup(args: { p_ids: string[] }): PromiseLike<unknown>;
  onRows(rows: readonly NotificationFeedRowV2[]): void;
  // This is INSERT admission only. The consumer must still obtain fresh alert
  // authority, using isCurrent again after every await and at the actual effect.
  onCreated(row: NotificationFeedRowV2, isCurrent: () => boolean): void;
  onResync(reason: NotificationFeedResyncV2): void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
class FeedProtocolError extends Error {
  constructor() { super("notification_feed_v2:protocol"); }
}
function demand(condition: unknown): asserts condition { if (!condition) throw new FeedProtocolError(); }
function object(value: unknown): Record<string, unknown> {
  demand(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  demand(Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)));
}
function uuid(value: unknown): string { demand(typeof value === "string" && UUID.test(value)); return value; }
function timestamp(value: unknown): string {
  demand(typeof value === "string");
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  demand(parts);
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  demand(Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= days
    && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
    && (zone === "Z" || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59))
    && Number.isFinite(Date.parse(value)));
  return value;
}
function timeKey(value: string): bigint {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6));
}
function nullableTimestamp(value: unknown): string | null { return value === null ? null : timestamp(value); }
function json(value: unknown, depth = 0): Notification["payload"] {
  demand(depth <= 32);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { demand(Number.isFinite(value)); return value; }
  if (Array.isArray(value)) {
    demand(Object.keys(value).length === value.length);
    return Object.freeze(value.map(item => json(item, depth + 1))) as unknown as Notification["payload"];
  }
  const input = object(value);
  demand(Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null);
  const result = Object.create(null) as Record<string, Notification["payload"]>;
  for (const key of Object.keys(input)) result[key] = json(input[key], depth + 1);
  return Object.freeze(result);
}
function notification(value: unknown, userId: string): NotificationFeedRowV2 {
  const row = object(value);
  keys(row, ["id", "user_id", "kind", "payload", "read_at", "alert_suppressed_at", "feed_revision", "created_at"]);
  demand(uuid(row.user_id) === userId && typeof row.kind === "string" && row.kind.length > 0);
  demand(typeof row.feed_revision === "number" && Number.isSafeInteger(row.feed_revision)
    && row.feed_revision >= 1 && row.feed_revision <= 9007199254740991);
  return Object.freeze({ id: uuid(row.id), user_id: userId, kind: row.kind,
    payload: json(row.payload), read_at: nullableTimestamp(row.read_at),
    alert_suppressed_at: nullableTimestamp(row.alert_suppressed_at), feed_revision: row.feed_revision, created_at: timestamp(row.created_at) });
}
function compare(left: NotificationFeedCursorV2, right: NotificationFeedCursorV2): number {
  const a = timeKey(left.created_at), b = timeKey(right.created_at);
  return a > b ? -1 : a < b ? 1 : left.id > right.id ? -1 : left.id < right.id ? 1 : 0;
}
function uniqueRows(value: unknown, userId: string, max: number): NotificationFeedRowV2[] {
  demand(Array.isArray(value) && value.length <= max);
  const rows = value.map(item => notification(item, userId));
  demand(new Set(rows.map(row => row.id)).size === rows.length);
  return rows;
}
function requestedIds(value: readonly string[]): string[] {
  demand(Array.isArray(value) && value.length <= 100);
  return [...new Set(value.map(uuid))];
}

export function parseNotificationFeedPageV2(value: unknown, userId: string): NotificationFeedPageV2 {
  uuid(userId);
  const input = object(value); keys(input, ["v", "rows", "next"]); demand(input.v === 2);
  const rows = uniqueRows(input.rows, userId, 30);
  demand(rows.every((row, index) => index === 0 || compare(rows[index - 1], row) < 0));
  let next: NotificationFeedCursorV2 | null = null;
  if (input.next !== null) {
    const cursor = object(input.next); keys(cursor, ["created_at", "id"]);
    next = { id: uuid(cursor.id), created_at: timestamp(cursor.created_at) };
    const last = rows.at(-1);
    demand(last && next.id === last.id && next.created_at === last.created_at);
  }
  return { v: 2, rows, next };
}

export function parseNotificationFeedLookupV2(
  value: unknown, userId: string, requested: readonly string[],
): NotificationFeedLookupV2 {
  uuid(userId);
  const ids = requestedIds(requested), input = object(value);
  keys(input, ["v", "rows", "unavailable_ids"]); demand(input.v === 2);
  const rows = uniqueRows(input.rows, userId, 100);
  demand(Array.isArray(input.unavailable_ids) && input.unavailable_ids.length <= 100);
  const unavailable = input.unavailable_ids.map(uuid);
  const partition = [...rows.map(row => row.id), ...unavailable];
  demand(partition.length === ids.length && new Set(partition).size === partition.length
    && partition.every(id => ids.includes(id)));
  return { v: 2, rows, unavailable_ids: unavailable };
}

export function parseNotificationFeedOpenV2(
  value: unknown, userId: string, held: readonly string[],
): NotificationFeedOpenV2 {
  const input = object(value); keys(input, ["v", "barrier_event_id", "page", "lookup"]); demand(input.v === 2);
  const page = parseNotificationFeedPageV2(input.page, userId);
  const lookup = parseNotificationFeedLookupV2(input.lookup, userId, held);
  consistent(page, lookup);
  return { v: 2, barrier_event_id: uuid(input.barrier_event_id), page, lookup };
}

export function parseNotificationFeedEventV2(value: unknown, userId: string): NotificationFeedEventV2 {
  const input = object(value);
  keys(input, ["event_id", "recipient_id", "notification_id", "event_kind", "created_at"]);
  demand(uuid(input.recipient_id) === uuid(userId));
  const kind = input.event_kind;
  demand(kind === "created" || kind === "changed" || kind === "removed" || kind === "invalidate");
  demand(kind === "invalidate" ? input.notification_id === null : input.notification_id !== null);
  return Object.freeze({ event_id: uuid(input.event_id), recipient_id: userId,
    notification_id: input.notification_id === null ? null : uuid(input.notification_id),
    event_kind: kind, created_at: timestamp(input.created_at) });
}

function consistent(page: NotificationFeedPageV2, lookup: NotificationFeedLookupV2) {
  const missing = new Set(lookup.unavailable_ids);
  demand(page.rows.every(row => !missing.has(row.id)));
  const pageRows = new Map(page.rows.map(row => [row.id, row]));
  for (const row of lookup.rows) {
    const other = pageRows.get(row.id);
    if (other?.feed_revision === row.feed_revision) demand(sameRow(other, row));
  }
}
function scrubbed(row: NotificationFeedRowV2): boolean {
  return !!row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) && row.payload.deleted === true;
}
function forwardTimestamp(old: string | null, next: string | null): string | null {
  return old && (!next || timeKey(old) > timeKey(next)) ? old : next;
}
function forward(old: NotificationFeedRowV2 | undefined, row: NotificationFeedRowV2,
  snapshots: WeakMap<NotificationFeedRowV2, NotificationFeedRowV2>): NotificationFeedRowV2 {
  if (!old) return row;
  demand(old.id === row.id && old.user_id === row.user_id);
  const previous = snapshots.get(old) ?? old, incoming = snapshots.get(row) ?? row;
  // Older trusted frames cannot select payload/revision, but can carry a
  // read/terminal/scrub proof absent in the newer frame (e.g. read reopened).
  if (incoming.feed_revision < previous.feed_revision) return forward(row, old, snapshots);
  if (incoming.feed_revision === previous.feed_revision) { demand(sameRow(previous, incoming)); return old; }
  // Keep the authenticated revision separate from monotone display overlays.
  // A repeated raw revision must compare with its own raw fields, not with a
  // retained read/scrub value from an older revision. Entries are object-weak.
  const merged = Object.freeze({ ...row, read_at: forwardTimestamp(old.read_at, row.read_at),
    alert_suppressed_at: forwardTimestamp(old.alert_suppressed_at, row.alert_suppressed_at),
    payload: scrubbed(old) && !scrubbed(row) ? old.payload : row.payload });
  snapshots.set(merged, incoming);
  return merged;
}
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((value, index) => sameJson(value, right[index]));
  if (Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
function sameRow(left: NotificationFeedRowV2, right: NotificationFeedRowV2): boolean {
  return left.id === right.id && left.user_id === right.user_id && left.kind === right.kind
    && left.created_at === right.created_at && left.read_at === right.read_at
    && left.alert_suppressed_at === right.alert_suppressed_at && left.feed_revision === right.feed_revision
    && sameJson(left.payload, right.payload);
}

/** Pure owned transport state. Ports unwrap successful RPC data; errors reject.
 * Construct once per UID/session/epoch. The subscriber installs receive before
 * subscribing. Reconnect/timeout/overflow require an explicit restart, not a
 * timer/retry loop. No alert permission is inferred from any timestamp or ID.
 */
export function createNotificationFeedV2(
  identity: NotificationFeedOwnerV2, ports: NotificationFeedPortsV2, initial: readonly NotificationFeedRowV2[] = [],
) {
  const owner = Object.freeze({ ...identity });
  uuid(owner.userId); uuid(owner.sessionId);
  demand(Number.isSafeInteger(owner.accountEpoch) && owner.accountEpoch >= 0);
  let rows = uniqueRows([...initial], owner.userId, 30).sort(compare);
  let generation = 0, dirty = 0, disposed = false;
  let phase: "waiting" | "opening" | "live" | "stopped" = "stopped";
  let unsubscribe: (() => void) | undefined;
  let buffer: NotificationFeedEventV2[] = [];
  let openResult: NotificationFeedOpenV2 | undefined;
  let pending = false, scheduled = false, reading = false;
  const targets = new Set<string>(), candidates = new Set<string>(), creations = new Set<string>();
  // Exact immutable admission objects are per-row lifetime tokens, bounded by
  // creations. Unrelated feed dirtiness invalidates reads, not a held X effect.
  const admitted = new Map<string, NotificationFeedRowV2>();
  const snapshots = new WeakMap<NotificationFeedRowV2, NotificationFeedRowV2>();
  function current(g: number): boolean {
    if (disposed || generation !== g || phase === "stopped") return false;
    try { return ports.isCurrent(owner); } catch { return false; }
  }
  function stop(reason?: NotificationFeedResyncV2) {
    generation++; phase = "stopped"; dirty++;
    buffer = []; openResult = undefined; targets.clear(); candidates.clear(); creations.clear(); admitted.clear();
    pending = false; scheduled = false; reading = false;
    const close = unsubscribe; unsubscribe = undefined; close?.();
    if (reason && !disposed && ports.isCurrent(owner)) ports.onResync(reason);
  }
  function apply(page: NotificationFeedPageV2, lookup: NotificationFeedLookupV2, g: number) {
    consistent(page, lookup);
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const id of lookup.unavailable_ids) byId.delete(id);
    // Neither omission from page30 nor a failed read retires a held identity.
    // Known read/terminal/scrub markers stay monotone across both read frames.
    for (const row of [...page.rows, ...lookup.rows]) byId.set(row.id, forward(byId.get(row.id), row, snapshots));
    for (const [id, admission] of admitted) {
      const latest = byId.get(id);
      if (lookup.unavailable_ids.includes(id) || (latest && !sameRow(admission, latest))) admitted.delete(id);
    }
    rows = [...byId.values()].sort(compare).slice(0, 30);
    const admissions = [...candidates]; candidates.clear(); targets.clear();
    const prepared = [];
    for (const id of admissions) {
      // A delayed commit can be older than all retained page30 items. Its fresh
      // lookup row still qualifies for admission; chronology is not a watermark.
      const row = byId.get(id);
      if (!row) continue;
      admitted.set(id, row);
      const allowed = () => current(g) && phase === "live" && admitted.get(id) === row
        && !!row && row.read_at === null
        && row.alert_suppressed_at === null && !scrubbed(row);
      prepared.push({ row, allowed });
    }
    ports.onRows(Object.freeze([...rows]));
    for (const { row, allowed } of prepared) if (allowed()) ports.onCreated(row, allowed);
  }
  function schedule(g: number) {
    pending = true;
    if (reading || scheduled || !current(g) || phase !== "live") return;
    scheduled = true;
    void Promise.resolve().then(() => {
      if (!current(g)) return;
      scheduled = false;
      void read(g);
    });
  }
  async function read(g: number) {
    if (!current(g) || reading || !pending || phase !== "live") return;
    pending = false; reading = true;
    const version = dirty, ids = [...new Set([...rows.map(row => row.id), ...targets])];
    if (ids.length > 100) { stop("overflow"); return; }
    try {
      // Only a current generation with a completed own open/marker reaches this
      // read. Its empty lookup has no identities to verify and needs no RPC.
      // Keep strict parsing and post-await owner/generation/dirty fences below;
      // this local envelope must never replace a failed nonempty lookup.
      const [rawPage, rawLookup] = await Promise.all([ports.page({ p_limit: 30 }),
        ids.length === 0 ? { v: 2, rows: [], unavailable_ids: [] } : ports.lookup({ p_ids: ids })]);
      if (!current(g)) return;
      if (dirty !== version) { pending = true; return; }
      const page = parseNotificationFeedPageV2(rawPage, owner.userId);
      const lookup = parseNotificationFeedLookupV2(rawLookup, owner.userId, ids);
      apply(page, lookup, g);
    } catch (error) {
      if (current(g)) stop(error instanceof FeedProtocolError ? "protocol" : "read_error");
    } finally {
      // An old completion must not clear the reader belonging to a restarted
      // subscription (including a new same-UID/session lifetime).
      if (current(g)) { reading = false; if (pending) schedule(g); }
    }
  }
  function ingest(event: NotificationFeedEventV2, mayCreate: boolean, g: number) {
    dirty++;
    const id = event.notification_id;
    if (id) {
      targets.add(id);
      if (event.event_kind === "created") {
        const seen = creations.has(id);
        // Bound replay protection without evicting a known creation into a
        // second alert. The next subscription starts with a quiet handshake.
        if (!seen && creations.size >= 512) { stop("overflow"); return; }
        creations.add(id);
        if (!seen && mayCreate && !rows.some(row => row.id === id)) candidates.add(id);
      } else { candidates.delete(id); admitted.delete(id); }
    } else {
      // An unscoped bulk invalidation can include X. Its old payload/authority
      // cannot remain usable while that unknown set is being reconciled.
      candidates.clear(); admitted.clear();
    }
    if (targets.size + rows.filter(row => !targets.has(row.id)).length > 100) { stop("overflow"); return; }
    schedule(g);
  }
  function finishOpen(g: number) {
    if (!current(g) || !openResult) return;
    const at = buffer.findIndex(event => event.event_id === openResult?.barrier_event_id);
    if (at < 0) return;
    const ownMarker = buffer[at];
    if (ownMarker.event_kind !== "invalidate" || ownMarker.notification_id !== null) { stop("protocol"); return; }
    const result = openResult, events = buffer;
    buffer = []; openResult = undefined; phase = "live";
    // A buffered scrub/read/remove can be newer than the open snapshot. Never
    // publish that stale payload even briefly; reconcile through one fresh read.
    if (events.length === 1) apply(result.page, result.lookup, g);
    else for (let i = 0; i < events.length && current(g); i++) {
      if (i !== at) ingest(events[i], i > at, g);
    }
  }
  function receive(value: unknown, g: number) {
    if (!current(g)) return;
    try {
      const event = parseNotificationFeedEventV2(value, owner.userId);
      if (phase === "live") ingest(event, true, g);
      else {
        if (buffer.length >= 512) { stop("overflow"); return; }
        buffer.push(event); finishOpen(g);
      }
    } catch { if (current(g)) stop("protocol"); }
  }
  async function open(g: number) {
    const held = rows.map(row => row.id);
    try {
      const raw = await ports.open({ p_limit: 30, p_held_ids: held });
      if (!current(g)) return;
      openResult = parseNotificationFeedOpenV2(raw, owner.userId, held);
      finishOpen(g);
    } catch (error) {
      if (current(g)) stop(error instanceof FeedProtocolError ? "protocol" : "read_error");
    }
  }
  function restart() {
    if (disposed || !ports.isCurrent(owner)) return;
    stop(); phase = "waiting";
    const g = generation;
    const close = ports.subscribe(event => receive(event, g), status => {
      if (!current(g)) return;
      if (status === "SUBSCRIBED") {
        if (phase !== "waiting") return;
        phase = "opening"; void open(g);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") stop("gap");
    });
    if (current(g)) unsubscribe = close; else close();
  }
  restart();
  return {
    restart,
    rows: (): readonly NotificationFeedRowV2[] => !disposed && ports.isCurrent(owner) ? Object.freeze([...rows]) : [],
    refresh() { const g = generation; if (current(g) && phase === "live") { dirty++; schedule(g); } },
    confirm(values: readonly NotificationFeedRowV2[]) {
      const g = generation;
      if (!current(g)) return;
      try {
        const confirmed = uniqueRows([...values], owner.userId, 100);
        dirty++;
        const nextRows = rows.map(row => {
          const next = confirmed.find(item => item.id === row.id);
          return next ? forward(row, next, snapshots) : row;
        });
        for (const row of confirmed) {
          candidates.delete(row.id);
          const admission = admitted.get(row.id);
          if (admission && !sameRow(admission, forward(admission, row, snapshots))) admitted.delete(row.id);
        }
        rows = nextRows;
        ports.onRows(Object.freeze([...rows]));
        if (phase === "live") schedule(g);
      } catch {
        if (current(g)) stop("protocol");
      }
    },
    timeout() { if (current(generation)) stop("timeout"); },
    dispose() { disposed = true; stop(); rows = []; },
  };
}
