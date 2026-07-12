export type DistributionTarget =
  | "ios_pwa"
  | "android_download"
  | "android_native"
  | "windows_download"
  | "windows_native"
  | "web_only";

export type DistributionEnvironment = {
  native?: boolean;
  nativePlatform?: string;
  desktop?: boolean;
  desktopPlatform?: string;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
};

export function detectDistributionTarget(environment: DistributionEnvironment): DistributionTarget {
  if (environment.native && environment.nativePlatform === "android") return "android_native";
  if (environment.desktop && environment.desktopPlatform === "windows") return "windows_native";

  const userAgent = environment.userAgent ?? "";
  const platform = environment.platform ?? "";
  const maxTouchPoints = environment.maxTouchPoints ?? 0;
  const ipad = /iPad/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  if (/iPhone|iPod/i.test(userAgent) || ipad) return "ios_pwa";
  if (/Android/i.test(userAgent)) return "android_download";
  if (/Windows/i.test(userAgent) || /^Win/i.test(platform)) return "windows_download";
  return "web_only";
}

export function supportsPwaInstallForTarget(target: DistributionTarget): boolean {
  return target === "ios_pwa";
}
