import { forwardRef, useId } from "react";
import type { IconProps } from "@phosphor-icons/react";

/** Phosphor's `Headphones`, bold — the weight `KubIcon` draws by default. */
const HEADPHONES_BOLD =
  "M204.73,51.85A108.07,108.07,0,0,0,20,128v56a28,28,0,0,0,28,28H64a28,28,0,0,0,28-28V144a28,28,0,0,0-28-28H44.84A84.05,84.05,0,0,1,128,44h.64a83.7,83.7,0,0,1,82.52,72H192a28,28,0,0,0-28,28v40a28,28,0,0,0,28,28h16a28,28,0,0,0,28-28V128A107.34,107.34,0,0,0,204.73,51.85ZM64,140a4,4,0,0,1,4,4v40a4,4,0,0,1-4,4H48a4,4,0,0,1-4-4V140Zm148,44a4,4,0,0,1-4,4H192a4,4,0,0,1-4-4V144a4,4,0,0,1,4-4h20Z";

/**
 * Headphones with the slash Phosphor gives its own «…Slash» glyphs.
 *
 * Discord's deafen control is a pair of headphones, crossed out while it is on
 * (tracker item 40), and Phosphor ships `Headphones` with no slashed twin. The
 * slash is `MicrophoneSlash`'s, read off its bold path: from (48, 48) to
 * (216, 224), 24 units wide with round ends, so the two controls that sit side
 * by side in the panel are crossed out the same way. The gap around it is a
 * mask rather than a stroke in the background colour, because the panel is
 * translucent and there is no one background colour to paint.
 *
 * Bold only: that is the weight every `KubIcon` draws unless told otherwise,
 * and the only one this glyph is ever asked for.
 */
export const HeadphonesSlash = forwardRef<SVGSVGElement, IconProps>(function HeadphonesSlash(
  { size = "1em", color = "currentColor", weight: _weight, mirrored: _mirrored, alt, children, ...rest },
  ref,
) {
  const mask = `kub-headphones-slash-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill={color}
      viewBox="0 0 256 256"
      {...rest}
    >
      {alt ? <title>{alt}</title> : null}
      {children}
      <mask id={mask}>
        <rect width="256" height="256" fill="white" />
        <line x1="48" y1="48" x2="216" y2="224" stroke="black" strokeWidth="64" strokeLinecap="round" />
      </mask>
      <path d={HEADPHONES_BOLD} mask={`url(#${mask})`} />
      <line x1="48" y1="48" x2="216" y2="224" stroke={color} strokeWidth="24" strokeLinecap="round" />
    </svg>
  );
});
