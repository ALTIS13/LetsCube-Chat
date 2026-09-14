import { Capacitor } from "@capacitor/core";
import { ANDROID_PUSH_UNAVAILABLE } from "../plainMessages";
import { detectDistributionTarget, supportsPwaInstallForTarget } from "./distribution";
import { isDesktopApp } from "./desktop";

export type RuntimePlatform = "web" | "ios" | "android" | string;

export function getRuntimePlatform(): RuntimePlatform {
  try {
    return Capacitor.getPlatform() as RuntimePlatform;
  } catch {
    return "web";
  }
}

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isNativeAndroid(): boolean {
  return isNativeApp() && getRuntimePlatform() === "android";
}

export function isWebBrowser(): boolean {
  return !isNativeApp() && !isDesktopApp();
}

export function supportsCapacitorPlugin(pluginName: string): boolean {
  try {
    return Capacitor.isPluginAvailable(pluginName);
  } catch {
    return false;
  }
}

export function supportsPwaInstall(): boolean {
  return supportsPwaInstallForTarget(getCurrentDistributionTarget());
}

export function getCurrentDistributionTarget() {
  const browser = typeof navigator === "undefined" ? undefined : navigator;
  return detectDistributionTarget({
    native: isNativeApp(),
    nativePlatform: getRuntimePlatform(),
    desktop: isDesktopApp(),
    desktopPlatform: isDesktopApp() ? "windows" : undefined,
    userAgent: browser?.userAgent,
    platform: browser?.platform,
    maxTouchPoints: browser?.maxTouchPoints,
  });
}

export function supportsBrowserPush(): boolean {
  return isWebBrowser()
    && typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

export function supportsNativePush(): boolean {
  return isNativeAndroid() && supportsCapacitorPlugin("PushNotifications");
}

export function supportsNativeGeolocation(): boolean {
  return isNativeApp() && supportsCapacitorPlugin("Geolocation");
}

export function supportsMediaRecording(): boolean {
  return typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined";
}

export function supportsMediaCapture(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function microphonePermissionHelp(): string {
  if (isDesktopApp()) return "Разрешите доступ к микрофону в настройках приложения Windows.";
  return isNativeAndroid()
    ? "Разрешите доступ к микрофону в настройках приложения Android."
    : "Разрешите доступ к микрофону в настройках браузера.";
}

export function cameraPermissionHelp(): string {
  if (isDesktopApp()) return "Разрешите доступ к камере в настройках приложения Windows.";
  return isNativeAndroid()
    ? "Разрешите доступ к камере в настройках приложения Android."
    : "Разрешите доступ к камере в браузере.";
}

export function cameraAndMicPermissionHelp(): string {
  if (isDesktopApp()) return "Разрешите доступ к камере и микрофону в настройках приложения Windows.";
  return isNativeAndroid()
    ? "Разрешите доступ к камере и микрофону в настройках приложения Android."
    : "Разрешите доступ в браузере и попробуйте ещё раз.";
}

export function locationPermissionHelp(): string {
  if (isDesktopApp()) return "Разрешите доступ к геолокации в настройках приложения Windows.";
  return isNativeAndroid()
    ? "Разрешите доступ к геолокации в настройках приложения Android."
    : "Разрешите доступ к геолокации в настройках браузера.";
}

/**
 * D-132 (settings-profile F2).
 *
 * This named three build prerequisites — a local `google-services.json`, an
 * unapplied migration and «backend FCM credentials» — to every signed-in person
 * who opened the notification settings of the Android application. None of the
 * three is theirs, and the list is exactly as useful to them as the silence it
 * replaced. What it describes now goes to the log beside the call that failed.
 */
export function nativePushPendingMessage(): string {
  return ANDROID_PUSH_UNAVAILABLE;
}
