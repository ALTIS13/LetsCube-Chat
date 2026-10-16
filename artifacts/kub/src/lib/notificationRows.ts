type NotificationRow = {
  id: string;
  created_at: string;
  read_at: string | null;
  alert_suppressed_at?: string | null;
};

export function mergeNotificationRows<T extends NotificationRow>(
  current: T[],
  incoming: T[],
  limit: number,
): T[] {
  const byId = new Map<string, T>();
  for (const row of current) byId.set(row.id, row);
  for (const row of incoming) {
    const existing = byId.get(row.id);
    if (!existing || existing.created_at <= row.created_at) {
      // A refresh can predate an optimistic mark-read write; reads only move forward.
      const merged = existing?.read_at && !row.read_at
        ? { ...row, read_at: existing.read_at }
        : row;
      byId.set(row.id, existing?.alert_suppressed_at
        ? { ...merged, alert_suppressed_at: existing.alert_suppressed_at }
        : merged);
    }
  }
  return Array.from(byId.values())
    .sort((left, right) => (left.created_at < right.created_at ? 1 : left.created_at > right.created_at ? -1 : 0))
    .slice(0, limit);
}

export function rollbackFailedNotificationReads<T extends NotificationRow>(
  rows: T[],
  previousReadAt: ReadonlyMap<string, string | null>,
  failedIds: ReadonlySet<string>,
): T[] {
  return rows.map((row) => failedIds.has(row.id) && previousReadAt.has(row.id)
    ? { ...row, read_at: previousReadAt.get(row.id) ?? null }
    : row);
}
