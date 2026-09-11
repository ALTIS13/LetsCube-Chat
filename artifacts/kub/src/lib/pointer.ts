/**
 * Whether the primary pointer is a finger.
 *
 * A phone sets its volume with its own keys and mixer, and Telegram draws no
 * volume slider there; a desktop keeps one (D-118). Everything that hides a
 * volume control under a finger also plays at full volume there, so a volume
 * lowered earlier cannot stay lowered with nothing on screen to raise it.
 */
export function coarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}
