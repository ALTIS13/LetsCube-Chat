export type DesktopRuntimeInfo = {
  platform: "windows";
  version: string;
  build: number;
};

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && window.letscubeDesktop?.platform === "windows";
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null> {
  if (!isDesktopApp()) return null;
  try {
    const value = await window.letscubeDesktop?.getRuntimeInfo();
    if (
      value?.platform !== "windows"
      || !SEMVER_PATTERN.test(value.version)
      || !Number.isSafeInteger(value.build)
      || value.build < 0
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}
