/**
 * The chat screen's chrome, as the owner chose it on 2026-09-11: option C,
 * «Капсулы и цвет», on every shell — the installed iPhone app, Android, the web
 * app and the Windows app.
 *
 * No bar under the status bar and none across the conversation. The header, the
 * pinned message and the composer float over the conversation as capsules of
 * the panel material, and a scroll edge painted behind the chrome keeps their
 * text readable over whatever passes under them. What each rule of
 * docs/operations/interface-material.md gives up for that is recorded there,
 * under «The chat screen».
 *
 * This module is the part that is a rule rather than markup, so it can be
 * tested without a bundler.
 */

/**
 * What the back button counts: everything unread in the other chats, the way
 * Telegram's back button does. The open chat is left out — it is being read.
 */
export function unreadElsewhere(
  chats: ReadonlyArray<{ id: string; unread_count?: number | null }>,
  openChatId: string,
): number {
  return chats.reduce(
    (total, chat) => (chat.id === openChatId ? total : total + Math.max(0, chat.unread_count ?? 0)),
    0,
  );
}

/** The count as it is drawn: nothing at zero, and «999+» from a thousand, so the capsule keeps its size. */
export function unreadBadgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return count > 999 ? "999+" : String(Math.floor(count));
}

/**
 * A capsule's glass, given to `KubGlassLayer`: the panel material on a leaf,
 * with the lit rim a floating surface keeps against a backdrop nobody chose
 * (rule 11). The rim is `--glass-line` rather than the sheet-edge blue: a
 * capsule is not a sheet, and that colour's perimeters are held to a ratchet in
 * tests/unit/edge-vocabulary.test.mjs.
 */
export const CAPSULE_GLASS = "rounded-full border border-[color:var(--glass-line)]";

/**
 * The same glass on a capsule that is itself the control, which carries
 * `group/capsule`.
 *
 * `.kub-raise-hover` on such a control would paint its veil on the control's
 * own background, underneath the glass layer that is its first child, where
 * the light theme's .80 fill hides it. So the capsule steps its glass instead:
 * the raise veil under the pointer and two sink veils when pressed, laid on as
 * background images over the material's own fill — the same two steps
 * `.kub-raise-hover` and `PRESS_SINK` give an opaque control (rule 5).
 */
export const CAPSULE_CONTROL_GLASS =
  "rounded-full border border-[color:var(--glass-line)] group-hover/capsule:bg-[image:linear-gradient(var(--kub-raise-veil),var(--kub-raise-veil))] group-active/capsule:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]";
