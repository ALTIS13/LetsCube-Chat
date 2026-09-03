import { useEffect, useMemo, useSyncExternalStore } from "react";
import { reportError } from "@/lib/monitoring";
import { isDesktopApp } from "@/lib/platform/desktop";
import {
  clearDesktopCache,
  createDesktopStorageStore,
  getCacheLimitOptions,
  readDesktopStorageState,
  setDesktopCacheLimit,
  setDesktopStorageLocation,
} from "@/lib/platform/desktopStorage";

const desktopStorageStore = createDesktopStorageStore({
  isActive: isDesktopApp,
  read: readDesktopStorageState,
  setLocation: setDesktopStorageLocation,
  setCacheLimit: setDesktopCacheLimit,
  clearCache: clearDesktopCache,
  reportError: (error, operation) => {
    reportError(error, { category: "desktop_storage", operation });
  },
});

export function useDesktopStorage() {
  const store = useSyncExternalStore(
    desktopStorageStore.subscribe,
    desktopStorageStore.getSnapshot,
    desktopStorageStore.getServerSnapshot,
  );

  useEffect(() => desktopStorageStore.acquire(), []);

  const cacheLimitOptions = useMemo(
    () => store.state ? getCacheLimitOptions(store.state) : [],
    [store.state],
  );

  if (!isDesktopApp()) return null;
  return {
    state: store.state,
    errorMessage: store.errorMessage,
    commandPending: store.commandPending,
    cacheLimitOptions,
    refresh: desktopStorageStore.refresh,
    setLocation: desktopStorageStore.setLocation,
    setCacheLimit: desktopStorageStore.setCacheLimit,
    clearCache: desktopStorageStore.clearCache,
    dismissError: desktopStorageStore.dismissError,
  };
}
