type MessageAlertDecisionClient = {
  rpc(name: "message_notification_alert_decisions", args: { p_notification_ids: string[] }):
    PromiseLike<{ data: unknown; error: unknown }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One attempt's authority, never a reusable cache or a feed/read-state filter. */
export async function currentMessageAlertAllowed(
  notificationId: string,
  isCurrent: () => boolean,
  client: MessageAlertDecisionClient,
): Promise<boolean> {
  try {
    if (typeof notificationId !== "string" || !UUID.test(notificationId) || !isCurrent()) return false;
    const result = await client.rpc("message_notification_alert_decisions", { p_notification_ids: [notificationId] });
    if (!isCurrent()) return false;
    if (!result || result.error !== null || !Array.isArray(result.data) || result.data.length !== 1) return false;
    const row = result.data[0] as Record<string, unknown> | null;
    if (!row || row.notification_id !== notificationId || row.allowed !== true) return false;
    if (typeof row.scope_key !== "string" || (row.scope_key !== "general" && !UUID.test(row.scope_key))) return false;
    return typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 0;
  } catch {
    return false;
  }
}
