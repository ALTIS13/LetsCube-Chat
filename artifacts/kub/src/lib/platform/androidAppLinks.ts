export const ANDROID_AUTH_CALLBACK_URL = "https://app.letscube.ru/auth/callback";

export function parseAndroidAuthAppLink(value: string): string | null {
  if (!value.startsWith(ANDROID_AUTH_CALLBACK_URL)) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "app.letscube.ru" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/auth/callback"
    ) {
      return null;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
