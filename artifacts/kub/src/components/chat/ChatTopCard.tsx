"use client";

import { useMemo } from "react";
import { KubGlassLayer } from "@/components/kub";
import type { MessageWithSender } from "@/types/database";
import { PlaybackRow, useChatMediaPlayback } from "./ChatMediaPlayback";
import { PinnedMessage } from "./PinnedMessage";

interface ChatTopCardProps {
  pinnedMessages: MessageWithSender[];
  pinnedReady: boolean;
  onJumpToPinned: (message: MessageWithSender) => void;
  onUnpin?: (message: MessageWithSender) => void;
}

/**
 * The top of a conversation (tracker item 70): one card under the header, with
 * the pinned message and the player each a row of it and a hairline between —
 * the owner's Telegram screenshot of 2026-09-28. Before it the player was a
 * card of its own inside the header, a third of a phone's screen tall, and the
 * pinned message a second capsule under that.
 *
 * Out of the header, the player also stays while messages are selected: the
 * selection bar stands in for the header, and took the player with it.
 *
 * The card follows the player, so it renders again with every tick of it; the
 * pinned row is memoised and does not.
 */
export function ChatTopCard({ pinnedMessages, pinnedReady, onJumpToPinned, onUnpin }: ChatTopCardProps) {
  const playback = useChatMediaPlayback();
  const pins = useMemo(
    () => pinnedMessages.filter((message) => message.pinned && !message.deleted_at),
    [pinnedMessages],
  );
  const showPinned = pinnedReady && pins.length > 0;
  const showPlayer = playback.currentItem !== null;
  if (!showPinned && !showPlayer) return null;

  return (
    <div data-testid="chat-top-card" className="relative mx-2 mt-1 flex-shrink-0 md:mx-4">
      {/* A capsule against a backdrop nobody chose, so it keeps its rim
          (rule 11); a layer, because the pinned list and the speed list open
          from inside it (rule 3). */}
      <KubGlassLayer className="rounded-[1.375rem] border border-[color:var(--glass-line)]" />
      <div className="relative flex min-w-0 flex-col">
        {showPinned && (
          <PinnedMessage
            messages={pins}
            onJump={onJumpToPinned}
            onUnpin={onUnpin}
            rounding={showPlayer ? "top" : "all"}
          />
        )}
        {showPinned && showPlayer && (
          // A rule between two rows of one sheet, not the edge of one.
          <span aria-hidden="true" className="h-px bg-[var(--kub-rule)]" />
        )}
        {showPlayer && <PlaybackRow placement="chat" rounding={showPinned ? "bottom" : "all"} />}
      </div>
    </div>
  );
}
