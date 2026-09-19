/**
 * Which kind of address this build gives a stored object.
 *
 * D-208 is fixed in an order that cannot be reversed, and this is the switch
 * that orders it. The register's four steps are: the client stops building
 * public URLs; signatures get a lifetime and a refresh; the rows that hold only
 * a URL are back-filled; and only then the bucket becomes private. Any other
 * order takes every picture in the product off the screen until the client
 * catches up.
 *
 * ## Why this is three states and not a boolean
 *
 * Because of something measured rather than assumed. On 2026-09-19 the `media`
 * bucket's SELECT policy — `_kub_media_path_allowed` — was evaluated on
 * production as a real chat member looking at a photograph a *different* member
 * had sent:
 *
 *     may_select_the_photo            f
 *     may_select_its_preview          f
 *     uploader_may_select_own_photo   t
 *     uploader_may_select_its_preview f
 *
 * and a plain `select count(*)` on those two object rows as that member
 * returned **0**, where `postgres` sees 2.
 *
 * Signing requires `select` on `storage.objects`. So on today's policies a
 * client that simply switched to signed URLs would lose every photograph,
 * video, voice message and file anybody else sent, **and every generated
 * preview, thumbnail, poster and 720p variant including its own** — the whole
 * `variants/` prefix matches no branch of that function at all. What holds
 * those pictures on screen today is not the policy. It is the bucket's `public`
 * flag, which is the defect.
 *
 * That is a step the register does not have, and it comes before its step one:
 * the read policy has to admit a chat's members to that chat's media before
 * signing can succeed for anyone but an uploader. Until it does, `"signed"`
 * keeps a public fallback so that turning the flag on measures the machinery
 * without blanking a conversation.
 *
 * - `"public"` — what shipped: a public URL, and nothing else. The default.
 * - `"signed"` — a signature when one can be had, the public URL when it cannot.
 *   Safe while the bucket is public; meaningless once it is not.
 * - `"signed-only"` — a signature or nothing. What step four requires, and what
 *   a private bucket enforces regardless of what this says.
 */

export type MediaUrlMode = "public" | "signed" | "signed-only";

export interface MediaUrlModeEnv {
  VITE_MEDIA_SIGNED_URLS?: unknown;
}

/**
 * The mode for a build, from its environment.
 *
 * Anything unrecognised — absent, empty, a typo, a boolean `true` from a badly
 * quoted value — is `"public"`. A misread flag must fail towards the shipped
 * behaviour, not towards a blank conversation.
 */
export function resolveMediaUrlMode(env: MediaUrlModeEnv | undefined | null): MediaUrlMode {
  const raw = env?.VITE_MEDIA_SIGNED_URLS;
  if (typeof raw !== "string") return "public";
  const value = raw.trim().toLowerCase();
  if (value === "signed" || value === "1" || value === "true") return "signed";
  if (value === "signed-only" || value === "only" || value === "strict") return "signed-only";
  return "public";
}

/** Whether this mode asks for signatures at all. */
export function modeSignsUrls(mode: MediaUrlMode): boolean {
  return mode !== "public";
}

/**
 * Whether a public URL may stand in when no signature is available.
 *
 * True only in `"signed"`. This is the one line step four deletes — or rather,
 * the one line whose value step four changes by setting the flag to
 * `signed-only`; making the bucket private removes the fallback's *effect*
 * whatever it says, which is why the flag must be flipped first and verified.
 */
export function modeAllowsPublicFallback(mode: MediaUrlMode): boolean {
  return mode === "signed";
}
