import type { SafeWebPushPayload } from "./webpush.ts";

const WINDOWS_NOTIFICATION_SCHEME = "letscube-notification";

export function buildWnsToast(payload: SafeWebPushPayload): string {
  const route = safeRelativeRoute(payload.url);
  const activation = `${WINDOWS_NOTIFICATION_SCHEME}://open?route=${encodeURIComponent(route)}`;
  const title = safeText(payload.title, "LETSCUBE", 80);
  const body = safeText(payload.body, "Новое уведомление", 180);
  const isMessage = payload.kind.toLowerCase().includes("message");
  const header = isMessage
    ? `<header id="${escapeXml(safeText(payload.tag, "message", 64))}" title="${escapeXml(title)}" arguments="${escapeXml(activation)}" activationType="protocol"/>`
    : "";
  const content = isMessage
    ? `<text>${escapeXml(body)}</text>`
    : `<text>${escapeXml(title)}</text><text>${escapeXml(body)}</text>`;
  const avatarUrl = safeTrustedAvatarUrl(payload.senderAvatarUrl);
  const image = isMessage && avatarUrl
    ? `<image placement="appLogoOverride" hint-crop="circle" src="${escapeXml(avatarUrl)}"/>`
    : "";

  return `<toast duration="short" activationType="protocol" launch="${escapeXml(activation)}">${header}<visual><binding template="ToastGeneric">${image}${content}</binding></visual></toast>`;
}

export function isAllowedWnsChannelUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (hostname === "notify.windows.com" ||
        hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}

export function isPermanentWnsChannelError(
  status: number,
  _reason: string,
): boolean {
  return status === 404 || status === 410;
}

export function readWnsResponseStatus(response: Response): string {
  const deliveryStatus =
    safeStatusToken(response.headers.get("x-wns-status")) || "unknown";
  const description =
    response.headers.get("x-wns-error-description")?.toLowerCase() ?? "";
  const reason = description.includes("expir")
    ? "channel_expired"
    : description.includes("not found")
      ? "channel_not_found"
      : description.includes("thrott")
        ? "throttled"
        : response.status === 401
          ? "token_expired"
          : `http_${response.status}`;
  return `${deliveryStatus}:${reason}`;
}

function safeRelativeRoute(value: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    looksSensitive(value)
  ) {
    return "/";
  }
  try {
    const parsed = new URL(value, "https://app.letscube.ru");
    if (parsed.origin !== "https://app.letscube.ru") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function safeText(value: string, fallback: string, maxLength: number): string {
  const text = value.trim();
  if (!text || looksSensitive(text)) return fallback;
  return text.slice(0, maxLength);
}

function safeTrustedAvatarUrl(value: string): string | null {
  if (!value || value.length > 2048 || looksSensitive(value)) return null;
  try {
    const url = new URL(value, "https://app.letscube.ru");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      (url.origin !== "https://app.letscube.ru" && url.origin !== "https://api.letscube.ru")
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function safeStatusToken(value: string | null): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  return normalized.slice(0, 40) || null;
}

function looksSensitive(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("/storage/v1/") ||
    lower.includes("/object/sign/") ||
    lower.includes("token=") ||
    lower.includes("password=") ||
    lower.includes("authorization=") ||
    lower.includes("signedurl") ||
    lower.includes("signed_url")
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
