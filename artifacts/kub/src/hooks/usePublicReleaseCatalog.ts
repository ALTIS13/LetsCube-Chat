import { useMemo } from "react";

import { useReleaseCatalog } from "@/hooks/useReleaseCatalog";
import {
  describePublicPlatform,
  selectPublicChangelog,
  type PublicChangelogEntry,
  type PublicPlatformState,
} from "@/lib/publicReleaseModel";
import type { ReleasePlatform } from "@/lib/releaseCatalog";

/**
 * Release state for the public downloads surface.
 *
 * Only Android and Windows have a published Stable manifest. Apple platforms are
 * listed so people can see they are planned, but they carry no catalog, no
 * download control and no availability claim until their owning stream ships
 * one.
 */

export type PublicPlatformKey = "windows" | "android" | "macos" | "ios";

export const PUBLIC_PLATFORM_TITLES: Record<PublicPlatformKey, string> = {
  windows: "Windows",
  android: "Android",
  macos: "macOS",
  ios: "iPhone и iPad",
};

const UNPUBLISHED_PLATFORMS: ReleasePlatform[] = ["macos", "ios"];

export type PublicReleaseCatalog = {
  platforms: PublicPlatformState[];
  changelog: PublicChangelogEntry | null;
};

export function usePublicReleaseCatalog(): PublicReleaseCatalog {
  const windows = useReleaseCatalog("windows_download");
  const android = useReleaseCatalog("android_download");

  return useMemo(() => {
    // The hook reports `checking` while a request is in flight; a settled
    // request that produced no snapshot is a failure for a platform whose
    // manifest is supposed to exist.
    const published = [
      { key: "windows" as const, source: windows },
      { key: "android" as const, source: android },
    ].map(({ key, source }) =>
      describePublicPlatform({
        platform: key,
        title: PUBLIC_PLATFORM_TITLES[key],
        catalogPublished: true,
        loading: source.checking,
        failed: !source.checking && !source.snapshot,
        snapshot: source.snapshot,
      }),
    );

    const planned = UNPUBLISHED_PLATFORMS.map((platform) =>
      describePublicPlatform({
        platform,
        title: PUBLIC_PLATFORM_TITLES[platform as PublicPlatformKey],
        catalogPublished: false,
        loading: false,
        failed: false,
        snapshot: null,
      }),
    );

    return {
      platforms: [...published, ...planned],
      changelog: selectPublicChangelog([
        { title: PUBLIC_PLATFORM_TITLES.windows, snapshot: windows.snapshot },
        { title: PUBLIC_PLATFORM_TITLES.android, snapshot: android.snapshot },
      ]),
    };
  }, [android, windows]);
}
