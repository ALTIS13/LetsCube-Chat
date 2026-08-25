import { App } from "@capacitor/app";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { createAndroidAppLinkController } from "@/lib/platform/androidAppLinks";
import { isNativeAndroid } from "@/lib/platform/capabilities";

export function useAndroidAppLinks(): void {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isNativeAndroid()) return;

    const controller = createAndroidAppLinkController({
      getLaunchUrl: () => App.getLaunchUrl(),
      addListener: (listener) => App.addListener("appUrlOpen", listener),
    }, (route) => setLocation(route, { replace: true }));
    controller.start();
    return controller.dispose;
  }, [setLocation]);
}
