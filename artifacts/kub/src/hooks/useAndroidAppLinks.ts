import { App } from "@capacitor/app";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { parseAndroidAuthAppLink } from "@/lib/platform/androidAppLinks";
import { isNativeAndroid } from "@/lib/platform/capabilities";

export function useAndroidAppLinks(): void {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isNativeAndroid()) return;

    let active = true;
    let listener: Awaited<ReturnType<typeof App.addListener>> | null = null;
    const openAuthCallback = (url?: string) => {
      if (!active || !url) return;
      const route = parseAndroidAuthAppLink(url);
      if (route) setLocation(route, { replace: true });
    };

    void App.getLaunchUrl()
      .then((launch) => openAuthCallback(launch?.url))
      .catch(() => undefined);
    void App.addListener("appUrlOpen", (event) => openAuthCallback(event.url))
      .then((handle) => {
        if (!active) {
          void handle.remove();
          return;
        }
        listener = handle;
      })
      .catch(() => undefined);

    return () => {
      active = false;
      void listener?.remove();
    };
  }, [setLocation]);
}
