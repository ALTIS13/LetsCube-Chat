/**
 * Resolving a *computed* CSS length expression to pixels.
 *
 * `getComputedStyle(el).maxWidth` does not hand back a number. For a declared
 * cap like `min(86vw, 560px, max(16rem, calc(100% - var(--kub-action-lane))))`
 * it hands back the expression with every unit already made absolute — `86vw`
 * arrives as `1238.4px`, `16rem` as `256px`, the custom property already
 * substituted — and only percentages left standing, because a percentage
 * resolves against a containing block the style system will not commit to here.
 *
 * Feeding that string to `parseFloat` is how `max-width: 100%` once became the
 * number 100: a hundred pixels, handed to a layout decision as if it were the
 * width of the box. So this evaluates the expression instead, and returns
 * `null` for anything it does not fully understand rather than a plausible
 * wrong number. A caller that gets `null` must keep whatever it would have done
 * without a cap.
 *
 * Only what a computed value can still contain is supported: `min()`, `max()`,
 * `clamp()`, `calc()`, parentheses, `+ - * /`, pixel lengths, percentages and
 * bare numbers. `none`, `auto`, and any unit that is not `px` yield `null` —
 * an unresolved unit means the value did not come from a computed style, and
 * guessing at it is exactly the failure this replaces.
 */

interface Cursor {
  text: string;
  index: number;
  /** What `%` is a percentage of, or `null` when the caller cannot say. */
  basis: number | null;
  failed: boolean;
}

export function resolveCssLength(value: string, percentBasis: number | null = null): number | null {
  const text = value.trim();
  if (!text) return null;

  const cursor: Cursor = { text, index: 0, basis: percentBasis, failed: false };
  const result = readSum(cursor);
  skipSpace(cursor);
  if (cursor.failed || cursor.index !== text.length || !Number.isFinite(result)) return null;
  return result;
}

function skipSpace(cursor: Cursor): void {
  while (cursor.index < cursor.text.length && /\s/.test(cursor.text[cursor.index])) cursor.index += 1;
}

function peek(cursor: Cursor): string {
  return cursor.index < cursor.text.length ? cursor.text[cursor.index] : "";
}

/** `a + b - c`. The operands of `+` and `-` in CSS maths must be space separated. */
function readSum(cursor: Cursor): number {
  let total = readProduct(cursor);
  for (;;) {
    if (cursor.failed) return Number.NaN;
    const mark = cursor.index;
    skipSpace(cursor);
    const operator = peek(cursor);
    if (operator !== "+" && operator !== "-") {
      cursor.index = mark;
      return total;
    }
    cursor.index += 1;
    const right = readProduct(cursor);
    total = operator === "+" ? total + right : total - right;
  }
}

/** `a * b / c`. */
function readProduct(cursor: Cursor): number {
  let total = readValue(cursor);
  for (;;) {
    if (cursor.failed) return Number.NaN;
    const mark = cursor.index;
    skipSpace(cursor);
    const operator = peek(cursor);
    if (operator !== "*" && operator !== "/") {
      cursor.index = mark;
      return total;
    }
    cursor.index += 1;
    const right = readValue(cursor);
    if (operator === "/" && right === 0) {
      cursor.failed = true;
      return Number.NaN;
    }
    total = operator === "*" ? total * right : total / right;
  }
}

function readValue(cursor: Cursor): number {
  skipSpace(cursor);
  if (cursor.failed) return Number.NaN;

  if (peek(cursor) === "(") {
    cursor.index += 1;
    const inner = readSum(cursor);
    skipSpace(cursor);
    if (peek(cursor) !== ")") {
      cursor.failed = true;
      return Number.NaN;
    }
    cursor.index += 1;
    return inner;
  }

  const name = /^(min|max|clamp|calc)\(/i.exec(cursor.text.slice(cursor.index));
  if (name) {
    cursor.index += name[0].length;
    const args: number[] = [readSum(cursor)];
    for (;;) {
      skipSpace(cursor);
      if (peek(cursor) !== ",") break;
      cursor.index += 1;
      args.push(readSum(cursor));
    }
    skipSpace(cursor);
    if (cursor.failed || peek(cursor) !== ")") {
      cursor.failed = true;
      return Number.NaN;
    }
    cursor.index += 1;
    const kind = name[1].toLowerCase();
    if (kind === "calc") {
      if (args.length !== 1) {
        cursor.failed = true;
        return Number.NaN;
      }
      return args[0];
    }
    if (kind === "clamp") {
      if (args.length !== 3) {
        cursor.failed = true;
        return Number.NaN;
      }
      return Math.max(args[0], Math.min(args[1], args[2]));
    }
    return kind === "min" ? Math.min(...args) : Math.max(...args);
  }

  const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(cursor.text.slice(cursor.index));
  if (!number) {
    cursor.failed = true;
    return Number.NaN;
  }
  cursor.index += number[0].length;
  const amount = Number.parseFloat(number[0]);

  const unit = /^(?:[a-z]+|%)/i.exec(cursor.text.slice(cursor.index));
  if (!unit) return amount;
  cursor.index += unit[0].length;
  if (unit[0] === "%") {
    if (cursor.basis === null) {
      cursor.failed = true;
      return Number.NaN;
    }
    return (amount * cursor.basis) / 100;
  }
  if (unit[0].toLowerCase() === "px") return amount;

  // A relative unit in a *computed* value means this string is not one, and
  // the caller's fallback is better than a guess.
  cursor.failed = true;
  return Number.NaN;
}
