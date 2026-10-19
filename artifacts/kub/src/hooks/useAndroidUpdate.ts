import { useEffect, useSyncExternalStore } from "react";
import { androidUpdateStore } from "@/lib/platform/androidUpdates";

export function useAndroidUpdate() {
  const state = useSyncExternalStore(androidUpdateStore.subscribe,
    androidUpdateStore.getSnapshot, androidUpdateStore.getServerSnapshot);
  useEffect(() => androidUpdateStore.acquire(), []);
  return { ...state, ...androidUpdateStore };
}
