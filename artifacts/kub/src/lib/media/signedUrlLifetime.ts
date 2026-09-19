/**
 * How long a signed media URL lives, and when it is replaced.
 *
 * D-208, step two, and the part of it that is actually a design rather than a
 * rewiring. A public URL has no lifetime, so nothing in this product has ever
 * had to think about one. A signed URL does, and an image that silently 403s
 * an hour into a session is a worse defect than the one being fixed.
 *
 * ## What was measured, on production, before any of this was chosen
 *
 * Against `core.letscube.ru` on 2026-09-19, signing one generated thumbnail:
 *
 * - A signed response carries **no `cache-control` at all**. It carries
 *   `Expires: <the token's own exp>` and nothing else. The same object over the
 *   public route carries `cache-control: max-age=31536000, immutable`.
 *
 *   So the signature's lifetime *is* the browser's cache lifetime. This is the
 *   fact that sets the number: a 60-second signature does not mean "re-sign
 *   every minute", it means "re-download every picture on screen every minute".
 *   See `lib/mediaCacheControl.ts` for how carefully the year was earned; a
 *   short TTL throws all of it away.
 *
 * - Two signings of the same path with the same `expiresIn` **inside the same
 *   second return a byte-identical URL** — `iat` and `exp` are whole seconds,
 *   and the token is a deterministic function of the two. A second later they
 *   differ. So a re-sign is a new cache key and a new download, which is the
 *   second reason not to re-sign often, and the reason the store below hands
 *   out one URL per object rather than one per component.
 *
 * - An expired token answers **400** — the same status as a tampered token and
 *   as a path that does not exist. A consumer cannot tell them apart, so an
 *   `<img onError>` cannot be a diagnosis; it can only be a prompt to try once
 *   more with a fresh signature.
 *
 * - The token is checked once, when the request is made. A download that has
 *   already begun runs to completion past `exp`; what fails is the *next*
 *   request — a retry after a dropped connection, or the `Range:` request a
 *   `<video>` issues when the viewer seeks. That is why the margin below is
 *   minutes rather than seconds.
 *
 * ## The numbers, and why
 *
 * - **An hour.** It bounds the other half of the defect: the entry's real
 *   complaint is that there is *no revocation of any kind* — leaving a chat,
 *   deleting the message and being banned all change nothing. With signing, the
 *   window in which a removed member still holds a working address is exactly
 *   this TTL. An hour is a defensible answer to "how long after I ban someone
 *   can they still fetch the photo"; a day is not. Below an hour the caching
 *   cost starts to bite for no revocation gain worth having.
 *
 * - **Renew at 80%, not at expiry.** An `<img>` created at t=0 and still on
 *   screen at t=TTL must not become a broken picture. Renewing at 48 minutes
 *   leaves twelve for a slow network, a backgrounded tab, and the clock skew
 *   between the browser and the storage service — the `exp` is stamped from the
 *   *server's* clock, so a browser running five minutes fast would otherwise
 *   believe a dead URL is still good.
 *
 * - **Five minutes of floor.** A URL with less than this left is not handed to
 *   a new consumer at all, because a new consumer is usually about to start a
 *   download that may not be quick. Between the renewal point and the floor a
 *   URL is still served — it is still valid — so the picture on screen never
 *   blinks while its replacement is being fetched.
 *
 * Every number is a plain export so a test can move the clock rather than wait.
 */

/** Seconds a signature is asked for. Also, per the note above, its cache life. */
export const SIGNED_URL_TTL_SECONDS = 3600;

/** Fraction of the life after which a renewal is queued. */
export const SIGNED_URL_REFRESH_RATIO = 0.8;

/** A URL with less than this left is not given to a consumer that has none. */
export const SIGNED_URL_MIN_REMAINING_MS = 5 * 60_000;

export interface SignedUrlLifetime {
  /** When the signature was obtained, by the client's clock. */
  issuedAtMs: number;
  /** When it stops working, by the client's clock. */
  expiresAtMs: number;
  /** When a renewal should be queued. */
  renewAtMs: number;
}

/**
 * The lifetime of a signature just obtained.
 *
 * Dated from the client's clock rather than from the token's `exp`, and
 * deliberately: the two disagree by the skew, and the safe direction is to
 * believe whichever expires sooner. Reading `exp` out of the token would mean
 * parsing a credential the client has no business decoding, and would trust the
 * server's clock over our own for the one decision where being early is free
 * and being late is a broken picture.
 */
export function signedUrlLifetime(
  issuedAtMs: number,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): SignedUrlLifetime {
  const lifeMs = Math.max(1, Math.round(ttlSeconds * 1000));
  return {
    issuedAtMs,
    expiresAtMs: issuedAtMs + lifeMs,
    renewAtMs: issuedAtMs + Math.round(lifeMs * SIGNED_URL_REFRESH_RATIO),
  };
}

export type SignedUrlState =
  /** Good, and nothing to do. */
  | "fresh"
  /** Still good, but a replacement should be on its way. */
  | "renewing"
  /** Too little left to start a download with. Not handed out. */
  | "spent";

export function signedUrlState(lifetime: SignedUrlLifetime, nowMs: number): SignedUrlState {
  if (nowMs >= lifetime.expiresAtMs - SIGNED_URL_MIN_REMAINING_MS) return "spent";
  if (nowMs >= lifetime.renewAtMs) return "renewing";
  return "fresh";
}

/** Whether this signature may still be given to a consumer. */
export function isSignedUrlUsable(lifetime: SignedUrlLifetime, nowMs: number): boolean {
  return signedUrlState(lifetime, nowMs) !== "spent";
}

/** Whether a replacement should be queued for this signature. */
export function shouldRenewSignedUrl(lifetime: SignedUrlLifetime, nowMs: number): boolean {
  return signedUrlState(lifetime, nowMs) !== "fresh";
}
