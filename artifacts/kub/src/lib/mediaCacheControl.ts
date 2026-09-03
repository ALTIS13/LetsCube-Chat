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
 */

/** A name that belongs to exactly one upload. Safe to keep for a year. */
export const IMMUTABLE_CACHE_CONTROL = "max-age=31536000, immutable";

/**
 * A path that is reused when the picture changes.
 *
 * Thirty days, not a year: long enough that the request cost disappears, short
 * enough that a reference which somehow lacks a version token heals by itself
 * rather than showing last month's face until next year.
 */
export const REUSED_PATH_CACHE_CONTROL = "max-age=2592000";

/**
 * Paths whose bytes are overwritten in place rather than given a new name.
 *
 * Both are avatar variants: `{owner}/{kind}.webp` has nowhere to put a version,
 * so changing the picture reuses the address. A chat's is here for the same
 * reason a profile's is — a renamed group photo must not show last month's.
 */
const REUSED_PREFIXES = ["variants/profiles/", "variants/chats/"];

/**
 * The value to send when uploading to `objectPath`.
 *
 * Defaults to immutable because that is what every upload path in this product
 * produces — a unique name per upload. A new prefix that overwrites in place
 * must be added to `REUSED_PREFIXES`, or it will be cached as though it never
 * changes.
 */
export function cacheControlFor(objectPath: string): string {
  const normalized = objectPath.replace(/^\/+/, "");
  return REUSED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ? REUSED_PATH_CACHE_CONTROL
    : IMMUTABLE_CACHE_CONTROL;
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
