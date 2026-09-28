/**
 * The field well inside a task's detail: a well on `--kub-inset` with the edge
 * rule 11 of `docs/operations/interface-material.md` keeps for a well and a
 * target. The checklist's «Добавить пункт» and the reminder's moment and note
 * are one class list, not copies, so `tests/unit/edge-vocabulary.test.mjs`
 * counts the perimeter once.
 */
export const TASK_FIELD_WELL =
  "min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 py-2 text-sm text-[color:var(--kub-text)]";

/**
 * The people search in the task form: the assignee's, and since tracker item
 * 67 the co-executors'. One class list for both, as above.
 */
export const TASK_SEARCH_WELL =
  "flex items-center gap-2 rounded-xl px-3 h-10 bg-[var(--kub-inset)] border border-[color:var(--kub-border-color)] transition-all focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]";
