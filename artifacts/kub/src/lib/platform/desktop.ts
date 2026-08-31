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
