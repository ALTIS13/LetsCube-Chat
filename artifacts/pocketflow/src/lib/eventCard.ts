import { asCode, clampMessage, untrusted } from "#pf/lib/render";

/**
 * An arbitrary webhook body, rendered as something a person can read (§5).
 *
 * The brief is explicit that this must not become five integrations, so
 * nothing here knows what GitHub or Grafana or Uptime Kuma is. What it knows
 * is that notification payloads, whoever wrote them, almost always carry four
 * things under a handful of names: something that reads as a title, something
 * that reads as a status, something that reads as a sentence, and a link. The
 * scan below looks for those four roles anywhere in the object, breadth first
 * so a shallow field beats a deep one, and everything it does not recognise
 * falls back to a bounded pretty-print.
 *
 * **The body is untrusted text, and this is the file where that bites.** The
 * LETSCUBE client formats every message it renders and there is no
 * `parse_mode` to turn it off (gap G-5), so a payload field containing `*`
 * does not merely mangle itself — it italicises the rest of the line, which
 * may be a different field, and a SHA-256 with two characters eaten still
 * looks like a SHA-256. Every value that came from the payload therefore goes
 * through `untrusted()` from `lib/render.ts`, which contains it in a backtick
 * span when it has to. The labels («Статус») are ours and are left alone.
 *
 * Two smaller rules, both of which exist because the payload is untrusted:
 *
 *   - control characters and bidi overrides are stripped before rendering. A
 *     U+202E in an alert title reverses the text after it, which is a cheap
 *     way to make a card say something it does not say, and no amount of
 *     backtick-wrapping helps because the override applies inside a code span
 *     too;
 *   - a field whose *name* looks like a credential is never rendered. A
 *     payload that carries `{"api_key": "..."}` must not put it into a chat,
 *     where it would then be in somebody's message history for good.
 */

export type EventField = { key: string; value: string };

export type EventFields = {
  title: string | null;
  status: string | null;
  message: string | null;
  url: string | null;
  details: EventField[];
  /** False when nothing was recognised, which is what selects the pretty-print. */
  recognised: boolean;
};

type Scalar = string | number | boolean;

const MAX_DEPTH = 4;
const NODE_BUDGET = 300;
const MAX_ARRAY_ITEMS = 5;

const MAX_TITLE = 200;
const MAX_STATUS = 60;
const MAX_MESSAGE = 800;
const MAX_MESSAGE_LINES = 12;
const MAX_URL = 500;
const MAX_DETAILS = 6;
const MAX_DETAIL_KEY = 40;
const MAX_DETAIL_VALUE = 120;
const MAX_FALLBACK_JSON = 1500;

/**
 * Role names, most specific first — the rank breaks a tie between two fields
 * at the same depth, so `{name, title}` reports the title.
 */
const TITLE_KEYS = [
  "title",
  "subject",
  "headline",
  "summary",
  "alertname",
  "eventname",
  "event",
  "alert",
  "monitorname",
  "checkname",
  "check",
  "name",
];

const STATUS_KEYS = [
  "status",
  "state",
  "severity",
  "level",
  "conclusion",
  "outcome",
  "result",
  "health",
  "action",
];

const MESSAGE_KEYS = [
  "message",
  "msg",
  "description",
  "reason",
  "detail",
  "details",
  "error",
  "text",
  "body",
  "content",
];

const URL_KEYS = [
  "url",
  "htmlurl",
  "ruleurl",
  "dashboardurl",
  "monitorurl",
  "permalink",
  "weburl",
  "link",
  "href",
];

/**
 * A field name that must never reach a chat.
 *
 * Substring matching on the normalised key, so `X-Api-Key`, `github_token` and
 * `refreshToken` are all caught by one entry each.
 */
const CREDENTIAL_KEY_PARTS = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "authorization",
  "credential",
  "signature",
  "privatekey",
  "cookie",
  "bearer",
  "session",
];

/** Lowercased with separators removed, so `html_url` and `htmlUrl` are one name. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_\-.]/g, "");
}

function looksLikeCredential(key: string): boolean {
  const normalized = normalizeKey(key);
  return CREDENTIAL_KEY_PARTS.some((part) => normalized.includes(part));
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * C0 controls, DEL, zero-width characters and the bidi overrides.
 *
 * `\n` is kept and handled by the caller — it is the one control character
 * that means something here.
 */
const UNSAFE_CHARACTERS =
  /[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function cleanScalar(value: Scalar, options: { multiline: boolean; limit: number }): string {
  let text = typeof value === "string" ? value : String(value);
  text = text.replace(UNSAFE_CHARACTERS, " ");
  if (options.multiline) {
    text = text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .slice(0, MAX_MESSAGE_LINES)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    text = text.replace(/\s+/g, " ").trim();
  }
  if (text.length > options.limit) text = `${text.slice(0, options.limit).trimEnd()}…`;
  return text;
}

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

type Candidate = { value: string; depth: number; rank: number };

function better(next: Candidate, current: Candidate | null): boolean {
  if (current === null) return true;
  if (next.depth !== current.depth) return next.depth < current.depth;
  return next.rank < current.rank;
}

type Role = "title" | "status" | "message" | "url";

/**
 * The four roles, in the order a field is offered to them.
 *
 * `url` goes first because a field named `link` is a link whatever else it
 * could be read as; `message` goes last because it is the widest net.
 */
const ROLE_SPECS: {
  role: Role;
  keys: readonly string[];
  multiline: boolean;
  limit: number;
  accept?: (value: string) => boolean;
}[] = [
  { role: "url", keys: URL_KEYS, multiline: false, limit: MAX_URL, accept: isHttpUrl },
  { role: "title", keys: TITLE_KEYS, multiline: false, limit: MAX_TITLE },
  {
    role: "status",
    keys: STATUS_KEYS,
    multiline: false,
    limit: MAX_STATUS,
    // `cleanScalar` marks a value it had to cut with an ellipsis, which leaves
    // it one character past the limit — so «did it fit» and «was it short
    // enough to be a status» are the same question.
    accept: (value) => value.length <= MAX_STATUS,
  },
  { role: "message", keys: MESSAGE_KEYS, multiline: true, limit: MAX_MESSAGE },
];

/**
 * Every scalar in the body, shallowest first, with a hard budget.
 *
 * Bounded twice on purpose: a 2 MB payload is 2 MB of somebody else's data
 * structure, and neither its depth nor its width is ours to trust. Values are
 * only read — nothing is ever assigned into an object built from this walk —
 * so a payload carrying `__proto__` is data like any other key.
 */
function walkScalars(
  body: unknown,
  visit: (path: string, key: string, value: Scalar, depth: number) => void,
): void {
  const queue: { node: unknown; path: string; depth: number }[] = [
    { node: body, path: "", depth: 0 },
  ];
  let budget = NODE_BUDGET;
  while (queue.length > 0 && budget > 0) {
    const head = queue.shift();
    if (!head) break;
    if (head.depth > MAX_DEPTH) continue;
    const entries: [string, unknown][] = Array.isArray(head.node)
      ? head.node
          .slice(0, MAX_ARRAY_ITEMS)
          .map((entry, index) => [String(index), entry] as [string, unknown])
      : head.node !== null && typeof head.node === "object"
        ? Object.entries(head.node as Record<string, unknown>)
        : [];
    for (const [key, value] of entries) {
      budget -= 1;
      if (budget <= 0) break;
      const path = head.path === "" ? key : `${head.path}.${key}`;
      if (isScalar(value)) {
        visit(path, key, value, head.depth);
      } else if (value !== null && typeof value === "object") {
        queue.push({ node: value, path, depth: head.depth + 1 });
      }
    }
  }
}

/**
 * The four roles plus whatever else is worth showing.
 *
 * Exported because this is the part with a real opinion in it, and an opinion
 * that is not pinned by a test is a guess.
 */
export function extractEventFields(body: unknown): EventFields {
  if (typeof body === "string") {
    const message = cleanScalar(body, { multiline: true, limit: MAX_MESSAGE });
    return {
      title: null,
      status: null,
      message: message.length > 0 ? message : null,
      url: null,
      details: [],
      recognised: message.length > 0,
    };
  }

  const roles = new Map<Role, Candidate>();
  const claimed = new Set<string>();
  const details: { path: string; key: string; value: string; depth: number }[] = [];

  walkScalars(body, (path, key, value, depth) => {
    if (looksLikeCredential(key)) return;
    const normalized = normalizeKey(key);

    for (const spec of ROLE_SPECS) {
      const rank = spec.keys.indexOf(normalized);
      if (rank < 0) continue;
      const candidate = cleanScalar(value, { multiline: spec.multiline, limit: spec.limit });
      if (candidate.length === 0) continue;
      // A «state» of 500 characters is prose, not a status, and a `url` that is
      // not an http URL is not a link. A field that fails its role's own test
      // falls through to the next role and then to the details, rather than
      // being shown as something it is not.
      if (spec.accept && !spec.accept(candidate)) continue;
      if (!better({ value: candidate, depth, rank }, roles.get(spec.role) ?? null)) continue;
      roles.set(spec.role, { value: candidate, depth, rank });
      claimed.add(path);
      return;
    }

    const detail = cleanScalar(value, { multiline: false, limit: MAX_DETAIL_VALUE });
    if (detail.length > 0) {
      details.push({ path, key: key.slice(0, MAX_DETAIL_KEY), value: detail, depth });
    }
  });

  const titleValue = roles.get("title")?.value ?? null;
  const statusValue = roles.get("status")?.value ?? null;
  const messageValue = roles.get("message")?.value ?? null;
  const urlValue = roles.get("url")?.value ?? null;

  const roleValues = new Set(
    [titleValue, statusValue, messageValue, urlValue].filter(
      (value): value is string => value !== null,
    ),
  );

  const chosenDetails = details
    .filter((entry) => !claimed.has(entry.path) && !roleValues.has(entry.value))
    .sort((a, b) => a.depth - b.depth)
    .slice(0, MAX_DETAILS)
    .map((entry) => ({ key: entry.key, value: entry.value }));

  return {
    title: titleValue,
    status: statusValue,
    message: messageValue === titleValue ? null : messageValue,
    url: urlValue,
    details: chosenDetails,
    recognised: titleValue !== null || statusValue !== null || messageValue !== null || urlValue !== null,
  };
}

/**
 * The glyph is ours, chosen from a closed set by an exact match on a status
 * word. Nothing the payload says can put a different character here.
 */
const STATUS_GLYPHS: ReadonlyMap<string, string> = new Map([
  ["ok", "✅"],
  ["up", "✅"],
  ["success", "✅"],
  ["succeeded", "✅"],
  ["passed", "✅"],
  ["resolved", "✅"],
  ["healthy", "✅"],
  ["closed", "✅"],
  ["fail", "❌"],
  ["failed", "❌"],
  ["failure", "❌"],
  ["error", "❌"],
  ["down", "❌"],
  ["critical", "❌"],
  ["alerting", "❌"],
  ["firing", "❌"],
  ["unhealthy", "❌"],
  ["warning", "⚠️"],
  ["warn", "⚠️"],
  ["degraded", "⚠️"],
  ["pending", "⏳"],
  ["running", "⏳"],
  ["queued", "⏳"],
]);

function statusGlyph(status: string | null): string {
  if (status === null) return "🔔";
  return STATUS_GLYPHS.get(status.trim().toLowerCase()) ?? "🔔";
}

/**
 * A bounded pretty-print, used when no role was recognised.
 *
 * Inside a code span, which is both the readable choice for JSON and the only
 * way the client renders it character for character — §3 of the brief wants
 * «Pretty JSON», and a pretty JSON whose quotes and asterisks have been eaten
 * by an italic rule is not pretty, it is wrong.
 */
function prettyFallback(body: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(body, null, 2) ?? String(body);
  } catch {
    // Circular structures cannot come out of JSON.parse, but a caller may hand
    // us something else, and a card that throws is worse than a card that says
    // it could not read the body.
    text = "[нечитаемое тело]";
  }
  if (text.length > MAX_FALLBACK_JSON) {
    text = `${text.slice(0, MAX_FALLBACK_JSON)}\n…`;
  }
  return asCode(text.replace(UNSAFE_CHARACTERS, " "));
}

export type EventCardInput = {
  /** The webhook's name, as its owner wrote it. */
  sourceName: string;
  /** The parsed body: an object or array from JSON, or a string for a text body. */
  body: unknown;
  /** Defaults to the platform's message limit via `clampMessage`. */
  limit?: number;
};

/**
 * The card.
 *
 * One field per line, and that is a safety property rather than a layout
 * preference: two payload fields on one line could pair their formatting
 * characters with each other, and `untrusted()` shields a value from the text
 * around it only when the value is the thing being shielded.
 */
export function buildEventCard(input: EventCardInput): string {
  const fields = extractEventFields(input.body);
  const source = cleanScalar(input.sourceName, { multiline: false, limit: 64 });
  const lines: string[] = [`${statusGlyph(fields.status)} ${untrusted(source)}`];

  if (fields.title !== null) lines.push(untrusted(fields.title));
  if (fields.status !== null) lines.push(`Статус: ${untrusted(fields.status)}`);
  if (fields.message !== null) {
    lines.push("");
    lines.push(untrusted(fields.message));
  }
  if (fields.url !== null) {
    lines.push("");
    lines.push(untrusted(fields.url));
  }
  // A payload nobody recognised is still readable when it is a flat object of
  // scalars — `{"disk":"95%","host":"db1"}` reads better as two labelled lines
  // than as its own JSON. The pretty-print is for what is left: an array, a
  // bare value, an object whose every field is another object.
  const isPlainObject =
    input.body !== null && typeof input.body === "object" && !Array.isArray(input.body);
  const detailsCarryTheCard = !fields.recognised && isPlainObject && fields.details.length > 0;

  if (fields.details.length > 0 && (fields.recognised || detailsCarryTheCard)) {
    lines.push("");
    for (const detail of fields.details) {
      lines.push(`${untrusted(detail.key)}: ${untrusted(detail.value)}`);
    }
  }

  if (!fields.recognised && !detailsCarryTheCard) {
    lines.push("");
    lines.push(prettyFallback(input.body));
  }

  return clampMessage(lines.join("\n"), input.limit);
}
