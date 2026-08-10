import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  getSupportScrollAction,
  isSupportScrollNearBottom,
} from "./conversationScroll";

interface UseConversationScrollInput {
  conversationKey: string;
  messageCount: number;
  lastMessageId: string | null;
  lastMessageOwned: boolean;
}

interface PreviousConversationState {
  conversationKey: string;
  messageCount: number;
  lastMessageId: string | null;
}

export function useConversationScroll({
  conversationKey,
  messageCount,
  lastMessageId,
  lastMessageOwned,
}: UseConversationScrollInput) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const previousRef = useRef<PreviousConversationState | null>(null);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = scrollRef.current;
    if (!node) return;
    if (behavior === "auto") node.scrollTop = node.scrollHeight;
    else node.scrollTo({ top: node.scrollHeight, behavior });
    nearBottomRef.current = true;
    setHasNewMessages(false);
  }, []);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = isSupportScrollNearBottom(node);
    nearBottomRef.current = nearBottom;
    if (nearBottom) setHasNewMessages(false);
  }, []);

  useLayoutEffect(() => {
    const previous = previousRef.current;
    const conversationChanged = !previous || previous.conversationKey !== conversationKey;
    const messageCountIncreased = Boolean(
      previous &&
        previous.conversationKey === conversationKey &&
        (messageCount > previous.messageCount || lastMessageId !== previous.lastMessageId),
    );
    const action = getSupportScrollAction({
      conversationChanged,
      messageCountIncreased,
      wasNearBottom: nearBottomRef.current,
      lastMessageOwned,
    });

    previousRef.current = { conversationKey, messageCount, lastMessageId };

    if (action === "bottom") {
      scrollToLatest("auto");
      const frame = window.requestAnimationFrame(() => scrollToLatest("auto"));
      return () => window.cancelAnimationFrame(frame);
    } else if (messageCountIncreased) {
      setHasNewMessages(true);
    }
    return undefined;
  }, [conversationKey, lastMessageId, lastMessageOwned, messageCount, scrollToLatest]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (nearBottomRef.current) scrollToLatest("auto");
    });
    observer.observe(scroll);
    observer.observe(content);
    return () => observer.disconnect();
  }, [conversationKey, scrollToLatest]);

  return {
    scrollRef,
    contentRef,
    hasNewMessages,
    handleScroll,
    scrollToLatest,
  };
}
