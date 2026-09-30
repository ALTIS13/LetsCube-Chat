/**
 * One field shell: a search or a short text field inside a dialog — a box on
 * `--kub-surface-2` with the sheet-edge line and a focus ring on the box. The
 * invitation dialog's search and a link's name use it, and so does the micro-
 * group's people search.
 *
 * One class list, not copies, so `tests/unit/edge-vocabulary.test.mjs` counts
 * the perimeter once — the arrangement `pages/tasks/taskFieldWell.ts` has for
 * the task form's fields.
 */
export const FIELD_SHELL =
  "flex items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 h-10 transition-all focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]";
