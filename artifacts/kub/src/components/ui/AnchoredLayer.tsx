"use client";

import { useLayoutEffect, useRef, useState, type HTMLAttributes, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeAnchored, placeBeside, type BoxEdges } from "@/lib/messageMenuPlacement";
import { readSafeAreaInsets } from "@/lib/safeArea";

/**
 * A surface laid out once invisibly, measured, and then placed against its
 * anchor — so its real size decides where it fits, not a guess.
 *
 * ## Why it lives here now
 *
 * It was a private function inside `MessageReactions.tsx` until 2026-09-21,
 * where it had exactly one consumer and no reason to be about reactions: the
 * comment at the top of that file explains why the reaction *surfaces* live
 * there — the material rule about a blur per message — and says nothing about
 * layout. The profile popout needs the same primitive, and this project's own
 * register has the line for what happens when a thing that should be shared
 * exists in exactly one place (D-236). So it moved, unchanged in behaviour.
 *
 * ## Two components rather than one with a mode flag
 *
 * Because the two answer different questions and hand their child a different
 * word for where they ended up. `AnchoredLayer` centres on its anchor and opens
 * above or below — right for a reaction bar over a message, a wide anchor and a
 * short popover. `BesideLayer` opens to the right and flips left — right for a
 * card opened from a face, because centring a 320-point card on a 32-point
 * avatar puts most of it over the next column. A single `mode` prop would make
 * `side` the union of both and force every consumer to narrow a case it can
 * never see.
 *
 * `lib/messageMenuPlacement.ts` carries both as arithmetic, with tests.
 *
 * ## The invisible first pass is the point, not an optimisation
 *
 * The surface is rendered with `visibility: hidden` until it has been measured,
 * because whether it fits depends on how tall it turned out to be, and that
 * depends on the person — a long bio, four badges, five shared groups. A
 * guessed height puts a card half off the screen for exactly the people who
 * have the most to show.
 */

type LayerProps<Side> = {
  anchor: BoxEdges;
  /**
   * A box the surface must not cover — read only by `BesideLayer`.
   *
   * The anchor says what the surface belongs to; this says what it would be
   * hiding. For a profile popout they are the face and the message row, and
   * keeping them apart is what stopped the card landing on the message whose
   * author had just been pressed.
   */
  avoid?: BoxEdges;
  className: string;
  children: (side: Side) => ReactNode;
  layerRef?: MutableRefObject<HTMLDivElement | null>;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">;

function PlacedLayer<Side extends string>({
  anchor,
  avoid,
  className,
  children,
  layerRef,
  place,
  fallbackSide,
  ...rest
}: LayerProps<Side> & {
  place: (input: {
    viewport: { width: number; height: number };
    safe: ReturnType<typeof readSafeAreaInsets>;
    anchor: BoxEdges;
    avoid?: BoxEdges;
    size: { width: number; height: number };
  }) => { top: number; left: number; side: Side };
  fallbackSide: Side;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number; side: Side } | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPlacement(
      place({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        safe: readSafeAreaInsets(),
        anchor,
        avoid,
        size: { width: rect.width, height: rect.height },
      }),
    );
    // `place` is rebuilt on every render of the thin wrappers below, so it is
    // deliberately not a dependency: including it would re-measure on every
    // render and the measurement itself sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, avoid]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      {...rest}
      ref={(node) => {
        ref.current = node;
        if (layerRef) layerRef.current = node;
      }}
      className={className}
      style={{
        position: "fixed",
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        visibility: placement ? "visible" : "hidden",
      }}
    >
      {children(placement?.side ?? fallbackSide)}
    </div>,
    document.body,
  );
}

/** Centred on the anchor, above or below it. */
export function AnchoredLayer({
  prefer = "below",
  ...props
}: LayerProps<"above" | "below"> & { prefer?: "above" | "below" }) {
  return (
    <PlacedLayer
      {...props}
      fallbackSide={prefer}
      place={(input) => placeAnchored({ ...input, prefer })}
    />
  );
}

/**
 * Beside the anchor's row: to its right where that fits, to its left where it
 * does not, and below or above it when neither side is free.
 */
export function BesideLayer(props: LayerProps<"right" | "left" | "below" | "above">) {
  return <PlacedLayer {...props} fallbackSide="right" place={(input) => placeBeside(input)} />;
}
