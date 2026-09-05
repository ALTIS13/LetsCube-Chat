import assert from "node:assert/strict";
import test from "node:test";

import {
  groupBindingsByTable,
  subscribeByTable,
  tableChannelName,
  type PostgresChangeBinding,
} from "../../artifacts/kub/src/lib/realtimeTableChannels.ts";

type Handler = (payload: unknown) => void;

type RecordedChannel = {
  name: string;
  bindings: { event: string; schema: string; table: string; filter?: string }[];
  subscribeCalls: number;
  statuses: string[];
};

/**
 * A fake Realtime client that records what was asked of it.
 *
 * The point of the real bug was that the server said yes to everything, so a
 * fake that only checks "did subscribe get called" would have been green
 * through the entire outage. What has to be asserted is the *shape* of the
 * subscription — which bindings ended up sharing a channel.
 */
function fakeClient() {
  const channels: RecordedChannel[] = [];

  const client = {
    channel(name: string) {
      const record: RecordedChannel = { name, bindings: [], subscribeCalls: 0, statuses: [] };
      channels.push(record);
      const api = {
        on(
          _type: "postgres_changes",
          filter: { event: string; schema: string; table: string; filter?: string },
          _handler: Handler,
        ) {
          record.bindings.push(filter);
          return api;
        },
        subscribe(callback?: (status: string) => void) {
          record.subscribeCalls += 1;
          callback?.("SUBSCRIBED");
          return api;
        },
      };
      return api;
    },
  };

  return { client, channels };
}

const noop: Handler = () => {};

/** The exact set `useChats` subscribes for the sidebar. */
function sidebarBindings(): PostgresChangeBinding<Handler>[] {
  return [
    { event: "INSERT", schema: "public", table: "messages", handler: noop },
    { event: "UPDATE", schema: "public", table: "messages", handler: noop },
    { event: "UPDATE", schema: "public", table: "chats", handler: noop },
    { event: "DELETE", schema: "public", table: "chats", handler: noop },
  ];
}

test("groups bindings by table, keeping first-seen table order", () => {
  const groups = groupBindingsByTable(sidebarBindings());
  assert.deepEqual(
    groups.map((group) => group.table),
    ["messages", "chats"],
  );
  assert.deepEqual(
    groups.map((group) => group.bindings.map((binding) => binding.event)),
    [
      ["INSERT", "UPDATE"],
      ["UPDATE", "DELETE"],
    ],
  );
});

test("keeps table order stable when bindings interleave", () => {
  // A reshuffled channel name is a resubscribe, and a resubscribe drops
  // whatever arrives in the gap, so ordering is part of the contract.
  const groups = groupBindingsByTable<Handler>([
    { event: "INSERT", schema: "public", table: "messages", handler: noop },
    { event: "UPDATE", schema: "public", table: "chats", handler: noop },
    { event: "UPDATE", schema: "public", table: "messages", handler: noop },
  ]);
  assert.deepEqual(groups.map((group) => group.table), ["messages", "chats"]);
  assert.deepEqual(groups[0].bindings.map((b) => b.event), ["INSERT", "UPDATE"]);
  assert.deepEqual(groups[1].bindings.map((b) => b.event), ["UPDATE"]);
});

test("names a channel after its base and its table", () => {
  assert.equal(tableChannelName("chats:user:u1", "messages"), "chats:user:u1:messages");
});

/**
 * The regression this file exists for.
 *
 * `public.chats` is not in the `supabase_realtime` publication, and a channel
 * that carries a binding for an unpublished table delivers nothing at all —
 * including the bindings for tables that *are* published. Putting the sidebar's
 * two `messages` bindings on the same channel as its two `chats` bindings
 * therefore silenced the sidebar completely while still reporting SUBSCRIBED.
 */
test("never puts two tables on one channel", () => {
  const { client, channels } = fakeClient();
  subscribeByTable(client, "chats:user:u1", sidebarBindings());

  assert.equal(channels.length, 2, "the four sidebar bindings must span two channels");
  for (const channel of channels) {
    const tables = new Set(channel.bindings.map((binding) => binding.table));
    assert.equal(
      tables.size,
      1,
      `channel ${channel.name} mixes tables: ${[...tables].join(", ")}`,
    );
  }

  const messages = channels.find((c) => c.name === "chats:user:u1:messages");
  const chats = channels.find((c) => c.name === "chats:user:u1:chats");
  assert.ok(messages, "the messages bindings need their own channel");
  assert.ok(chats, "the chats bindings need their own channel");
  assert.deepEqual(messages.bindings.map((b) => b.event), ["INSERT", "UPDATE"]);
  assert.deepEqual(chats.bindings.map((b) => b.event), ["UPDATE", "DELETE"]);
  assert.equal(messages.bindings.every((b) => b.table === "messages"), true);
  assert.equal(chats.bindings.every((b) => b.table === "chats"), true);
});

test("subscribes each channel exactly once and reports status per channel", () => {
  const { client, channels } = fakeClient();
  const seen: { name: string; status: string }[] = [];
  const result = subscribeByTable(client, "base", sidebarBindings(), (name, status) =>
    seen.push({ name, status }),
  );

  assert.deepEqual(channels.map((c) => c.subscribeCalls), [1, 1]);
  assert.deepEqual(seen, [
    { name: "base:messages", status: "SUBSCRIBED" },
    { name: "base:chats", status: "SUBSCRIBED" },
  ]);
  // The caller needs every channel back, or teardown leaks the ones it missed.
  assert.deepEqual(result.map((entry) => entry.name), ["base:messages", "base:chats"]);
});

test("passes a row filter through and omits it when there is none", () => {
  const { client, channels } = fakeClient();
  subscribeByTable<Handler, unknown>(client, "base", [
    { event: "UPDATE", schema: "public", table: "chat_members", filter: "user_id=eq.u1", handler: noop },
    { event: "INSERT", schema: "public", table: "messages", handler: noop },
  ]);

  const members = channels.find((c) => c.name === "base:chat_members");
  const messages = channels.find((c) => c.name === "base:messages");
  assert.equal(members?.bindings[0].filter, "user_id=eq.u1");
  assert.equal("filter" in (messages?.bindings[0] ?? {}), false);
});

test("a single-table binding set still yields one channel", () => {
  const { client, channels } = fakeClient();
  subscribeByTable<Handler, unknown>(client, "base", [
    { event: "INSERT", schema: "public", table: "messages", handler: noop },
    { event: "UPDATE", schema: "public", table: "messages", handler: noop },
    { event: "DELETE", schema: "public", table: "messages", handler: noop },
  ]);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, "base:messages");
  assert.equal(channels[0].bindings.length, 3);
});

test("an empty binding set opens no channel at all", () => {
  const { client, channels } = fakeClient();
  const result = subscribeByTable<Handler, unknown>(client, "base", []);
  assert.equal(channels.length, 0);
  assert.deepEqual(result, []);
});
