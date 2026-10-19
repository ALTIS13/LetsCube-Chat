export type VisibleMessageAnchor = Readonly<{
  messageId: string;
  viewportOffset: number;
}>;

const MESSAGE_SELECTOR = "[data-message-id]";

/** Layout may clamp a correction; any other movement belongs to the reader. */
export function matchesAnchoredScrollTop(container: HTMLElement, ownedTop: number): boolean {
  const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
  const expected = Math.min(maximum, Math.max(0, ownedTop));
  return Math.abs(container.scrollTop - expected) <= 1;
}

/** Keep in-flight reader motion when the first prepend commits before its scroll event. */
export function adjustVisibleMessageAnchorForPendingScroll(
  container: HTMLElement,
  anchor: VisibleMessageAnchor,
  observedTop: number,
): VisibleMessageAnchor {
  const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
  const expected = Math.min(maximum, Math.max(0, observedTop));
  const pendingDelta = container.scrollTop - expected;
  return pendingDelta === 0 ? anchor : { ...anchor, viewportOffset: anchor.viewportOffset - pendingDelta };
}

export function captureVisibleMessageAnchor(container: HTMLElement): VisibleMessageAnchor | null {
  const containerRect = container.getBoundingClientRect();
  const message = Array.from(container.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR))
    .find((candidate) => candidate.getBoundingClientRect().bottom > containerRect.top + 1);
  const messageId = message?.dataset.messageId;
  if (!message || !messageId) return null;

  return {
    messageId,
    viewportOffset: message.getBoundingClientRect().top - containerRect.top,
  };
}

export function restoreVisibleMessageAnchor(
  container: HTMLElement,
  anchor: VisibleMessageAnchor,
): boolean {
  const message = Array.from(container.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR))
    .find((candidate) => candidate.dataset.messageId === anchor.messageId);
  if (!message) return false;

  const currentOffset = message.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const maximumScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTop = Math.min(
    maximumScrollTop,
    Math.max(0, container.scrollTop + currentOffset - anchor.viewportOffset),
  );
  return true;
}
