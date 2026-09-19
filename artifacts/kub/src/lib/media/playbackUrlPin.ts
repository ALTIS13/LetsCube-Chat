/**
 * Which address a `<video>` or an `<audio>` should be carrying right now.
 *
 * D-208. Setting `src` on a media element reloads it: playback stops, the
 * position goes back to zero and the buffer is thrown away. That has never
 * mattered in this product because a public URL is a constant — the only time
 * the string changed was when the 720p re-encode arrived beside the original,
 * or when a failure handed playback back to the original, and both of those are
 * a deliberate change of *what is playing*.
 *
 * A signature is not a constant. It is replaced at 80% of its life
 * (`signedUrlLifetime`), and two signings of one path are different strings, so
 * without a rule the renewal would restart whatever was playing at the moment
 * it happened.
 *
 * ## The rule
 *
 * Hold the address the element already has **only** when the new one is the
 * same object re-signed. Everything else reaches the element unchanged:
 *
 * - a different object — the 720p variant, the fallback to the original;
 * - anything in `"public"` mode, where no address is ever a signature, so
 *   `signedObjectIdentity` is `null` on both sides and the incoming address is
 *   always taken. That is what makes the default mode byte-identical: this
 *   module cannot hold anything back there, whatever the element is doing.
 *
 * ## The hazard the hold creates, and its other half
 *
 * Holding a signature means holding one that will eventually die. An element
 * that is paused part-way through at the moment of renewal keeps the old token;
 * past its `exp` the *next* request fails — which, for a `<video>`, is the
 * `Range:` request a seek issues, and the answer is a 400 indistinguishable
 * from a tampered token or a missing file.
 *
 * So the hold is only correct paired with `shouldRetryWithFreshAddress`: on an
 * error, an element whose address is a signature drops the pin, takes the one
 * the resolver is offering — which is fresh, because the renewal that the pin
 * refused has already happened — and resumes from where it was. Nothing about
 * that path exists in `"public"` mode either, because the first thing it asks
 * is whether the failed address was signed.
 */

import { SIGNED_OBJECT_SEGMENT } from "./mediaObjectRef.ts";

/**
 * Which object a signed URL names, ignoring the token, or `null` if it is not
 * a signed URL at all.
 *
 * The token lives in the query string, so the pathname alone identifies the
 * object across re-signings. Parsed rather than cut, for the same reason
 * `parsePublicObjectUrl` is.
 */
export function signedObjectIdentity(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  let pathname: string;
  try {
    pathname = new URL(url, "http://media.invalid").pathname;
  } catch {
    return null;
  }
  const at = pathname.indexOf(SIGNED_OBJECT_SEGMENT);
  if (at < 0) return null;
  const rest = pathname.slice(at + SIGNED_OBJECT_SEGMENT.length);
  return rest.length > 0 ? rest : null;
}

/** Whether two addresses are the same object signed twice. */
export function isResignatureOf(
  current: string | null | undefined,
  next: string | null | undefined,
): boolean {
  if (!current || !next || current === next) return false;
  const identity = signedObjectIdentity(current);
  return identity !== null && identity === signedObjectIdentity(next);
}

export interface PlaybackUrlChoice {
  /** What the element is loaded with, or `null` before it has anything. */
  pinned: string | null;
  /** What the resolver is offering now. */
  incoming: string | null;
  /**
   * Whether a swap would lose something — the element is playing, or is paused
   * part-way through. An idle element takes the fresh address at once, so it is
   * never the one holding a token about to expire.
   */
  engaged: boolean;
}

/** The address the element should carry. */
export function choosePlaybackUrl({ pinned, incoming, engaged }: PlaybackUrlChoice): string | null {
  if (!engaged) return incoming;
  if (!isResignatureOf(pinned, incoming)) return incoming;
  return pinned;
}

/**
 * Whether an element that just failed should try the address on offer.
 *
 * Only when what failed was a signature and the offer is a different one. A
 * public URL that 400s is a different problem — a deleted object, a policy —
 * and swapping to the same string would spin.
 */
export function shouldRetryWithFreshAddress(
  failedUrl: string | null | undefined,
  incoming: string | null | undefined,
): boolean {
  return isResignatureOf(failedUrl, incoming);
}
