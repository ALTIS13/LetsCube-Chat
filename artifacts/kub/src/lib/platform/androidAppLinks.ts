export const ANDROID_AUTH_CALLBACK_URL = "https://app.letscube.ru/auth/callback";
const ANDROID_AUTH_CALLBACK_ORIGIN = "https://app.letscube.ru";
const RETURN_PARAMETER_PATTERN = /^(?:return(?:to|url)?|redirect(?:to|url)?|next)$/i;
const EXTERNAL_TARGET_PATTERN = /^(?:\/\/|[a-z][a-z0-9+.-]*:)/i;

type AppLinkListenerHandle = {
  remove: () => void | Promise<void>;
};

type AndroidAppLinkApi = {
  getLaunchUrl: () => Promise<{ url?: string } | null | undefined>;
  addListener: (listener: (event: { url?: string }) => void) => Promise<AppLinkListenerHandle>;
};

export function parseAndroidAuthAppLink(value: string): string | null {
  const rawPath = getRawPath(value);
  if (rawPath !== "/auth/callback") return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "app.letscube.ru" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/auth/callback" ||
      hasUnsafeParameters(url)
    ) {
      return null;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function createAndroidAppLinkController(
  app: AndroidAppLinkApi,
  route: (path: string) => void,
) {
  let active = true;
  let started = false;
  let listener: AppLinkListenerHandle | null = null;
  const handledRoutes = new Set<string>();
  const openAuthCallback = (url?: string) => {
    if (!active || !url) return;
    const path = parseAndroidAuthAppLink(url);
    if (!path || handledRoutes.has(path)) return;
    handledRoutes.add(path);
    route(path);
  };

  return {
    start() {
      if (!active || started) return;
      started = true;
      void app.getLaunchUrl()
        .then((launch) => openAuthCallback(launch?.url))
        .catch(() => undefined);
      void app.addListener((event) => openAuthCallback(event.url))
        .then((handle) => {
          if (!active) {
            void handle.remove();
            return;
          }
          listener = handle;
        })
        .catch(() => undefined);
    },
    dispose() {
      active = false;
      void listener?.remove();
    },
  };
}

function getRawPath(value: string): string | null {
  if (!value.startsWith(ANDROID_AUTH_CALLBACK_ORIGIN)) return null;

  const suffix = value.slice(ANDROID_AUTH_CALLBACK_ORIGIN.length);
  const delimiter = suffix.search(/[?#]/);
  return delimiter < 0 ? suffix : suffix.slice(0, delimiter);
}

function hasUnsafeParameters(url: URL): boolean {
  const parameterSets = [url.searchParams, new URLSearchParams(url.hash.slice(1))];
  return parameterSets.some((parameters) => {
    for (const [key, value] of parameters) {
      if (RETURN_PARAMETER_PATTERN.test(key) || EXTERNAL_TARGET_PATTERN.test(value)) return true;
    }
    return false;
  });
}
