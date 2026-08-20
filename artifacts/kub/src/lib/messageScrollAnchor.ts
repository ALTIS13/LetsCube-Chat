export type VisibleMessageAnchor = Readonly<{
  messageId: string;
  viewportOffset: number;
}>;

const MESSAGE_SELECTOR = "[data-message-id]";

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
