import { Geolocation } from "@capacitor/geolocation";
import { isNativeAndroid, isNativeApp, locationPermissionHelp, supportsNativeGeolocation } from "./capabilities";

export type MessengerPosition = {
  latitude: number;
  longitude: number;
};

export type MessengerLocationErrorCode =
  | "permission_denied"
  | "services_disabled"
  | "timeout"
  | "unsupported"
  | "unknown";

export class MessengerLocationError extends Error {
  code: MessengerLocationErrorCode;

  constructor(code: MessengerLocationErrorCode) {
    super(code);
    this.name = "MessengerLocationError";
    this.code = code;
  }
}

export async function getMessengerPosition(): Promise<MessengerPosition> {
  if (isNativeApp()) return getNativePosition();
  return getWebPosition();
}

export function getMessengerLocationErrorMessage(error: unknown): string {
  const code = error instanceof MessengerLocationError ? error.code : "unknown";

  if (code === "permission_denied") return locationPermissionHelp();
  if (code === "unsupported") return "Геолокация недоступна на этом устройстве.";
  if (code === "timeout") return "Не удалось определить местоположение: устройство не ответило вовремя.";
  if (code === "services_disabled") {
    return isNativeAndroid()
      ? "Не удалось определить местоположение. Проверьте, что геолокация включена на устройстве."
      : "Не удалось определить местоположение. Проверьте настройки геолокации.";
  }
  return "Не удалось определить местоположение. Попробуйте ещё раз.";
}

async function getNativePosition(): Promise<MessengerPosition> {
  if (!supportsNativeGeolocation()) {
    throw new MessengerLocationError("unsupported");
  }

  try {
    const current = await Geolocation.checkPermissions();
    if (!hasGrantedLocation(current)) {
      const requested = await Geolocation.requestPermissions();
      if (!hasGrantedLocation(requested)) {
        throw new MessengerLocationError("permission_denied");
      }
    }

    const result = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 5_000,
    });

    return {
      latitude: result.coords.latitude,
      longitude: result.coords.longitude,
    };
  } catch (error) {
    if (error instanceof MessengerLocationError) throw error;
    const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
    if (message.includes("denied") || message.includes("permission")) {
      throw new MessengerLocationError("permission_denied");
    }
    if (message.includes("timeout")) {
      throw new MessengerLocationError("timeout");
    }
    if (message.includes("disabled") || message.includes("location unavailable")) {
      throw new MessengerLocationError("services_disabled");
    }
    throw new MessengerLocationError("unknown");
  }
}

async function getWebPosition(): Promise<MessengerPosition> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new MessengerLocationError("unsupported");
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new MessengerLocationError("permission_denied"));
          return;
        }
        if (error.code === error.TIMEOUT) {
          reject(new MessengerLocationError("timeout"));
          return;
        }
        reject(new MessengerLocationError("services_disabled"));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
    );
  });
}

function hasGrantedLocation(status: { location?: string; coarseLocation?: string }): boolean {
  return status.location === "granted" || status.coarseLocation === "granted";
}
