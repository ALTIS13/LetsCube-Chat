/**
 * What a frame or a background actually looks like.
 *
 * The database owns identity and entitlement — which decorations exist, what
 * each one takes, and who is allowed to wear it. This file owns the appearance,
 * keyed by the same id. The split matters in both directions: a decoration this
 * build has never heard of renders plain instead of breaking, and a decoration
 * described here that the server has not unlocked is refused on write, so the
 * appearance can be iterated on without ever becoming the authority on who
 * earned what.
 *
 * Every value here is a token or a colour that works in both themes. A frame is
 * drawn as a ring outside the avatar rather than a border on it, so it never
 * shrinks the picture or shifts the layout it sits in.
 */

export interface FrameStyle {
  /** Painted into the ring around the avatar. */
  ring: string;
  /** Optional glow, kept subtle enough to survive a light background. */
  glow?: string;
}

export interface BackgroundStyle {
  /** Painted behind the profile card. */
  surface: string;
  /** Ink that stays legible on it, when the default would not. */
  ink?: string;
}

const FRAMES: Record<string, FrameStyle> = {
  frame_tester: {
    // The one the owner asked for by name: unmistakable, but not loud enough
    // to fight the avatar it surrounds.
    ring: "conic-gradient(from 210deg, #22D3EE, #A855F7, #F472B6, #22D3EE)",
    glow: "0 0 0 1px color-mix(in srgb, #A855F7 45%, transparent)",
  },
  frame_alpha: {
    // Alpha: the shortest period and the hardest to earn, so it reads as metal
    // rather than as another colour.
    ring: "conic-gradient(from 250deg, #F43F5E, #FB923C, #F43F5E, #BE123C)",
    glow: "0 0 0 1px color-mix(in srgb, #F43F5E 45%, transparent)",
  },
  frame_beta: {
    // Beta: everyone who was here before 1.0.
    ring: "conic-gradient(from 140deg, #F59E0B, #FDE68A, #F59E0B)",
    glow: "0 0 0 1px color-mix(in srgb, #F59E0B 40%, transparent)",
  },
  frame_veteran: {
    ring: "conic-gradient(from 90deg, #94A3B8, #E2E8F0, #94A3B8, #64748B)",
    glow: "0 0 0 1px color-mix(in srgb, #64748B 40%, transparent)",
  },
  frame_talker: {
    ring: "conic-gradient(from 30deg, #34D399, #22D3EE, #34D399)",
    glow: "0 0 0 1px color-mix(in srgb, #10B981 40%, transparent)",
  },
};

const BACKGROUNDS: Record<string, BackgroundStyle> = {
  bg_aurora: {
    surface:
      "radial-gradient(120% 90% at 12% 0%, color-mix(in srgb, #22D3EE 26%, transparent), transparent 60%), radial-gradient(120% 90% at 95% 10%, color-mix(in srgb, #A855F7 24%, transparent), transparent 62%)",
  },
  bg_circuit: {
    surface:
      "linear-gradient(135deg, color-mix(in srgb, #34D399 16%, transparent), transparent 55%), repeating-linear-gradient(45deg, color-mix(in srgb, #10B981 9%, transparent) 0 2px, transparent 2px 14px)",
  },
  bg_prism: {
    surface:
      "linear-gradient(115deg, color-mix(in srgb, #F472B6 22%, transparent), color-mix(in srgb, #22D3EE 22%, transparent) 55%, color-mix(in srgb, #A855F7 22%, transparent))",
  },
};

export function frameStyle(key: string | null | undefined): FrameStyle | null {
  if (!key) return null;
  return FRAMES[key] ?? null;
}

export function backgroundStyle(key: string | null | undefined): BackgroundStyle | null {
  if (!key) return null;
  return BACKGROUNDS[key] ?? null;
}

/** Ids this build can draw. Used to hide a catalogue row it cannot render. */
export function renderableCosmeticKeys(): string[] {
  return [...Object.keys(FRAMES), ...Object.keys(BACKGROUNDS)];
}

export function canRenderCosmetic(key: string): boolean {
  return key in FRAMES || key in BACKGROUNDS;
}

/**
 * How thick the ring is at each avatar size.
 *
 * A fixed thickness reads as a hairline on a 80px avatar and swallows a 32px
 * one, so it scales — but never below 2px, which is the point at which a
 * gradient stops being a gradient.
 */
export const FRAME_RING_WIDTH: Record<"sm" | "md" | "lg" | "xl", number> = {
  sm: 2,
  md: 2,
  lg: 3,
  xl: 3,
};
