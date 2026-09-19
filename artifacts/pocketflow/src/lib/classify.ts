import type { IncomingMessage } from "#pf/transport/types";

/**
 * What did the person just send us? (§3, the smart inbox.)
 *
 * A pure function over the message, because this is the one decision the whole
 * inbox hangs on and it deserves a test rather than a walk-through. It answers
 * with a classification and the useful part it extracted, never with a
 * side effect.
 *
 * The order of the checks is the design. An attachment wins over text because a
 * photo with a caption is a photo; JSON wins over URL because a JSON document
 * may contain one; URL wins over text because that is the whole point of
 * recognising it.
 */

export type Classification =
  | { kind: "photo"; fileId: string; mimeType: string | null; caption: string | null }
  | { kind: "document"; fileId: string; fileName: string | null; mimeType: string | null; caption: string | null }
  | { kind: "voice"; fileId: string; durationSeconds: number | null }
  | { kind: "video"; fileId: string; caption: string | null }
  | { kind: "location"; latitude: number; longitude: number }
  | { kind: "json"; text: string; parsed: unknown }
  | { kind: "url"; url: string; hostname: string; text: string }
  | { kind: "command"; command: string; args: string; text: string }
  | { kind: "text"; text: string }
  | { kind: "empty" };

/**
 * The location wire format this platform uses.
 *
 * Read off `artifacts/kub/src/lib/formatText.tsx`, which renders a message of
 * this exact shape as a map link rather than as text. PocketFlow recognises it
 * so that «поделиться геопозицией» arrives as a location and not as a line of
 * punctuation — and the pattern lives here, next to a comment saying where it
 * came from, because a copied regular expression with no provenance is the
 * thing nobody dares change later.
 */
const LOCATION_PATTERN = /^\s*__kub_location__:(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)\s*$/;

const COMMAND_PATTERN = /^\/([a-zA-Z][a-zA-Z0-9_]{0,31})(?:@[\w-]+)?(?:\s+([\s\S]*))?$/;

/** Bounded on purpose: `JSON.parse` on a 4096-character string is cheap, on a stream is not. */
const MAX_JSON_BYTES = 8192;

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || Buffer.byteLength(trimmed, "utf8") > MAX_JSON_BYTES) return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === "{" && last === "}") || (first === "[" && last === "]");
}

/**
 * The first URL in the text, if the text is essentially a URL.
 *
 * «essentially» matters: a paragraph that mentions a link in passing is a note,
 * not a link, and offering «Следить» for it would be wrong. So the URL has to
 * be the whole message bar surrounding whitespace.
 */
function wholeMessageUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (/\s/.test(trimmed)) return null;

  // A string that already names a scheme is only a link if that scheme is
  // http(s). Without this, `mailto:a@b.c` has no `//`, so it falls through to
  // the branch below, becomes `https://mailto:a@b.c`, and parses as host
  // `b.c` with the userinfo `mailto:a` — a URL carrying credentials, offered
  // to the watcher. Caught by a test, which is the only reason it is not
  // still there.
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const isHttp = /^https?:\/\//i.test(trimmed);
  if (hasScheme && !isHttp) return null;

  let url: URL;
  try {
    url = new URL(isHttp ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Credentials in a link are never what somebody meant to share, and passing
  // one on to the watcher would store a password in this bot's database.
  if (url.username || url.password) return null;
  // `https://foo` parses and is not a link anybody typed on purpose; a dot in
  // the hostname is the cheapest rule that separates a domain from a word.
  if (!url.hostname.includes(".")) return null;
  return url;
}

export function classify(message: IncomingMessage): Classification {
  const attachment = message.attachment;
  const text = message.text?.trim() ?? "";

  if (attachment) {
    switch (attachment.kind) {
      case "image":
        return {
          kind: "photo",
          fileId: attachment.fileId,
          mimeType: attachment.mimeType,
          caption: text || null,
        };
      case "audio":
        return {
          kind: "voice",
          fileId: attachment.fileId,
          durationSeconds: attachment.durationSeconds,
        };
      case "video":
        return { kind: "video", fileId: attachment.fileId, caption: text || null };
      case "file":
      case "unknown":
        return {
          kind: "document",
          fileId: attachment.fileId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          caption: text || null,
        };
    }
  }

  if (text === "") return { kind: "empty" };

  const location = LOCATION_PATTERN.exec(text);
  if (location) {
    const latitude = Number(location[1]);
    const longitude = Number(location[2]);
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    ) {
      return { kind: "location", latitude, longitude };
    }
  }

  const command = COMMAND_PATTERN.exec(text);
  if (command?.[1]) {
    return {
      kind: "command",
      command: command[1].toLowerCase(),
      args: (command[2] ?? "").trim(),
      text,
    };
  }

  if (looksLikeJson(text)) {
    try {
      return { kind: "json", text, parsed: JSON.parse(text) };
    } catch {
      // Looked like JSON and was not. That is a text message about JSON, and
      // treating it as a parse failure the user has to hear about would be
      // noise — they did not ask for anything yet.
    }
  }

  const url = wholeMessageUrl(text);
  if (url) return { kind: "url", url: url.toString(), hostname: url.hostname, text };

  return { kind: "text", text };
}

/**
 * Pretty-print for §3's «Pretty JSON», bounded.
 *
 * This returns the JSON and nothing else. Making it *survive the client's
 * formatter* is a separate job and lives in `lib/render.ts` (`asCode`), because
 * every outgoing string has that problem and solving it twice would mean
 * solving it two different ways. The bound is here because a 2 MB document must
 * not become a 2 MB `JSON.stringify` before anyone asks how long it is.
 */
export function prettyJson(value: unknown, maxLength = 3500): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "(не удалось отформатировать)";
  }
  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength)}\n… (обрезано)`;
  }
  return text;
}
