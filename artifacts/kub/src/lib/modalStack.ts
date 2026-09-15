/**
 * Which modal Escape belongs to.
 *
 * Every open `KubModal` adds its own `keydown` listener to `window`, so one
 * Escape was answered by **all** of them. On a phone that is not theoretical:
 * below `md` the settings are a `KubModal` rather than a column, so a
 * confirmation raised inside them — «Удалить фото профиля?», «Отменить
 * изменения?» — closed itself *and* the settings screen underneath, in one
 * press. Found on 2026-09-15 by a test that pressed Escape over the new
 * photograph confirmation and then looked for the control it had come from: the
 * dialog had gone, and so had the screen. The same run passed at 1440, where
 * the settings are a column and there is only one modal to answer.
 *
 * A layer stack is the whole of the fix: a modal answers Escape only while it
 * is the one on top. It lives here rather than in the component because a rule
 * about ordering is exactly the kind that regresses silently, and a decision
 * made inside a component that needs React cannot be reached by `node --test`.
 *
 * This is deliberately **not** `z-index` and not a DOM query. Both describe
 * where something is painted; this describes the order things were opened in,
 * which is what «topmost» means to a person pressing Escape.
 *
 * Note that it does not replace the `timeStamp` guard in `KubModal` (D-181): a
 * dialog opened by a key press must not be closed by that same press, and being
 * on top is no protection against that — it is on top precisely then.
 */

/** Opened modals, oldest first. The last entry is the one Escape belongs to. */
const stack: string[] = [];

/** Registers an opened modal and returns its handle. */
export function pushModalLayer(id: string): string {
  stack.push(id);
  return id;
}

/** Removes a modal from the stack, wherever it sits — closing need not be LIFO. */
export function popModalLayer(id: string): void {
  const index = stack.lastIndexOf(id);
  if (index !== -1) stack.splice(index, 1);
}

/**
 * Whether this modal is the one on top.
 *
 * A modal that was never registered answers `false` rather than `true`: an
 * unknown layer is not the top one, and guessing otherwise puts the old
 * behaviour back for anything that forgets to register.
 */
export function isTopModalLayer(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** How many modals are open. For tests, and for reading state in the console. */
export function openModalLayerCount(): number {
  return stack.length;
}

/** Empties the stack. Tests only — nothing in the product should need it. */
export function resetModalLayers(): void {
  stack.length = 0;
}
