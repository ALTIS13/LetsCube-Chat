import type { PushNotificationsPlugin } from "@capacitor/push-notifications";

type DeliveredPushClient = Pick<PushNotificationsPlugin, "getDeliveredNotifications" | "removeDeliveredNotifications">;

export async function closeDeliveredChatNotification(push: DeliveredPushClient, tag: string): Promise<void> {
  if (!/^message:chat:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(tag)) return;
  const { notifications } = await push.getDeliveredNotifications();
  const matching = notifications.filter((notification) => notification.tag === tag && !notification.groupSummary);
  if (matching.length) await push.removeDeliveredNotifications({ notifications: matching });
}
