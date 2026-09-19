/**
 * Where an original's address comes from, per mode. A decision, not a fetch.
 *
 * D-208, step two continued. The variants had no choice about this: a
 * `media_variants` row carries a bucket and a path and no URL at all, so
 * `variantMediaUrl` can only build one. An original is different — the address
 * is *also* sitting in `messages.media_url` (or `profiles.avatar_url`, or a
 * chat's, or a bot's), written months ago by `getPublicUrl`, and that column is
 * what every one of these shapes reads today.
 *
 * So routing the originals needs a rule about which of the two to believe, and
 * that rule is the whole risk of this step: get it wrong and the default
 * `"public"` mode stops being byte-identical to what shipped.
 *
 * ## The rule, and why each arm is the way it is
 *
 * - **Not one of ours** — a `blob:` from a send still in flight, the preview
 *   fixture's `data:` pictures, an address some other service owns. Handed back
 *   untouched in every mode. There is nothing to sign and nothing to leak, and
 *   it is the same decision `avatarMediaUrl` already took for a bot picture set
 *   through the API. Measured rather than assumed: `publicPreviewFixture.ts`
 *   gives every photograph a `data:` URI with `media_bucket` and `media_path`
 *   both null, so a resolver that returned `null` here would take every picture
 *   out of the fixture — which is the surface this work is screenshotted on.
 *
 * - **`"public"` — the column wins.** Not a rebuilt address. The two agree on
 *   every row that carries both (294 of 294, measured on production
 *   2026-09-19), but "they agree on production today" is a weaker promise than
 *   "this cannot change what is on screen", and the second one is what the
 *   default mode owes. The column is also the only source that carries a query
 *   string a caller appended, and rebuilding drops it silently.
 *
 * - **`"public"` with no column** — build from the object. A row with a path
 *   and no URL renders nothing today; building one is strictly more than
 *   shipped and can regress nothing.
 *
 * - **`"signed"` / `"signed-only"` — the object wins**, and the column is not
 *   consulted even as a fallback. The fallback that exists in `"signed"` is
 *   `modeAllowsPublicFallback`, inside the resolver, which rebuilds the public
 *   URL *from the object* — so a row is never addressed by a string this client
 *   did not derive. That matters for `"signed-only"`, whose whole purpose is to
 *   prove the client no longer needs the public route: quietly falling back to
 *   `media_url` there would hide exactly the dependency being measured.
 *
 * This module imports nothing but the two other pure modules, so `node --test`
 * can reach it. That is deliberate and it is the project's own lesson: the
 * mode-dependent decision inside `mediaUrl.ts` cannot be reached from a unit
 * test at all, because that module reads `import.meta.env` and imports
 * supabase-js. Moving the decision is cheaper than building a harness round it.
 */

import {
  avatarMediaObjectRef,
  messageMediaObjectRef,
  type MediaObjectRef,
  type MediaObjectRefMessage,
} from "./mediaObjectRef.ts";
import { modeSignsUrls, type MediaUrlMode } from "./mediaUrlMode.ts";

export type MediaSource =
  /** Use this string exactly as it is. */
  | { kind: "stored"; url: string }
  /** Ask the resolver for this object's current address. */
  | { kind: "object"; ref: MediaObjectRef }
  /** There is no media here. */
  | { kind: "none" };

function storedUrl(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function chooseSource(
  ref: MediaObjectRef | null,
  stored: string | null,
  mode: MediaUrlMode,
): MediaSource {
  if (!ref) return stored ? { kind: "stored", url: stored } : { kind: "none" };
  if (modeSignsUrls(mode)) return { kind: "object", ref };
  return stored ? { kind: "stored", url: stored } : { kind: "object", ref };
}

/** Where a message's own photograph, video, voice message or file comes from. */
export function messageMediaSource(
  message: MediaObjectRefMessage | null | undefined,
  mode: MediaUrlMode,
): MediaSource {
  return chooseSource(
    messageMediaObjectRef(message),
    storedUrl(message?.media_url),
    mode,
  );
}

/** Where a profile's, a chat's or a bot's picture comes from. */
export function avatarMediaSource(
  url: string | null | undefined,
  mode: MediaUrlMode,
): MediaSource {
  return chooseSource(avatarMediaObjectRef(url), storedUrl(url), mode);
}
