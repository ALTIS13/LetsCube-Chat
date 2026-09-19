import { Children, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "cyan" | "pink" | "muted" | "online" | "danger" | "warn";

interface KubBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  pill?: boolean;
  /** Defaults to a dot on every coloured tone; see the note below. */
  dot?: boolean;
  /**
   * One colour for this badge's mark and its perimeter, in place of the tone's
   * (D-214).
   *
   * The tone is a vocabulary of six; a role's colour is the administrator's own
   * choice out of eight palette keys, and there is no tone that can stand for
   * it. So a caller that has such a colour hands it in here rather than
   * spelling `KubBadge`'s recipes a second time — which is how the
   * administration panel came to draw a role's dot in one hue inside a border
   * in another.
   *
   * **The mark and the perimeter move together, and that is the point.** Both
   * were measured on the ground a chip really composites on: the border is
   * `color-mix` at 55%, which reads 2.06–3.14:1 on every surface a badge
   * appears on in either theme — under the 3:1 a mark needs on all of them but
   * the dark theme at 1440. It bounds the chip; it does not signal. So the
   * only thing a second hue on it can do is contradict the mark.
   *
   * **The caller owns the value.** It reaches a style attribute, so it must be
   * one this build produced — an enumerated palette reference or a normalised
   * hex — never a string carried through from the database. `ProfileBadgeChip`
   * and `RolesPermissionsTab` both narrow before they call.
   *
   * **Not on a tone that means something.** Three of the six say a fact rather
   * than name a family — `danger`, `warn`, `online` — and an accent replaces
   * the tone's mark and perimeter entirely, so on one of those it would paint
   * over the only thing carrying the fact. The two callers that pass an accent
   * both use `pink`/`cyan`, which after D-214 are a family label and nothing
   * more: `badgeTone` gives `pink` to `owner` and `tech_admin` and `cyan` to
   * the rest, a split that already disagreed with the catalogue it was meant to
   * follow. `muted` is different again — it IS the decision that separates a
   * medal from a standing, so `ProfileBadgeChip` refuses a colour on a medal
   * before it gets here. `tests/unit/status-badge-contrast.test.mjs` is what
   * refuses an accent on a semantic tone.
   */
  accent?: string | null;
  children: ReactNode;
}

/**
 * A status chip.
 *
 * The label used to be painted in the tone and set on an 18% tint of the same
 * tone, which is the pairing that fails: measured across the three surfaces the
 * badge sits on, that combination ranged from 3.17:1 to 5.55:1, and the audit
 * caught "Активна" at 2.62:1. See D-011 and the register's audit pass.
 *
 * Removing the tint alone was not enough — on `--kub-surface-3` the tone as text
 * still measures 4.05:1 (cyan), 4.18:1 (pink) and 3.82:1 (danger), all under the
 * 4.5:1 a label needs. So the label takes the interface text colour, which
 * passes on every surface, and the tone moves to the dot and the border, where
 * the requirement is 3:1 and every tone clears it.
 *
 * That makes the dot load-bearing rather than decorative: with a neutral label,
 * a thin border would be the only carrier of meaning left. It is therefore on by
 * default for coloured tones, and it also means status is never signalled by
 * colour alone — there is a dot, a border and a word.
 */
const borderClass: Record<Tone, string> = {
  cyan: "border-[color:color-mix(in_srgb,var(--kub-cyan)_55%,transparent)]",
  pink: "border-[color:color-mix(in_srgb,var(--kub-pink)_55%,transparent)]",
  muted: "border-[color:var(--kub-border-color)]",
  online: "border-[color:color-mix(in_srgb,var(--kub-online)_55%,transparent)]",
  danger: "border-[color:color-mix(in_srgb,var(--kub-danger)_55%,transparent)]",
  warn: "border-[color:color-mix(in_srgb,var(--kub-warn)_55%,transparent)]",
};

const dotClass: Record<Tone, string> = {
  cyan: "bg-[var(--kub-cyan)]",
  pink: "bg-[var(--kub-pink)]",
  muted: "bg-[color:var(--kub-muted)]",
  online: "bg-[var(--kub-online)]",
  danger: "bg-[var(--kub-danger)]",
  warn: "bg-[var(--kub-warn)]",
};

/**
 * The text inside a pill, made able to shrink.
 *
 * A pill is only a pill while it is one line high. Above that the
 * `rounded-full` radius clamps to half the box, the corners are eaten and the
 * chip renders as an ellipse with the words crammed into it, which is what
 * D-222 recorded. Staying on one line therefore has to be the primitive's job:
 * roughly fifty call sites inherit this component and none of them can be
 * asked to remember it.
 *
 * The obvious spelling — one `min-w-0 truncate` wrapper around `children` —
 * breaks the call sites that are already correct. `ProfileBadgeChip` and
 * `RolesPermissionsTab` pass an icon or a colour swatch beside the label and
 * depend on the flex row for both: the 6px `gap-1.5` between the two, and
 * `h-1.5 w-1.5` on the swatch, which an inline box would ignore entirely. One
 * wrapper turns those children into inline content, the gap disappears and the
 * swatch collapses to nothing.
 *
 * So only text is wrapped, and *runs* of text are wrapped together: React hands
 * `+{n}` two children, «+» and the number, and wrapping them apart would put a
 * gap between the plus and its digit. Grouped this way the result is box for
 * box what the browser already built — contiguous text is one anonymous flex
 * item either way — with `min-width: 0` and `text-overflow: ellipsis` added,
 * which is the whole of the change.
 */
export function pillTextChildren(children: ReactNode): ReactNode {
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = () => {
    if (run.length === 0) return;
    out.push(
      <span key={`pill-text-${out.length}`} className="min-w-0 truncate">
        {run}
      </span>,
    );
    run = [];
  };
  for (const part of Children.toArray(children)) {
    if (typeof part === "string" || typeof part === "number") {
      run.push(part);
      continue;
    }
    flush();
    out.push(part);
  }
  flush();
  return out;
}

export function KubBadge({
  tone = "cyan",
  pill = false,
  dot,
  accent = null,
  className,
  style,
  children,
  ...rest
}: KubBadgeProps) {
  const showDot = dot ?? tone !== "muted";
  // The tone's class stays on the element even with an accent. An inline
  // border colour wins over it, and if the accent is ever a value the browser
  // refuses, the declaration is dropped and the chip keeps a perimeter rather
  // than losing one — which on this component is the whole of its shape.
  const accented = accent
    ? { ...style, borderColor: `color-mix(in srgb, ${accent} 55%, transparent)` }
    : style;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 text-[12px] font-semibold text-[color:var(--kub-text)]",
        // The one-line contract travels with the radius, and only with it.
        // `rounded-md` is 6px: a `rounded-md` badge that takes two lines is
        // cramped, which is a different complaint. `rounded-full` is half the
        // height, so the second line turns the chip into an ellipse — that is
        // the defect, and the fix belongs exactly where it is caused.
        // `max-w-full` and `min-w-0` let the box give way instead of pushing
        // past its container; `whitespace-nowrap` is the contract itself, and
        // it reaches an element child too, not only the text
        // `pillTextChildren` wraps.
        pill ? "max-w-full min-w-0 whitespace-nowrap rounded-full" : "rounded-md",
        borderClass[tone],
        className,
      )}
      style={accented}
      {...rest}
    >
      {showDot && (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", accent ? null : dotClass[tone])}
          style={accent ? { backgroundColor: accent } : undefined}
        />
      )}
      {pill ? pillTextChildren(children) : children}
    </span>
  );
}
