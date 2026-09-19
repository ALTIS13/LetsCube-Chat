/**
 * The originals, on screen, kept current.
 *
 * D-208. `lib/media/mediaUrl.ts` answers "what is the address of this object
 * right now", and in `"public"` mode that answer never changes. Under a
 * signature it changes twice: once when the first POST lands, and again every
 * time the store replaces a signature at 80% of its life. React has to hear
 * about both, and each shape has to hear only about its own object — a chat
 * with forty pictures in it must not re-render forty bubbles because the
 * forty-first was signed.
 *
 * That is what `useSyncExternalStore` gives for free here: the snapshot is the
 * *address*, not a revision counter, so a notification about somebody else's
 * object produces the same string and React bails out. The same trick the
 * avatar-variant hooks already use, one level down.
 *
 * Reading is also what queues the signing — `signedMediaUrlStore.get` enqueues
 * on read — so these hooks are called during render rather than in an effect,
 * deliberately, exactly as `useVariantFromStore` is: an effect runs after the
 * first paint, by which point an element with no `src` has already drawn a
 * hole.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  avatarMediaUrl,
  isAvatarMediaUrlSettled,
  isMessageMediaUrlSettled,
  messageMediaUrl,
  signedMediaUrls,
} from "@/lib/media/mediaUrl";
import type { MediaObjectRefMessage } from "@/lib/media/mediaObjectRef";
import { choosePlaybackUrl, shouldRetryWithFreshAddress } from "@/lib/media/playbackUrlPin";

function subscribeToSignatures(listener: () => void): () => void {
  return signedMediaUrls().subscribe(listener);
}

/** The columns a message's address is derived from, and nothing else. */
function useMessageMediaRow(
  message: MediaObjectRefMessage | null | undefined,
): MediaObjectRefMessage {
  const bucket = message?.media_bucket ?? null;
  const path = message?.media_path ?? null;
  const url = message?.media_url ?? null;
  return useMemo(
    () => ({ media_bucket: bucket, media_path: path, media_url: url }),
    [bucket, path, url],
  );
}

/**
 * The address of a message's own photograph, video, voice message or file.
 *
 * `null` means "do not put this in a `src` yet", and only ever happens under a
 * signature: in `"public"` mode this is `message.media_url`, unchanged.
 */
export function useMessageMediaUrl(
  message: MediaObjectRefMessage | null | undefined,
): string | null {
  const row = useMessageMediaRow(message);
  const subscribe = useCallback(subscribeToSignatures, []);
  return useSyncExternalStore(
    subscribe,
    () => messageMediaUrl(row),
    () => messageMediaUrl(row),
  );
}

/**
 * The same address, with whether the answer is final.
 *
 * For the one shape that has nothing to fall back to. `settled` separates "no
 * address yet" from "there is no address" — without it a voice message that
 * cannot be resolved says «загрузка...» for the rest of the session.
 */
export function useMessageMediaSource(
  message: MediaObjectRefMessage | null | undefined,
): { url: string | null; settled: boolean } {
  const row = useMessageMediaRow(message);
  const subscribe = useCallback(subscribeToSignatures, []);
  const url = useSyncExternalStore(
    subscribe,
    () => messageMediaUrl(row),
    () => messageMediaUrl(row),
  );
  const settled = useSyncExternalStore(
    subscribe,
    () => isMessageMediaUrlSettled(row),
    () => true,
  );
  return { url, settled };
}

/** The address of a stored picture: a profile's, a chat's, a bot's. */
export function useAvatarMediaUrl(url: string | null | undefined): string | null {
  const subscribe = useCallback(subscribeToSignatures, []);
  return useSyncExternalStore(
    subscribe,
    () => avatarMediaUrl(url),
    () => avatarMediaUrl(url),
  );
}

/** The same, with whether the answer is final. */
export function useAvatarMediaSource(
  url: string | null | undefined,
): { url: string | null; settled: boolean } {
  const subscribe = useCallback(subscribeToSignatures, []);
  const resolved = useSyncExternalStore(
    subscribe,
    () => avatarMediaUrl(url),
    () => avatarMediaUrl(url),
  );
  const settled = useSyncExternalStore(
    subscribe,
    () => isAvatarMediaUrlSettled(url),
    () => true,
  );
  return { url: resolved, settled };
}

export interface PlaybackUrl {
  /** What to put in the element's `src`. */
  url: string | null;
  /**
   * Call from `onError`. Returns true when it has taken a fresh signature and
   * the caller should do nothing else; false when the failure is the ordinary
   * kind the caller already handles.
   */
  recoverFromError: () => boolean;
}

/**
 * An address for a media element that is allowed to be playing.
 *
 * Swapping a `<video>`'s `src` restarts it, and a signature is replaced
 * mid-session, so the two cannot simply be wired together. The rule is in
 * `lib/media/playbackUrlPin.ts`; this hook is the part that has to touch the
 * element — whether it is engaged, and where it had got to when a held-back
 * signature finally expired under it.
 *
 * In `"public"` mode `incoming` never changes and nothing below can alter what
 * the element is given: `choosePlaybackUrl` returns `incoming` whenever the two
 * addresses are not the same object re-signed, and in `"public"` neither is a
 * signature at all.
 */
export function usePlaybackUrl(
  incoming: string | null,
  // Structural rather than `RefObject<…>`, so a `<video>` ref and an `<audio>`
  // ref both fit whichever way this React version spells the nullability.
  mediaRef: { readonly current: HTMLMediaElement | null },
): PlaybackUrl {
  const [pinned, setPinned] = useState<string | null>(incoming);
  // Where an expired address was interrupted, so the fresh one can resume there
  // instead of starting the video again from the beginning.
  const resumeAtRef = useRef<number | null>(null);

  useEffect(() => {
    const element = mediaRef.current;
    const engaged = Boolean(element) && (!element!.paused || element!.currentTime > 0);
    setPinned((current) => choosePlaybackUrl({ pinned: current, incoming, engaged }));
  }, [incoming, mediaRef]);

  // Taking a fresh address means reloading the element, so the position has to
  // be put back by hand once the new one knows how long it is.
  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    const restore = () => {
      const at = resumeAtRef.current;
      resumeAtRef.current = null;
      if (at === null || at <= 0) return;
      try {
        element.currentTime = at;
      } catch {
        // A browser that refuses the seek leaves it at the start, which is the
        // old behaviour rather than a new failure.
      }
    };
    element.addEventListener("loadedmetadata", restore);
    return () => element.removeEventListener("loadedmetadata", restore);
  }, [mediaRef, pinned]);

  const recoverFromError = useCallback((): boolean => {
    if (!shouldRetryWithFreshAddress(pinned, incoming)) return false;
    const element = mediaRef.current;
    resumeAtRef.current = element && Number.isFinite(element.currentTime) ? element.currentTime : null;
    setPinned(incoming);
    return true;
  }, [incoming, mediaRef, pinned]);

  return { url: pinned, recoverFromError };
}
