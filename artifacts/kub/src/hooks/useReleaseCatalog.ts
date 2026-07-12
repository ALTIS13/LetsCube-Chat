import { App } from "@capacitor/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createReleaseCatalogClient,
  getInstalledReleaseState,
  type InstalledReleaseInfo,
  type ReleaseCatalogSnapshot,
  type ReleasePlatform,
} from "@/lib/releaseCatalog";
import type { DistributionTarget } from "@/lib/platform/distribution";
import { reportError } from "@/lib/monitoring";

export type ReleaseCatalogUiState =
  | "checking"
  | "preparing"
  | "available"
  | "current"
  | "update_available"
  | "offline_cached"
  | "unavailable";

const releaseClient = createReleaseCatalogClient();

export function useReleaseCatalog(target: DistributionTarget) {
  const platform = getReleasePlatform(target);
  const [snapshot, setSnapshot] = useState<ReleaseCatalogSnapshot | null>(null);
  const [checking, setChecking] = useState(Boolean(platform));
  const [failed, setFailed] = useState(false);
  const [installedRelease, setInstalledRelease] = useState<InstalledReleaseInfo | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback((force = false) => {
    if (!platform) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    setChecking(true);
    const operation = releaseClient.load(platform, "stable", { force })
      .then((next) => {
        setSnapshot(next);
        setFailed(false);
      })
      .catch((error) => {
        setFailed(true);
        reportError(error, { category: "release_catalog", platform });
      })
      .finally(() => {
        setChecking(false);
        inFlight.current = null;
      });
    inFlight.current = operation;
    return operation;
  }, [platform]);

  useEffect(() => {
    setSnapshot(null);
    setFailed(false);
    setChecking(Boolean(platform));
    if (!platform) return;
    void refresh(false);
  }, [platform, refresh]);

  useEffect(() => {
    if (target !== "android_native") {
      setInstalledRelease(null);
      return;
    }
    let active = true;
    void App.getInfo()
      .then((info) => {
        if (active) {
          const build = Number(info.build);
          setInstalledRelease({
            version: info.version,
            build: Number.isSafeInteger(build) && build >= 0 ? build : 0,
          });
        }
      })
      .catch((error) => reportError(error, { category: "native_app_version" }));
    return () => { active = false; };
  }, [target]);

  useEffect(() => {
    if (!platform || typeof window === "undefined") return;
    const handleResume = () => void refresh(true);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    window.addEventListener("online", handleResume);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleResume);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [platform, refresh]);

  const state = useMemo<ReleaseCatalogUiState>(() => {
    if (checking && !snapshot) return "checking";
    if (!snapshot) return failed ? "unavailable" : "checking";
    if (snapshot.stale) return "offline_cached";
    if (!snapshot.manifest.available) return "preparing";
    if (!installedRelease) return "available";
    return getInstalledReleaseState(snapshot.manifest, installedRelease);
  }, [checking, failed, installedRelease, snapshot]);

  return {
    platform,
    state,
    checking,
    snapshot,
    installedRelease,
    refresh: () => refresh(true),
  };
}

function getReleasePlatform(target: DistributionTarget): ReleasePlatform | null {
  if (target === "android_download" || target === "android_native") return "android";
  if (target === "windows_download") return "windows";
  return null;
}
