export type DesktopRuntimeInfo = {
  platform: "windows";
  version: string;
  build: number;
};

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && Boolean(window.letscubeDesktop);
}

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && window.letscubeDesktop?.platform === "windows";
}

export function getDesktopBridge(): NonNullable<Window["letscubeDesktop"]> | null {
  return isDesktopApp() ? window.letscubeDesktop ?? null : null;
}

/**
 * Marks the document as the Windows shell, which is how CSS learns that the
 * top of the window belongs to the window's own buttons.
 *
 * The Tauri window has `decorations: false`, so the application draws its own
 * minimise, maximise and close — `DesktopWindowChrome`, a 2rem strip pinned
 * over the top right. `--kub-window-caption` in `index.css` is that strip's
 * height under this attribute and `0px` without it, and every surface that is
 * the top of the window pads it out of itself through `pt-window-top`.
 *
 * Set at boot rather than from an effect: an effect runs after the first paint,
 * and one frame of the chat header's capsules sitting under the window buttons
 * is exactly the defect the reservation exists to prevent. The bridge is
 * injected by Tauri before the page's modules run, which is the same guarantee
 * `DesktopWindowChrome` already relies on to decide whether to render at all.
 */
export const DESKTOP_SHELL_ATTRIBUTE = "data-desktop-shell";

export function applyDesktopShellAttribute(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (isDesktopApp()) root.setAttribute(DESKTOP_SHELL_ATTRIBUTE, "windows");
  else root.removeAttribute(DESKTOP_SHELL_ATTRIBUTE);
}

function parseDesktopRuntimeInfo(value: unknown): DesktopRuntimeInfo | null {
  const candidate = value as Partial<DesktopRuntimeInfo> | null | undefined;
  const version = candidate?.version;
  const build = candidate?.build;
  if (
    candidate?.platform !== "windows"
    || typeof version !== "string"
    || !SEMVER_PATTERN.test(version)
    || typeof build !== "number"
    || !Number.isSafeInteger(build)
    || build < 0
  ) {
    return null;
  }
  return {
    platform: candidate.platform,
    version,
    build,
  };
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null> {
  if (!isDesktopApp()) return null;
  try {
    return parseDesktopRuntimeInfo(await window.letscubeDesktop?.getRuntimeInfo());
  } catch {
    return null;
  }
}
