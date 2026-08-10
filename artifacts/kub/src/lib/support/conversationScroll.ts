export const SUPPORT_BOTTOM_THRESHOLD_PX = 96;

export interface SupportScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export type SupportScrollAction = "bottom" | "preserve";

export function isSupportScrollNearBottom(
  metrics: SupportScrollMetrics,
  threshold = SUPPORT_BOTTOM_THRESHOLD_PX,
): boolean {
  const remaining = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return remaining <= threshold;
}

export function getSupportScrollAction(input: {
  conversationChanged: boolean;
  messageCountIncreased: boolean;
  wasNearBottom: boolean;
  lastMessageOwned: boolean;
}): SupportScrollAction {
  if (input.conversationChanged) return "bottom";
  if (input.messageCountIncreased && (input.wasNearBottom || input.lastMessageOwned)) return "bottom";
  return "preserve";
}
