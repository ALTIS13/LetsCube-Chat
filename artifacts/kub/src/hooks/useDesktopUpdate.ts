import { useEffect, useMemo, useSyncExternalStore } from "react";
import { reportError } from "@/lib/monitoring";
import { getDesktopBridge, isDesktopApp } from "@/lib/platform/desktop";
import {
  checkDesktopUpdate,
  createDesktopUpdateStore,
  getDesktopUpdatePresentation,
  installDesktopUpdate,
  readDesktopUpdateSnapshot,
  setDesktopUpdateChannel,
} from "@/lib/platform/desktopUpdates";

const desktopUpdateStore = createDesktopUpdateStore({
  isActive: isDesktopApp,
  installedVersion: () => getDesktopBridge()?.version,
  read: readDesktopUpdateSnapshot,
  check: checkDesktopUpdate,
  install: installDesktopUpdate,
  setChannel: setDesktopUpdateChannel,
  reportError: (error, operation) => {
    reportError(error, { category: "desktop_update", operation });
  },
});

export function useDesktopUpdate() {
  const store = useSyncExternalStore(
    desktopUpdateStore.subscribe,
    desktopUpdateStore.getSnapshot,
    desktopUpdateStore.getServerSnapshot,
  );

  useEffect(() => desktopUpdateStore.acquire(), []);

  const presentation = useMemo(
    () => store.snapshot ? getDesktopUpdatePresentation(store.snapshot) : null,
    [store.snapshot],
  );

  if (!isDesktopApp()) return null;
  return {
    snapshot: store.snapshot,
    presentation,
    commandPending: store.commandPending,
    check: desktopUpdateStore.check,
    install: desktopUpdateStore.install,
    setChannel: desktopUpdateStore.setChannel,
  };
}
