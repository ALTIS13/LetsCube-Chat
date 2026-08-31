import * as Sentry from "@sentry/react";
import type { Breadcrumb, ErrorEvent as SentryErrorEvent } from "@sentry/react";
import packageJson from "../../package.json";

type MonitoringContext = Record<string, unknown>;
type MonitoringUser = { id?: string | null; email?: string | null };

const REDACTED = "[Redacted]";
const MAX_STRING_LENGTH = 300;
const MAX_ARRAY_LENGTH = 20;
const MAX_DEPTH = 5;

const SENSITIVE_KEY_RE =
  /(^|_)(access|refresh|id)?_?token$|authorization|password|secret|service_?role|api_?key|anon_?key|supabase_?key|dsn|email|media_?url|signed_?url|public_?url|message_?content|(^|_)message$|content|body|text/i;
const STORAGE_URL_RE = /https?:\/\/[^\s"']*\/storage\/v1\/[^\s"']+/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SUPABASE_KEY_RE = /\bsb_(?:publishable|secret)_[A-Za-z0-9_.-]+\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+\b/gi;
const BOT_TOKEN_RE = /\blc_bot_[0-9a-f]{10}\.[A-Za-z0-9_-]{43}\b/g;
const QUERY_SECRET_RE = /([?&](?:token|access_token|refresh_token|apikey|signature|expires|X-Amz-Signature)=)[^&#\s]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

let initialized = false;
let monitoringEnabled = false;

export function initMonitoring() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const dsn = getOptionalEnv("VITE_SENTRY_DSN");
  monitoringEnabled = Boolean(dsn);

  if (dsn) {
    Sentry.init({
      dsn,
      environment: getMonitoringEnvironment(),
      release: getMonitoringRelease(),
      tracesSampleRate: getNumberEnv("VITE_SENTRY_TRACES_SAMPLE_RATE", 0),
      defaultIntegrations: false,
      beforeSend: (event) => sanitizeSentryEvent(event),
      beforeBreadcrumb: (breadcrumb) => sanitizeMonitoringContext(breadcrumb) as Breadcrumb,
    });
  }

  window.addEventListener("error", handleWindowError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
}

export function isMonitoringEnabled() {
  return monitoringEnabled;
}

export function getBuildMetadata() {
  return {
    version: getAppVersion(),
    commit: getOptionalEnv("VITE_APP_COMMIT") || "unknown",
    environment: getMonitoringEnvironment(),
  };
}

export function reportError(error: unknown, context: MonitoringContext = {}) {
  if (!monitoringEnabled) return;

  const safeContext = sanitizeMonitoringContext({
    ...context,
    route: typeof window !== "undefined" ? window.location.pathname : undefined,
    build: getBuildMetadata(),
  });

  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(safeContext)) {
      if (isTagValue(value)) {
        scope.setTag(key, value);
      } else {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureException(toSafeError(error));
  });
}

export function reportMessage(message: string, context: MonitoringContext = {}) {
  if (!monitoringEnabled) return;
  Sentry.withScope((scope) => {
    scope.setExtras(
      sanitizeMonitoringContext({
        ...context,
        route: typeof window !== "undefined" ? window.location.pathname : undefined,
        build: getBuildMetadata(),
      }) as Record<string, unknown>,
    );
    Sentry.captureMessage(sanitizeString(message));
  });
}

export function setMonitoringUser(user: MonitoringUser | null) {
  if (!monitoringEnabled) return;
  const id = typeof user?.id === "string" && user.id ? user.id : null;
  Sentry.setUser(id ? { id } : null);
}

export function clearMonitoringUser() {
  if (!monitoringEnabled) return;
  Sentry.setUser(null);
}

export function addBreadcrumb(event: MonitoringContext) {
  if (!monitoringEnabled) return;
  Sentry.addBreadcrumb(sanitizeMonitoringContext(event) as Breadcrumb);
}

export function sanitizeMonitoringContext<T>(value: T): T {
  return sanitizeValue(value, 0, "") as T;
}

function handleWindowError(event: ErrorEvent) {
  reportError(event.error ?? event.message, {
    category: "global_error",
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
  reportError(event.reason, { category: "unhandled_rejection" });
}

function sanitizeSentryEvent(event: SentryErrorEvent): SentryErrorEvent {
  const safeEvent = sanitizeMonitoringContext(event);
  if (safeEvent.user) {
    safeEvent.user = { id: typeof safeEvent.user.id === "string" ? safeEvent.user.id : undefined };
  }
  return safeEvent;
}

function sanitizeValue(value: unknown, depth: number, key: string): unknown {
  if (SENSITIVE_KEY_RE.test(key)) return REDACTED;
  if (value == null) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: sanitizeString(value.name),
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof File) {
    return {
      name: REDACTED,
      type: sanitizeString(value.type),
      size: value.size,
    };
  }
  if (value instanceof Blob) {
    return {
      type: sanitizeString(value.type),
      size: value.size,
    };
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return "[Array]";
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, depth + 1, key));
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return "[Object]";
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      output[childKey] = sanitizeValue(childValue, depth + 1, childKey);
    }
    return output;
  }
  return String(value);
}

function sanitizeString(value: string): string {
  const sanitized = value
    .replace(STORAGE_URL_RE, "[media-url]")
    .replace(BEARER_RE, "Bearer [Redacted]")
    .replace(BOT_TOKEN_RE, "[bot-token]")
    .replace(JWT_RE, "[jwt]")
    .replace(SUPABASE_KEY_RE, "[supabase-key]")
    .replace(QUERY_SECRET_RE, "$1[Redacted]")
    .replace(EMAIL_RE, "[email]");
  return sanitized.length > MAX_STRING_LENGTH
    ? `${sanitized.slice(0, MAX_STRING_LENGTH)}…`
    : sanitized;
}

function toSafeError(error: unknown): Error {
  if (error instanceof Error) {
    const safe = new Error(sanitizeString(error.message));
    safe.name = sanitizeString(error.name);
    safe.stack = error.stack ? sanitizeString(error.stack) : undefined;
    return safe;
  }
  if (typeof error === "string") return new Error(sanitizeString(error));
  return new Error(sanitizeString(JSON.stringify(sanitizeMonitoringContext(error))));
}

function getMonitoringRelease() {
  const version = getAppVersion();
  const commit = getOptionalEnv("VITE_APP_COMMIT");
  return commit ? `kub@${version}+${commit.slice(0, 12)}` : `kub@${version}`;
}

function getAppVersion() {
  return getOptionalEnv("VITE_APP_VERSION") || packageJson.version || "0.0.0";
}

function getMonitoringEnvironment() {
  return getOptionalEnv("VITE_APP_ENV") || import.meta.env.MODE || "production";
}

function getOptionalEnv(key: string): string | null {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumberEnv(key: string, fallback: number): number {
  const value = getOptionalEnv(key);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isTagValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}
