/**
 * The one place in the client that turns a stored object into an address.
 *
 * D-208, step one. Before this there were seven `getPublicUrl` calls spread
 * across four components, a hook and two library modules, and each of them
 * decided independently that a public URL was the right shape. A defect whose
 * fix is "stop doing X" cannot be finished while X is written in seven places,
 * and cannot be *verified* finished at all — so the seven become one, and the
 * shape becomes a decision (`mediaUrlMode`) rather than a habit.
 *
 * Nothing here changes what is on screen. In the default `"public"` mode every
 * function below returns exactly the string `getPublicUrl` returned before,
 * because it calls `getPublicUrl` to produce it. What changed is that there is
 * now somewhere to stand when that stops being the right answer.
 *
 * The `import.meta.env` read lives here and the decision lives in
 * `mediaUrlMode.ts`, which imports nothing — the same split as
 * `lib/supabase/config.ts`, and for the same reason: a decision inside a module
 * that touches `import.meta.env` and supabase-js cannot be reached from
 * `node --test` at all, and an unreachable check is a gap in the module
 * boundary rather than a gap in the suite.
 */

import { createClient } from "@/lib/supabase/client";
import {
  avatarMediaObjectRef,
  messageMediaObjectRef,
  variantMediaObjectRef,
  type MediaObjectRef,
  type MediaObjectRefMessage,
} from "./mediaObjectRef.ts";
import {
  modeAllowsPublicFallback,
  modeSignsUrls,
  resolveMediaUrlMode,
  type MediaUrlMode,
} from "./mediaUrlMode.ts";
import {
  createSignedMediaUrlStore,
  type SignedPathResult,
} from "./signedMediaUrlStore.ts";

const MODE: MediaUrlMode = resolveMediaUrlMode(
  import.meta.env as unknown as { VITE_MEDIA_SIGNED_URLS?: unknown },
);

export function mediaUrlMode(): MediaUrlMode {
  return MODE;
}

/**
 * The public address of an object.
 *
 * The only `getPublicUrl` call left in the client. Everything else asks this,
 * and a test asserts that that stays true — see
 * `tests/unit/media-object-url.test.mts`.
 */
export function publicMediaObjectUrl(ref: MediaObjectRef | null | undefined): string | null {
  if (!ref) return null;
  return createClient().storage.from(ref.bucket).getPublicUrl(ref.path).data.publicUrl ?? null;
}

/** Signs a bucket's worth of paths in one POST. See `signedMediaUrlStore`. */
async function signPaths(
  bucket: string,
  paths: string[],
  expiresInSeconds: number,
): Promise<SignedPathResult[]> {
  const { data, error } = await createClient()
    .storage
    .from(bucket)
    .createSignedUrls(paths, expiresInSeconds);
  // A failed POST is thrown rather than reported per path: the store must tell
  // "this object is refused" from "the network is down", and only the first of
  // those may be remembered.
  if (error || !data) throw error ?? new Error("sign_failed");
  return data.map((row) => ({
    path: row.path ?? "",
    signedUrl: row.signedUrl ?? null,
    error: row.error ?? null,
  }));
}

const signedUrls = createSignedMediaUrlStore({ sign: signPaths });

/** The signed-URL store, for the hook and for a sign-out to clear. */
export function signedMediaUrls() {
  return signedUrls;
}

/**
 * Ask for an object's address ahead of needing it.
 *
 * A no-op in `"public"` mode, where there is nothing to fetch.
 */
export function requestMediaObjectUrl(ref: MediaObjectRef | null | undefined): void {
  if (!ref || !modeSignsUrls(MODE)) return;
  signedUrls.request(ref);
}

/**
 * The address to put in a `src` now, or `null`.
 *
 * Synchronous on purpose: this is called from render, and an address that
 * arrives in a promise arrives after the browser has already started
 * downloading whatever was in the `src` in the meantime. `null` means "not
 * yet" — draw the placeholder, and re-render when the store says so.
 */
export function mediaObjectUrl(ref: MediaObjectRef | null | undefined): string | null {
  if (!ref) return null;
  if (!modeSignsUrls(MODE)) return publicMediaObjectUrl(ref);
  const signed = signedUrls.get(ref);
  if (signed) return signed;
  return modeAllowsPublicFallback(MODE) ? publicMediaObjectUrl(ref) : null;
}

/** Whether the store has finished deciding about this object. */
export function isMediaObjectUrlSettled(ref: MediaObjectRef | null | undefined): boolean {
  if (!ref || !modeSignsUrls(MODE)) return true;
  return signedUrls.isSettled(ref);
}

/**
 * The address, waiting for it if it is not yet known.
 *
 * For the handful of callers that are not a render — copying an image to the
 * clipboard, saving a file — where a promise is the natural shape and a
 * placeholder is not.
 */
export async function ensureMediaObjectUrl(
  ref: MediaObjectRef | null | undefined,
  timeoutMs = 8000,
): Promise<string | null> {
  if (!ref) return null;
  const immediate = mediaObjectUrl(ref);
  if (immediate) return immediate;
  return await new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(mediaObjectUrl(ref)), timeoutMs);
    const unsubscribe = signedUrls.subscribe(() => {
      if (signedUrls.isSettled(ref)) finish(mediaObjectUrl(ref));
    });
    requestMediaObjectUrl(ref);
  });
}

/* ------------------------------------------------------------------------- *
 * The shapes the product actually holds, so a caller never assembles a ref.
 * ------------------------------------------------------------------------- */

/** A message's own media — the photograph, the video, the voice, the file. */
export function messageMediaUrl(
  message: MediaObjectRefMessage | null | undefined,
): string | null {
  return mediaObjectUrl(messageMediaObjectRef(message));
}

/** A generated variant: a preview, a thumbnail, a poster, a 720p re-encode. */
export function variantMediaUrl(row: {
  variant_bucket: string | null;
  variant_path: string | null;
}): string | null {
  return mediaObjectUrl(variantMediaObjectRef(row));
}

/** A picture whose only record is a URL: a profile's, a chat's, a bot's. */
export function avatarMediaUrl(url: string | null | undefined): string | null {
  const ref = avatarMediaObjectRef(url);
  // A URL that is not one of ours — nothing in production has one, but a bot's
  // avatar is set through an API and the column is only text — is passed
  // through untouched rather than dropped.
  if (!ref) return url ?? null;
  return mediaObjectUrl(ref);
}
