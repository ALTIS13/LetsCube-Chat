import { cn } from "@/lib/utils";

/**
 * The panel material, painted as a layer *behind* a panel instead of on it.
 *
 * `backdrop-filter` makes its element a containing block for `position: fixed`
 * descendants. So a panel that also hosts an overlay — a dialog, a menu, a
 * click-away backdrop — cannot wear the material itself. Measured: with
 * `kub-glass` on the sidebar's root, the settings dialog opened from that
 * sidebar was laid out against the 400px column rather than the viewport, scrim
 * included, and the chat pane beside it stayed undimmed.
 *
 * The layer is a leaf, so the filter has no descendants to trap. It is
 * deliberately positioned rather than given a negative z-index: `-z-10` would
 * need the host to be a stacking context, and making these particular hosts
 * stacking contexts is the same bug in a different place — a viewport-covering
 * dialog inside the composer would then be clamped to the composer and paint
 * under the sidebar. Instead the host stays a plain `relative` box, this layer
 * comes first, and the panel's own content follows it as a positioned sibling;
 * two positioned boxes with `z-index: auto` paint in tree order, so the content
 * lands on top and no stacking context is created anywhere.
 *
 * Panels with nothing fixed inside them do not need this — they keep
 * `kub-glass` on the element itself, which is one less box.
 */
export function KubGlassLayer({
  strong = false,
  className,
}: {
  /** For a surface that covers content it is not part of. */
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-kub-glass-layer={strong ? "strong" : "panel"}
      className={cn(
        "pointer-events-none absolute inset-0",
        strong ? "kub-glass-strong" : "kub-glass",
        className,
      )}
    />
  );
}
