import { Capacitor } from "@capacitor/core";

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
  return !isNativeApp();
}

export function supportsCapacitorPlugin(pluginName: string): boolean {
  try {
    return Capacitor.isPluginAvailable(pluginName);
  } catch {
    return false;
  }
}

export function supportsPwaInstall(): boolean {
  return isWebBrowser() && typeof window !== "undefined";
}

export function supportsBrowserPush(): boolean {
  return isWebBrowser()
    && typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

export function supportsNativePush(): boolean {
  return false;
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
  return isNativeAndroid()
    ? "Разрешите доступ к микрофону в настройках приложения Android."
    : "Разрешите доступ к микрофону в настройках браузера.";
}

export function cameraPermissionHelp(): string {
  return isNativeAndroid()
    ? "Разрешите доступ к камере в настройках приложения Android."
    : "Разрешите доступ к камере в браузере.";
}

export function cameraAndMicPermissionHelp(): string {
  return isNativeAndroid()
    ? "Разрешите доступ к камере и микрофону в настройках приложения Android."
    : "Разрешите доступ в браузере и попробуйте ещё раз.";
}

export function locationPermissionHelp(): string {
  return isNativeAndroid()
    ? "Разрешите доступ к геолокации в настройках приложения Android."
    : "Разрешите доступ к геолокации в настройках браузера.";
}

export function nativePushPendingMessage(): string {
  return "Уведомления в Android-приложении будут подключены через native push на следующем этапе.";
}
