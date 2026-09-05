/**
 * The vocabulary every control speaks.
 *
 * A short list of strings, and the reason each of them is one string rather
 * than a habit repeated at every call site. All of them are Tailwind utilities
 * over tokens that already exist in `index.css`; none writes a colour, a blur
 * or a shadow of its own, which is rule 1 of
 * `docs/operations/interface-material.md`.
 *
 * They live here rather than in `index.css` as `.kub-focus-ring` and friends
 * only because the stylesheet is owned elsewhere in this stage. The move is
 * mechanical whenever it is wanted: each constant is a utility list, so it can
 * become a class in `@layer components` without a single call site changing
 * shape.
 */

/**
 * FOCUS — the one language.
 *
 * The product spoke four at once: `focus:border-[--kub-cyan]` on fields,
 * `focus-visible:ring-*` and `focus:ring-*` on buttons, and a `.kub-neon-ring`
 * that was described in the stylesheet and applied nowhere. Of the 34 places
 * carrying `kub-interactive` — the class that marks a thing as pressable — not
 * one declared a focus indicator at all.
 *
 * The winner is `outline`, and the argument is already in this repository, in
 * the comment above KubButton's className (D-010): Tailwind implements `ring`
 * as a box-shadow, and `.kub-glow-cyan|pink|soft`, `.kub-panel` and every
 * `shadow-*` utility are answers to that same property. The ring was composed
 * and then overwritten — a focused button's computed style was byte-identical
 * to an unfocused one. An outline is a separate property that no box-shadow can
 * reach, it follows `border-radius`, and `outline-offset` keeps it clear of the
 * control's own edge instead of sitting on top of it.
 *
 * 2px because WCAG 2.2's focus appearance wants a perimeter no thinner than
 * that. `--kub-cyan` because fills, borders and indicator shapes keep the
 * accent — it answers the 3:1 an indicator needs, which is exactly what this
 * is.
 *
 * One trap, and it is silent: Tailwind v4's `outline-none` does not merely turn
 * an outline off, it sets `--tw-outline-style: none` on the element, and
 * `outline-2` compiles to `outline-style: var(--tw-outline-style)`. So an
 * element carrying both renders no focus indicator and no error. Wherever this
 * constant is applied, the `outline-none` / `outline-hidden` that used to sit
 * beside the old ring has to go with it.
 */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]";

/**
 * The same language on a composite field: a box with a bare input inside it,
 * where the thing a person aims at is the box and the thing that takes focus is
 * the input. Same width, same offset, same colour — only the trigger differs,
 * and it has to.
 *
 * `focus-within` rather than `focus-visible`: a text field earns its indicator
 * on a mouse click too, and the inner input keeps its own `outline-none` so the
 * box does not draw two rings.
 */
export const FOCUS_RING_WITHIN =
  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]";

/**
 * The same language where the control is flush with the edge of the surface
 * holding it — window buttons in a title bar, a rail item against a panel wall
 * — and an outward offset would be clipped by the overflow of its own parent.
 */
export const FOCUS_RING_INSET =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]";

/**
 * PRESS — for a control whose rest state is not a fill.
 *
 * Measured before this: an icon button pressed and an icon button at rest have
 * a mean-colour distance of **0.0**. The product's only press response is
 * `.kub-interactive`'s `scale(.98)`, and .98 of a transparent box is the same
 * transparent box — on a 36px control the edge moves by a third of a pixel.
 *
 * So the press becomes a step of material, the mirror of `.kub-raise-hover`,
 * using `--kub-sink-veil`. Two layers rather than one, and that is a
 * measurement rather than a flourish: in the light theme the sink and the raise
 * veils are the same value — on a light ground both "nearer" and "pressed" go
 * down towards the page — so a single sink layer would land exactly where the
 * hover already is and a hovered control would show no press at all.
 *
 * Laid as a background *image*, like its twin, so it composites over whatever
 * fill the control already has instead of replacing it, and reads the same on
 * the page, on a panel and inside a menu (rule 5).
 */
export const PRESS_SINK =
  "active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]";

/**
 * PRESS — for a control that is already one step up at rest.
 *
 * The secondary button rests on a raise veil and hovers on two, so two sink
 * layers land exactly where its hover already is in the light theme, where the
 * two veils are the same value. Photographed with the two-layer press: hover
 * Δ 17.6 from rest, press Δ 16.1 — the press was *nearer* to rest than the
 * hover, which is to say a hovered button showed nothing when pressed. Three
 * layers put it a clear step past its own hover: rest, hover and press then
 * measure 7%, 13.5% and 19.6% of veil, an even ladder in both themes.
 */
export const PRESS_SINK_RAISED =
  "active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]";

/**
 * PRESS — for a control whose rest state *is* a fill.
 *
 * The veil cannot be used here and the reason is a number: a filled button's
 * foreground colour is guaranteed against its undiluted fill and against
 * nothing else. `--kub-sink-veil` over `--kub-action-primary-background` drops
 * the label from 5.55:1 to 3.07:1 — under the floor. The material contract
 * already says the same thing from the other direction about danger fills.
 *
 * A 5% brightness step moves the fill instead of covering it, and moves it in
 * the safe direction in both themes: darker cyan against the near-black
 * foreground of the dark theme, darker cyan against the near-white foreground
 * of the light one. Measured after the step: 5.06:1 dark, and higher than rest
 * in light.
 */
export const PRESS_FILLED = "active:brightness-95";

/**
 * DISABLED — for a control that keeps its own surface.
 *
 * The product faded them: six values of `opacity` across 79 places. On a
 * translucent panel `opacity` does not dim a control, it makes it show the
 * wallpaper — and it moves the label towards the background at the same rate it
 * moves the fill, so the more disabled a thing looks the less readable it is.
 * Measured: 2.23:1 in the dark theme, 1.94:1 in the light one, against a floor
 * of 4.5.
 *
 * A disabled control still has to be read; it just must not look offered. So it
 * sinks instead of fading, and its label takes the muted tone deliberately
 * rather than by dilution.
 *
 * Two layers, and the pairing is a measurement rather than a belt-and-braces.
 * The veil alone is relative, which is right in principle and fails in the
 * light theme in practice: over the page ground it composites to rgb(218,226,234)
 * and the muted label lands at **4.46:1**, four hundredths under the floor —
 * and it cannot be fixed by sinking harder, because in the light theme the
 * label is the dark thing and every extra layer moves the ground towards it
 * (two layers measure 3.97:1). `--kub-inset`, the token whose whole job is
 * "what a well is cut into", pins the ground first; the veil then makes the
 * well *visible*, which inset alone does not do in the light theme, where it
 * sits within five values of the page. Photographed after: 7.90:1 dark and
 * 4.61:1 light on the page, 7.90:1 and 4.61:1 on a panel — the same numbers,
 * because an opaque ground is the one thing that does not move with what is
 * behind it.
 */
export const DISABLED_SINK =
  "disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed";

/**
 * DISABLED — for a control whose rest state is a fill.
 *
 * Same well, plus the halo has to go with the fill: `.kub-glow-cyan` and its
 * siblings are box-shadows that survive a background change, and a sunk control
 * still wearing an accent glow reads as offered.
 */
export const DISABLED_SINK_FILLED = `disabled:shadow-none ${DISABLED_SINK}`;

/**
 * DISABLED — for a label or a menu row: text on a surface it does not own.
 *
 * There is no box here to sink. A veil laid behind a label would draw a dark
 * patch the size of the words, which is a new shape rather than a state, so the
 * answer is the tone the product already uses for text that is present but
 * secondary. Measured on the strong glass a menu is made of: 5.92:1 dark,
 * 5.84:1 light.
 */
export const DISABLED_TEXT = "disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed";

/** The `aria-disabled` twin, for controls that stay focusable while inert. */
export const ARIA_DISABLED_SINK =
  "aria-disabled:bg-[var(--kub-inset)] aria-disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] aria-disabled:text-[color:var(--kub-muted)] aria-disabled:cursor-not-allowed";
