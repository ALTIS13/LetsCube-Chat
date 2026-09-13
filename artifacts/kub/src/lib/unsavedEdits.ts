/**
 * Whether something typed into a form has been left unsaved.
 *
 * One rule, two surfaces. The group's settings screen asks «Отменить
 * изменения?» before dropping a typed name or description (D-164, and
 * `chatProfileDirty` in `chatSettings.ts` is now a call into this module rather
 * than a second copy of the rule). The personal settings screen had the same
 * defect and did not ask at all (D-136): ✕, «Закрыть», Escape and a click on
 * the backdrop each threw away a typed «Имя», «Никнейм» or «О себе» without a
 * word. Nothing typed and unsaved may be discarded silently, and one rule for
 * that is cheaper than two that drift.
 *
 * **Compare what the save would write, not what is on screen.** Trimming is the
 * default because whitespace is not an edit: a trailing space nobody meant to
 * type must not raise a question somebody then has to answer. A field whose save
 * normalises further passes that same normaliser here — the profile collapses
 * runs of spaces in a name and strips «@» from a никнейм — so «Максим  Орлов»
 * against a saved «Максим Орлов» is not an edit either. Comparing raw values
 * would ask about changes the save itself would erase.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

export interface UnsavedField {
  /** What is stored now, from the record the screen was opened on. */
  saved: string;
  /** What is in the control. */
  edited: string;
  /**
   * How the save normalises a value before writing it. Defaults to trimming,
   * which is what every plain text field in this product does.
   */
  normalize?: (value: string) => string;
}

const trimmed = (value: string): string => value.trim();

/** Whether this one field has been typed into and not saved. */
export function fieldEdited(field: UnsavedField): boolean {
  const normalize = field.normalize ?? trimmed;
  return normalize(field.saved) !== normalize(field.edited);
}

/** Whether any of them has. One is enough to have to ask. */
export function hasUnsavedEdits(fields: readonly UnsavedField[]): boolean {
  return fields.some((field) => fieldEdited(field));
}
