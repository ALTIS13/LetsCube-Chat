import { forwardRef, useId } from "react";
import type { IconProps } from "@phosphor-icons/react";

/** Phosphor's `PushPin`, bold. */
const PUSH_PIN_BOLD =
  "M238.15,78.54,177.46,17.86a20,20,0,0,0-28.3,0L97.2,70c-12.43-3.33-36.68-5.72-61.74,14.5a20,20,0,0,0-1.6,29.73l45.46,45.47-39.8,39.8a12,12,0,0,0,17,17l39.8-39.81,45.47,45.46A20,20,0,0,0,155.91,228c.46,0,.93,0,1.4-.05A20,20,0,0,0,171.87,220c4.69-6.23,11-16.13,14.44-28s3.45-22.88.16-33.4l51.7-51.87A20,20,0,0,0,238.15,78.54Zm-74.26,68.79a12,12,0,0,0-2.23,13.84c3.43,6.86,6.9,21-6.28,40.65L54.08,100.53c21.09-14.59,39.53-6.64,41-6a11.67,11.67,0,0,0,13.81-2.29l54.43-54.61,55,55Z";

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

/**
 * A pin beside a list: the glyph Telegram puts on the pinned bar's button that
 * opens every pinned message (`msg_pinnedlist`, tracker item 70), which
 * Phosphor does not ship. Its bold `PushPin` at 0.72, up and to the left, and
 * three lines stepping out from under its point.
 *
 * Bold only, as `HeadphonesSlash` above: the weight every `KubIcon` draws.
 */
export const PinnedList = forwardRef<SVGSVGElement, IconProps>(function PinnedList(
  { size = "1em", color = "currentColor", weight: _weight, mirrored: _mirrored, alt, children, ...rest },
  ref,
) {
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
      <path d={PUSH_PIN_BOLD} transform="translate(-6 4) scale(0.72)" />
      <g stroke={color} strokeWidth="22" strokeLinecap="round">
        <line x1="188" y1="128" x2="240" y2="128" />
        <line x1="164" y1="176" x2="240" y2="176" />
        <line x1="140" y1="224" x2="240" y2="224" />
      </g>
    </svg>
  );
});
