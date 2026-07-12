export const PRODUCTION_APP_ORIGIN = "https://app.letscube.ru";

const ALLOWED_PERMISSIONS = new Set([
  "clipboard-sanitized-write",
  "fullscreen",
  "geolocation",
  "media",
  "notifications",
]);
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const ALLOWED_MEDIA_TYPES = new Set(["audio", "video"]);

export function isAllowedNavigationUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  return Boolean(url && url.origin === PRODUCTION_APP_ORIGIN && !url.username && !url.password);
}

export function isAllowedExternalUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  return Boolean(
    url
    && ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)
    && !url.username
    && !url.password
  );
}

export function isAllowedPermission(rawUrl, permission, details = {}) {
  if (!isAllowedNavigationUrl(rawUrl) || !ALLOWED_PERMISSIONS.has(permission)) return false;
  if (details.isMainFrame !== true) return false;
  if (permission !== "media") return true;

  const mediaTypes = details.mediaTypes
    ?? (details.mediaType ? [details.mediaType] : []);
  return mediaTypes.length === 0 || mediaTypes.every((type) => ALLOWED_MEDIA_TYPES.has(type));
}

function parseUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}
