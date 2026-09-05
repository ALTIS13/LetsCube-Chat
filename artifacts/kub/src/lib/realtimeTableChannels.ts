/**
 * One Realtime channel per table, because a channel is only as live as its
 * least live binding.
 *
 * Measured on production on 2026-09-05. A channel carrying
 *
 *   messages INSERT, messages UPDATE, chats UPDATE, chats DELETE
 *
 * received **nothing** — not the `chats` events it could never receive, but
 * also not the `messages` events it certainly should have. It reported
 * `SUBSCRIBED`, reached state `joined`, and was assigned a server-side id for
 * every one of its four bindings, so nothing in the client's own state said
 * anything was wrong.
 *
 * The reason is that `public.chats` is not in the `supabase_realtime`
 * publication (it is the only table this application subscribes to from the
 * chat surface that is not), and a channel that asks for an unpublished table
 * silently stops delivering *all* of its bindings. The isolation was proven by
 * construction against the live server: an identical channel minus the `chats`
 * bindings delivered, `messages INSERT + chats UPDATE` did not, and
 * `chats UPDATE + messages INSERT` did not either — so it is not an ordering
 * effect, it is contamination.
 *
 * What that cost: `chats:user:{id}` is the sidebar's entire live path, so a
 * device with the chat closed learned about a new message only when something
 * else happened to refetch — a tab focus, a reconnect, a reload. The unread
 * badge and the last-message preview simply did not move. It is also why the
 * defect reads as a two-device problem: with one device you eventually focus
 * the tab, and the sidebar catches up before you notice.
 *
 * The rule here is deliberately stated as "one channel per table" rather than
 * "isolate the tables that are not published". An allowlist of published tables
 * would be a second copy of a fact that lives in the database, and it fails
 * dangerously: the day a table is dropped from the publication the stale list
 * still calls it safe and the contamination comes back silently. Grouping by
 * table needs no such list and cannot go stale — a binding can only ever take
 * down bindings on its own table, whatever the publication says today.
 */

export type PostgresChangeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

export type PostgresChangeBinding<Handler> = {
  event: PostgresChangeEvent;
  schema: string;
  table: string;
  filter?: string;
  handler: Handler;
};

export type TableBindingGroup<Handler> = {
  table: string;
  bindings: PostgresChangeBinding<Handler>[];
};

/**
 * Groups bindings by table, preserving first-seen table order and the original
 * order within each table.
 *
 * Order is preserved rather than sorted so a channel's suffix stays stable
 * across renders: a channel name that reshuffles is a resubscribe, and a
 * resubscribe drops events in the gap.
 */
export function groupBindingsByTable<Handler>(
  bindings: PostgresChangeBinding<Handler>[],
): TableBindingGroup<Handler>[] {
  const groups: TableBindingGroup<Handler>[] = [];
  const byTable = new Map<string, TableBindingGroup<Handler>>();

  for (const binding of bindings) {
    const existing = byTable.get(binding.table);
    if (existing) {
      existing.bindings.push(binding);
      continue;
    }
    const group: TableBindingGroup<Handler> = { table: binding.table, bindings: [binding] };
    byTable.set(binding.table, group);
    groups.push(group);
  }

  return groups;
}

/** The per-table channel name derived from a base name. */
export function tableChannelName(baseName: string, table: string): string {
  return `${baseName}:${table}`;
}

type MinimalChannel<Handler> = {
  on: (
    type: "postgres_changes",
    filter: { event: PostgresChangeEvent; schema: string; table: string; filter?: string },
    handler: Handler,
  ) => MinimalChannel<Handler>;
  subscribe: (callback?: (status: string) => void) => unknown;
};

type MinimalRealtimeClient<Handler> = {
  channel: (name: string) => MinimalChannel<Handler>;
};

/**
 * Subscribes one channel per table and returns them for teardown.
 *
 * `onStatus` receives the per-table channel name so a status log names the
 * channel that actually reported it.
 */
export function subscribeByTable<Handler, Channel>(
  client: MinimalRealtimeClient<Handler>,
  baseName: string,
  bindings: PostgresChangeBinding<Handler>[],
  onStatus?: (channelName: string, status: string) => void,
): { name: string; channel: Channel }[] {
  return groupBindingsByTable(bindings).map((group) => {
    const name = tableChannelName(baseName, group.table);
    let channel = client.channel(name);
    for (const binding of group.bindings) {
      const filter: { event: PostgresChangeEvent; schema: string; table: string; filter?: string } = {
        event: binding.event,
        schema: binding.schema,
        table: binding.table,
      };
      if (binding.filter !== undefined) filter.filter = binding.filter;
      channel = channel.on("postgres_changes", filter, binding.handler);
    }
    channel.subscribe((status: string) => onStatus?.(name, status));
    return { name, channel: channel as unknown as Channel };
  });
}
