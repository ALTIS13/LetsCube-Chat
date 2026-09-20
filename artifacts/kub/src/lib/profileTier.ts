/**
 * Which of the two profile surfaces an act opens — and where the small one
 * does not exist at all.
 *
 * ## Where the rule comes from
 *
 * Discord stable 615980, read into `docs/operations/reference-clients.md`
 * §15.1. It draws a person through one presentation enum (`R7`: POPOUT, MODAL,
 * MODAL_V2, SIDEBAR, ACCOUNT_POPOUT, ACTION_SHEET, YOU_SCREEN, EMBED) and the
 * assessment enumerated, by reading the importers of wrapper module 342296,
 * exactly which act opens which. Two lists, and the axis between them is not
 * «how big is the surface» but **whose subject the person is**:
 *
 *  - **POPOUT** is opened by a message author's avatar, a message author's
 *    username, the author of a replied-to message, a member-list row, a thread
 *    member list, a voice participant, a mention chip, a facepile, a 24px
 *    avatar button. Every one of them is a face or a name that belongs to
 *    something else the reader was looking at. The person is **incidental**.
 *  - **MODAL** is opened directly, with no popout first, by the `/users/:id`
 *    route, a `discord.com/users/<id>` link inside a message, an activity-member
 *    row, a friend-request notification and a widget card. Every one of them is
 *    an act whose whole subject is that person. The person is **asked for**.
 *
 * So `ProfileOpener` is that axis and nothing else: `"glance"` for a face or a
 * name pressed in passing, `"named"` for an act that says a person's name on
 * the tin.
 *
 * ## The phone has one tier, and that is measured rather than assumed
 *
 * **MEASURED ON DEVICE — 2026-09-21**, Discord 345.9 on `P212C6000159`,
 * 1080x2400 at 420 dpi (411 x 914 dp). Pressing a message author's avatar
 * opens the person **immediately as a full-screen page**: the banner spans
 * x = 0..1079, the full 411 dp, the surface is opaque (its ground reads
 * rgb(0,0,0) against the conversation's rgb(15,12,26) two taps earlier), the
 * corners are square and there is no scrim — so it is a page, not a sheet over
 * the conversation and not a card. Its action row is two buttons of 184 dp
 * side by side at 16 dp margins. **No popout is drawn on the way.**
 *
 * That is the third place mobile Discord contradicts its own web bundle, after
 * settings and the bottom band (§17.1). The compact tier is a thing you can
 * have **beside** what you were reading; a phone has no beside. So below the
 * width where a second surface can stand next to the first, every opener —
 * glance or named — opens the full one.
 *
 * ## Why the threshold is 768 and not the phone's own width
 *
 * It is this product's `md`, the width at which the shell stops being one
 * column: below it the chat list and the conversation are the same screen and
 * a surface over them is the screen. Nothing smaller would be true of a tablet
 * in portrait, which has a beside and should get one.
 */

/** What kind of act asked for the person. */
export type ProfileOpener = "glance" | "named";

/** Which surface answers. */
export type ProfileTier = "compact" | "full";

/**
 * The width below which the compact tier does not exist.
 *
 * `md` in this product's Tailwind scale, and the width at which the shell
 * collapses to one column.
 */
export const PROFILE_COMPACT_MIN_WIDTH = 768;

/**
 * The badge limits the compact card draws with.
 *
 * **Measured on this surface, after a first guess was wrong.** The cap started
 * at one standing and two medals, carried over from `lib/profileBadges.ts`'s
 * record of what fitted a *member row* — and the first render wrapped to two
 * lines, which is what looking at the pixels is for. Measured at 1440 on
 * 2026-09-21: the strip is **302 px** of usable width inside the card and each
 * chip is **99–100 px**, so two chips and the «+N» come to about 242 px and fit,
 * and three come to about 312 px and do not.
 *
 * The full card stays uncapped (`PROFILE_CARD_BADGE_LIMITS`). That is one of
 * the three things that make the summary a summary; the others are the clamped
 * bio and the smaller face.
 */
export const PROFILE_COMPACT_BADGE_LIMITS = { standings: 1, medals: 1 } as const;

/**
 * Which surface to draw.
 *
 * Read on every render from the live width rather than decided once at open
 * time, so a window narrowed past the threshold while a popout is standing
 * becomes the full surface instead of a compact card on a screen with no room
 * for one.
 */
export function resolveProfileTier({
  opener,
  escalated,
  viewportWidth,
}: {
  opener: ProfileOpener;
  /** Whether the reader has pressed «Полный профиль». */
  escalated: boolean;
  viewportWidth: number;
}): ProfileTier {
  if (escalated) return "full";
  if (opener === "named") return "full";
  if (viewportWidth < PROFILE_COMPACT_MIN_WIDTH) return "full";
  return "compact";
}

/**
 * Whether this surface carries the escalation control.
 *
 * Only the compact one does, and Discord agrees in both directions: its popout
 * and its sidebar presentation carry the string `+Xp3hq` = «View Full Profile»,
 * and **the modal does not carry it at all**. A control that would open the
 * surface you are already looking at is the inert control §8 of
 * `reference-clients.md` refuses.
 */
export function profileOffersEscalation(tier: ProfileTier): boolean {
  return tier === "compact";
}

/**
 * Whether the surface takes the whole phone.
 *
 * The full tier does, because that is what was measured on the device above,
 * and because it is a place you have gone to. The compact tier never does —
 * it only exists at widths where it has a beside — so this answers `false` for
 * it at every width rather than relying on the tier rule to keep it off a
 * phone.
 */
export function profileFillsPhone(tier: ProfileTier): boolean {
  return tier === "full";
}
