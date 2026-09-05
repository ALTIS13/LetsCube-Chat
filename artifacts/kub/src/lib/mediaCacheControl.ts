/**
 * How long a stored object may be kept without asking again.
 *
 * Supabase serves `max-age=3600` unless an upload says otherwise, and nothing
 * here ever said otherwise. Measured against production: inside the hour a chat
 * costs no requests at all, and after it every avatar and every preview costs a
 * conditional request answered 304 — nothing re-downloads, but a chat with
 * fifty pictures is fifty round trips on every visit, which is what a slow
 * connection feels.
 *
 * Almost all of it cannot change, and the paths are what say so. A message's
 * picture, its variants and every avatar file carry a name that is unique to
 * one upload, so the bytes behind a URL are fixed forever and the browser never
 * needs to ask. The one exception is a profile's *variant*, at
 * `variants/profiles/{user}/{kind}.webp`, which is overwritten when someone
 * changes their picture — the same URL, different bytes.
 *
 * The value is only honoured when it is sent at upload time: this deployment's
 * storage service reads it from the request, not from the object row, so
 * editing the stored metadata afterwards changes nothing. Measured both ways.
 *
 * ## These are seconds, not a `Cache-Control` value
 *
 * The upload field is a TTL. The service writes the header itself, and the two
 * ways a browser can upload disagree about what they will accept — read off
 * `storage-api` v1.60.4 running in production:
 *
 * - A file at or under the resumable threshold goes up as a `Blob`, which
 *   `storage-js` puts in a multipart form field. The service does
 *   ``cacheControl = cacheTime ? `max-age=${cacheTime}` : "no-cache"`` with no
 *   check at all (`dist/storage/uploader.js`), so a directive here is pasted
 *   after its own prefix and stored as `max-age=max-age=31536000, immutable` —
 *   a malformed `max-age`, which is worse than saying nothing.
 * - A larger file goes over tus, where the same value travels as upload
 *   metadata. There the service tests `/^-?\d+$/` first and falls back to
 *   `no-cache` when it fails (`dist/http/routes/tus/lifecycle.js`), so a
 *   directive does not merely deform the header, it throws the lifetime away.
 *
 * So a number is the only value both paths accept, and passing one is what the
 * two constants below exist to guarantee.
 *
 * ## `immutable` is deliberately not sent from the browser
 *
 * A decision, not an omission. The multipart branch would today carry
 * `"31536000, immutable"` through to the header, because it does not validate —
 * but the tus branch already rejects exactly that shape, and the field is
 * documented as a TTL, so relying on one branch's missing check is relying on a
 * bug staying unfixed. `max-age` alone buys the whole measured win: a year is
 * far past any session, and the browser does not revalidate inside it. What
 * `immutable` adds is only that an explicit reload skips revalidation too.
 *
 * Where it is safe to be exact, it is still sent: the variants worker uploads a
 * `Buffer`, which takes `storage-js`'s binary branch, and that branch honours a
 * real `cache-control` request header. See `uploadVariant` in
 * `artifacts/api-server/src/workers/mediaVariantsWorker.ts`.
 */

/**
 * `max-age`, in seconds, for a name that belongs to exactly one upload. A year,
 * because nothing will ever be written to that address again.
 *
 * The path is what is immutable here, not the header: this value goes into an
 * upload's `cacheControl`, which is a lifetime, and a browser upload has no way
 * to add the `immutable` directive on top of it. See the note above.
 */
export const IMMUTABLE_PATH_MAX_AGE_SECONDS = "31536000";

/**
 * `max-age`, in seconds, for a path that is reused when the picture changes.
 *
 * Thirty days, not a year: long enough that the request cost disappears, short
 * enough that a reference which somehow lacks a version token heals by itself
 * rather than showing last month's face until next year.
 */
export const REUSED_PATH_MAX_AGE_SECONDS = "2592000";

/**
 * Paths whose bytes are overwritten in place rather than given a new name.
 *
 * A profile's variant is `variants/profiles/{owner}/{kind}.webp`, which has
 * nowhere to put a version, so changing the picture reuses the address.
 *
 * A chat's is deliberately not in this list. Its folder is derived from the
 * source path — see `avatarPathToken` in the worker's rules — which both keeps
 * it as unguessable as the original and makes every picture a new address, so
 * it is immutable like any other freshly named upload.
 */
const REUSED_PREFIXES = ["variants/profiles/"];

/**
 * The lifetime, in seconds, to send when uploading to `objectPath`.
 *
 * Goes straight into `cacheControl` on a `storage-js` upload, which is a TTL
 * and not a header — see the note at the top of this file.
 *
 * Defaults to the immutable lifetime because that is what every upload path in
 * this product produces — a unique name per upload. A new prefix that
 * overwrites in place must be added to `REUSED_PREFIXES`, or it will be cached
 * as though it never changes.
 */
export function cacheControlFor(objectPath: string): string {
  const normalized = objectPath.replace(/^\/+/, "");
  return REUSED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ? REUSED_PATH_MAX_AGE_SECONDS
    : IMMUTABLE_PATH_MAX_AGE_SECONDS;
}

/**
 * A version token for a URL whose path is reused.
 *
 * A changed avatar keeps its path, so without this the browser would serve the
 * old bytes for as long as the cache allows. Appending the moment the variant
 * was written makes a changed picture a different URL, which is what lets the
 * object itself be cached for a month.
 */
export function withVersionToken(
  url: string | null | undefined,
  version: string | null | undefined,
): string | null {
  if (!url) return null;
  if (!version) return url;
  // A stable, short token: the timestamp's own characters, minus punctuation.
  const token = version.replace(/[^0-9]/g, "").slice(0, 14);
  if (!token) return url;
  return url.includes("?") ? `${url}&v=${token}` : `${url}?v=${token}`;
}
