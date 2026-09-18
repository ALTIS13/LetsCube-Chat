"use client";

import type { ReactNode } from "react";
import { useVoiceSpeaking } from "@/hooks/useVoiceCall";
import { cn } from "@/lib/utils";

/**
 * A voice participant's face, ringed while they are talking.
 *
 * Discord rings the avatar of whoever is speaking, in the member list and in
 * the call itself, and it is the affordance the owner asked for on 2026-09-18.
 * The three surfaces that draw a voice participant — the channel rail's
 * occupant rows, the capsule's stack of faces under the chat header, and the
 * information panel's participant list — all wear it through this one wrapper,
 * so there is one ring rather than three that drift.
 *
 * **Why this is its own component, which is the whole of its cost story.**
 * `speakers` is replaced by the SDK several times a second. A row that read the
 * call state would render on every syllable, and the rail has a row per person
 * per room. This subscribes to a **boolean per person** instead — see
 * `useVoiceSpeaking` — so React renders this leaf and nothing above it, and
 * only when this person started or stopped talking. `children` is an element
 * the parent already created, so re-rendering the wrapper does not re-render
 * the avatar inside it either.
 *
 * The ring itself is `.kub-voice-speaking` in `index.css`, an outline rather
 * than a shadow or a Tailwind `ring-*` (rule 1 of
 * docs/operations/interface-material.md), and static rather than pulsing. The
 * stylesheet says why in full.
 *
 * **Nothing is announced.** A live region that said «Анна говорит» several
 * times a second would make the screen reader useless for the conversation
 * itself; who is talking is available continuously through the audio, which is
 * the medium the fact belongs to. The ring is decoration over information that
 * is already being delivered, so it is `aria-hidden` by omission — it adds no
 * role, no label and no live text.
 */
export function VoiceSpeakingAvatar({
  userId,
  /**
   * The room this face is being drawn in. The ring appears only when it is the
   * room the call is actually in — a stale table read must not ring somebody in
   * the room they have just left.
   */
  channelId,
  className,
  children,
}: {
  userId: string;
  channelId: string | null;
  className?: string;
  children: ReactNode;
}) {
  const speaking = useVoiceSpeaking(userId, channelId);
  return (
    <span
      className={cn("kub-voice-speaking relative flex shrink-0 rounded-full", className)}
      data-testid="voice-speaking"
      data-user-id={userId}
      data-speaking={speaking ? "true" : "false"}
    >
      {children}
    </span>
  );
}
