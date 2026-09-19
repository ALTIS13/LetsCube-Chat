/**
 * Which stored object a thing on screen is, said once.
 *
 * D-208. Every photograph, voice message, video and avatar in this product
 * lives in one bucket whose `public` flag is `true`, and the client addresses
 * all of it by a public URL — either built on the spot with `getPublicUrl`, or
 * read out of a column that had one written into it months ago. A public URL is
 * not a reference to an object, it is a *grant*: it works for anyone who has the
 * string, forever, with no account and no revocation.
 *
 * The first move away from that is to stop passing URLs around and start
 * passing the thing a URL is only one rendering of — a bucket and a path. This
 * module is that type and nothing else. It imports nothing, so the unit suite
 * can reach it; see `lib/supabase/config.ts` for why that matters here.
 *
 * Deriving a ref is not always reading two columns. 294 of this deployment's
 * 314 media messages carry `media_bucket` and `media_path`; 20 predate those
 * columns and carry only `media_url`, and every avatar — a profile's, a chat's,
 * a bot's — carries only a URL, because those tables have no path column at
 * all. Measured on production on 2026-09-19: all 20 legacy URLs and all 16
 * avatar URLs parse back to a path with no percent-escapes and no query string,
 * and every one of the 16 names an object that exists. So the path can be
 * recovered from the URL, and a schema change is not on the critical path for
 * any of them.
 */

/** The segment a public object URL is built around. */
export const PUBLIC_OBJECT_SEGMENT = "/storage/v1/object/public/";

/** The segment a *signed* object URL is built around, for recognising one. */
export const SIGNED_OBJECT_SEGMENT = "/storage/v1/object/sign/";

export interface MediaObjectRef {
  bucket: string;
  path: string;
}

/**
 * A stable key for one object, for a cache or a `Map`.
 *
 * A newline, because it cannot occur in either half: a bucket id is
 * `[a-z0-9-]` and a storage object name may not contain one.
 */
export function mediaObjectRefKey(ref: MediaObjectRef): string {
  return `${ref.bucket}\n${ref.path}`;
}

export function mediaObjectRefFromKey(key: string): MediaObjectRef | null {
  const split = key.indexOf("\n");
  if (split <= 0 || split === key.length - 1) return null;
  return { bucket: key.slice(0, split), path: key.slice(split + 1) };
}

function normalizePath(path: string | null | undefined): string | null {
  if (typeof path !== "string") return null;
  const trimmed = path.trim().replace(/^\/+/, "");
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The bucket and path a public object URL names, or `null`.
 *
 * Parsed with `URL` rather than by cutting the string, so a version token —
 * `?v=20260903213405`, which `withVersionToken` appends to every avatar and
 * every variant — lands in the search and not in the path. The pathname is
 * percent-encoded (`getPublicUrl` runs `encodeURI` over the whole address), so
 * it is decoded back.
 *
 * A path containing a literal `?` or `#` cannot survive this, because it cannot
 * survive `encodeURI` either — such a URL is already broken on screen today, so
 * refusing it here changes nothing.
 */
export function parsePublicObjectUrl(url: string | null | undefined): MediaObjectRef | null {
  if (typeof url !== "string" || url.length === 0) return null;
  let pathname: string;
  try {
    // A base makes a relative URL parse too; an absolute one ignores it.
    pathname = new URL(url, "http://media.invalid").pathname;
  } catch {
    return null;
  }
  const at = pathname.indexOf(PUBLIC_OBJECT_SEGMENT);
  if (at < 0) return null;
  const rest = pathname.slice(at + PUBLIC_OBJECT_SEGMENT.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  let bucket = rest.slice(0, slash);
  let path = rest.slice(slash + 1);
  try {
    bucket = decodeURIComponent(bucket);
    path = decodeURIComponent(path);
  } catch {
    // A malformed escape: keep the raw form rather than losing the reference.
  }
  const normalized = normalizePath(path);
  if (!bucket || !normalized) return null;
  return { bucket, path: normalized };
}

/** The message columns a ref can be derived from. Deliberately structural. */
export interface MediaObjectRefMessage {
  media_bucket?: string | null;
  media_path?: string | null;
  media_url?: string | null;
}

/**
 * The object a message's media is, from its columns.
 *
 * The path columns win when they are there. `media_url` is the fallback for the
 * 20 rows written before those columns existed — and, since it is the same
 * address the columns would produce (measured: all 294 rows that carry both
 * agree exactly), reading it loses nothing.
 */
export function messageMediaObjectRef(
  message: MediaObjectRefMessage | null | undefined,
): MediaObjectRef | null {
  if (!message) return null;
  const path = normalizePath(message.media_path);
  if (path) {
    const bucket = typeof message.media_bucket === "string" ? message.media_bucket.trim() : "";
    // A path with no bucket beside it is not a reference to anything. Guessing
    // "media" here would work today and would silently follow the default into
    // whichever bucket a later migration made default.
    if (bucket) return { bucket, path };
  }
  return parsePublicObjectUrl(message.media_url);
}

/**
 * The object an avatar URL names.
 *
 * `profiles.avatar_url`, `chats.avatar_url` and `bots.avatar_url` hold a full
 * public URL and nothing else. Until one of them grows a path column this is
 * the only way to learn which object a picture is.
 */
export function avatarMediaObjectRef(url: string | null | undefined): MediaObjectRef | null {
  return parsePublicObjectUrl(url);
}

/** The object a `media_variants` row names. Both columns are non-null there. */
export function variantMediaObjectRef(row: {
  variant_bucket: string | null;
  variant_path: string | null;
}): MediaObjectRef | null {
  const path = normalizePath(row.variant_path);
  const bucket = typeof row.variant_bucket === "string" ? row.variant_bucket.trim() : "";
  if (!bucket || !path) return null;
  return { bucket, path };
}

/**
 * The public URL for a ref, built from a base origin.
 *
 * The same string `getPublicUrl` produces — `encodeURI` over the whole address,
 * which is what makes the two interchangeable while the bucket is still public.
 * Kept here so the shape is stated once and can be compared against in a test.
 */
export function formatPublicObjectUrl(storageBaseUrl: string, ref: MediaObjectRef): string {
  const base = storageBaseUrl.replace(/\/+$/, "");
  return encodeURI(`${base}/object/public/${ref.bucket}/${ref.path}`);
}

/** Whether a URL is a signed one — it carries a credential and an expiry. */
export function isSignedObjectUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes(SIGNED_OBJECT_SEGMENT);
}
