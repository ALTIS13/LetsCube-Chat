/**
 * The surface a message's menus are made of.
 *
 * Everything that opens over the conversation for a message — the phone's
 * reaction bar and card, the desktop strip and menu, the column of quick
 * reactions, the list of who reacted, the emoji panel — covers content it is
 * not part of, so it takes the strong material, and it lands on a backdrop
 * nobody chose, so it keeps its own edge (rules 1 and 11 of
 * `docs/operations/interface-material.md`).
 *
 * One string for all of them, so what they are made of is one edit, and seven
 * covering surfaces cannot drift into seven slightly different ones.
 */
export const COVERING_SURFACE = "kub-glass-strong border border-[color:var(--kub-border-color)]";
