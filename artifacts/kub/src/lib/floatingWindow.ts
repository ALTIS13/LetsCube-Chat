/**
 * Geometry for a window the person drags around the page.
 *
 * Kept pure so the rules that actually bite — a window dragged off the edge and
 * never recoverable, a window stranded outside the viewport after a resize or a
 * rotation, a stored position from a much larger monitor — are decided by
 * arithmetic that can be tested, rather than by whatever the mouse happened to
 * do.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport extends Size {}

/**
 * How much of the window must stay on screen. The title bar is the handle, so
 * enough of it has to remain grabbable to drag the window back.
 */
export const MIN_VISIBLE_X = 120;
export const MIN_VISIBLE_Y = 44;

/** Below this width there is no room to float anything; the panel docks. */
export const DOCK_BREAKPOINT = 640;

export const DEFAULT_SIZE: Size = { width: 380, height: 560 };
export const MIN_SIZE: Size = { width: 320, height: 360 };

export function isDocked(viewport: Viewport): boolean {
  return viewport.width < DOCK_BREAKPOINT;
}

/**
 * Shrink the window to what the viewport can actually hold, never below the
 * minimum. A 560px-tall panel on a 500px-tall window would put its composer
 * off screen.
 */
export function fitSize(size: Size, viewport: Viewport): Size {
  return {
    width: Math.max(Math.min(size.width, viewport.width - 16), Math.min(MIN_SIZE.width, viewport.width)),
    height: Math.max(
      Math.min(size.height, viewport.height - 16),
      Math.min(MIN_SIZE.height, viewport.height),
    ),
  };
}

/**
 * Pull a position back until enough of the window is on screen.
 *
 * Both edges are constrained, so a window cannot be pushed off the left or top
 * either — dragging past the top-left corner is the usual way a floating panel
 * becomes unreachable.
 */
export function clampPosition(position: Point, size: Size, viewport: Viewport): Point {
  // A coordinate that is not a number cannot be clamped into anything — it
  // propagates through every Math call and lands as `left: NaNpx`, which the
  // browser drops, leaving the window wherever the layout puts it. Treat it as
  // "no opinion" and start from the edge.
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return defaultPosition(size, viewport);
  }
  const maxX = viewport.width - MIN_VISIBLE_X;
  const maxY = viewport.height - MIN_VISIBLE_Y;
  const minX = MIN_VISIBLE_X - size.width;
  const minY = 0;
  return {
    x: Math.round(Math.min(Math.max(position.x, minX), Math.max(maxX, minX))),
    y: Math.round(Math.min(Math.max(position.y, minY), Math.max(maxY, minY))),
  };
}

/** Bottom-right, clear of the edge — where a support panel is expected. */
export function defaultPosition(size: Size, viewport: Viewport): Point {
  const maxX = viewport.width - MIN_VISIBLE_X;
  const maxY = viewport.height - MIN_VISIBLE_Y;
  const minX = MIN_VISIBLE_X - size.width;
  return {
    x: Math.round(Math.min(Math.max(viewport.width - size.width - 24, minX), Math.max(maxX, minX))),
    y: Math.round(Math.min(Math.max(viewport.height - size.height - 24, 0), Math.max(maxY, 0))),
  };
}

export interface WindowPlacement {
  position: Point;
  size: Size;
}

/**
 * Decide where the window sits, given what was stored and the viewport it is
 * opening into. A stored placement from a wider screen is corrected rather than
 * discarded, so the person's arrangement survives moving between monitors.
 */
export function resolvePlacement(
  stored: Partial<WindowPlacement> | null,
  viewport: Viewport,
): WindowPlacement {
  const size = fitSize(
    {
      width: stored?.size?.width ?? DEFAULT_SIZE.width,
      height: stored?.size?.height ?? DEFAULT_SIZE.height,
    },
    viewport,
  );
  const position = stored?.position
    ? clampPosition(stored.position, size, viewport)
    : defaultPosition(size, viewport);
  return { position, size };
}

const STORAGE_KEY = "letscube:support-window";

/** Reading and writing the stored placement never throws: a private window, a
 *  cleared store or a browser that blocks site data must not break the panel. */
export function readStoredPlacement(): Partial<WindowPlacement> | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const position = readPoint(record.position);
    const size = readSize(record.size);
    if (!position && !size) return null;
    return { ...(position ? { position } : {}), ...(size ? { size } : {}) };
  } catch {
    return null;
  }
}

export function writeStoredPlacement(placement: WindowPlacement): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(placement));
  } catch {
    /* a placement is a convenience, never a requirement */
  }
}

function readPoint(value: unknown): Point | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const x = record.x;
  const y = record.y;
  return isFinite(x) && isFinite(y) ? { x: x as number, y: y as number } : null;
}

function readSize(value: unknown): Size | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const width = record.width;
  const height = record.height;
  return isFinite(width) && isFinite(height)
    ? { width: width as number, height: height as number }
    : null;
}

function isFinite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}
