const CATEGORIES = new Set([
  "account",
  "access",
  "technical",
  "messages",
  "media",
  "tasks",
  "privacy",
  "other",
]);

const TICKET_KEYS = new Set([
  "fullName",
  "email",
  "phone",
  "category",
  "subject",
  "message",
  "privacyAccepted",
  "privacyVersion",
  "captchaToken",
  "website",
  "formStartedAt",
]);

export function normalizeSupportTicketRequest(body, options = {}) {
  const now = options.now ?? Date.now;
  if (!isPlainRecord(body) || hasUnexpectedKeys(body, TICKET_KEYS)) {
    return invalid();
  }

  const fullName = normalizeHumanText(body.fullName);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const subject = normalizeHumanText(body.subject);
  const message = normalizeMessage(body.message);
  const captchaToken = normalizeToken(body.captchaToken);
  const privacyVersion =
    typeof body.privacyVersion === "string" ? body.privacyVersion.trim() : "";
  const category =
    typeof body.category === "string" && CATEGORIES.has(body.category)
      ? body.category
      : null;
  const formStartedAt =
    typeof body.formStartedAt === "number" && Number.isFinite(body.formStartedAt)
      ? body.formStartedAt
      : null;

  if (
    typeof body.website !== "string" ||
    body.website.trim() ||
    !formStartedAt ||
    formStartedAt <= 0 ||
    now() - formStartedAt < 2_000 ||
    now() - formStartedAt > 24 * 60 * 60 * 1_000 ||
    fullName.length < 2 ||
    fullName.length > 80 ||
    !email ||
    !phone ||
    !category ||
    subject.length < 5 ||
    subject.length > 120 ||
    message.length < 20 ||
    message.length > 4_000 ||
    body.privacyAccepted !== true ||
    !/^\d{4}-\d{2}-\d{2}$/.test(privacyVersion) ||
    !captchaToken
  ) {
    return invalid();
  }

  return {
    ok: true,
    value: {
      fullName,
      email,
      phone,
      category,
      subject,
      message,
      privacyAccepted: true,
      privacyVersion,
      captchaToken,
      website: "",
      formStartedAt,
    },
  };
}

export function normalizeGuestMessage(body) {
  if (!isPlainRecord(body) || hasUnexpectedKeys(body, new Set(["body"]))) {
    return invalid();
  }
  const value = normalizeMessage(body.body);
  if (!value) return invalid();
  if (value.length > 4_000) {
    return { ok: false, error: "message_too_long" };
  }
  return { ok: true, value };
}

function normalizeHumanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeMessage(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizePhone(value) {
  if (typeof value !== "string") return null;
  const phone = value.trim().replace(/[\s()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

function normalizeToken(value) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return token && token.length <= 4_096 ? token : null;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasUnexpectedKeys(record, allowed) {
  return Object.keys(record).some((key) => !allowed.has(key));
}

function invalid() {
  return { ok: false, error: "invalid_request" };
}
