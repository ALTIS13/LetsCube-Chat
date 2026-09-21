import React from "react";

import {
  botCommandMentionRuns,
  botCommandRunText,
  readBotCommandMention,
  type BotChatAddressing,
  type BotCommand,
} from "./botChatSurfaces.ts";

/**
 * Render a plain-text message body with light Markdown-ish formatting:
 *   **bold**, *italic*, `code`, ~~strike~~, auto-linked URLs and @mentions.
 *
 * Implementation deliberately avoids `dangerouslySetInnerHTML` — every match
 * becomes a React element, so user input cannot inject markup or scripts.
 *
 * Trade-off: the parser is a single-pass non-nesting tokenizer.  Bold inside
 * code or italic inside a URL won't be recognised.  That's intentionally
 * conservative; conversational text rarely nests, and the simpler grammar is
 * easier to reason about and faster on long chats.
 */

/**
 * The accent as a word, not as a shape.
 *
 * These are links and mentions inside a message body — letters, held to 4.5:1 —
 * so they take `--kub-accent-text` rather than the `--tg-accent` alias they used
 * to read, which resolves to `--kub-cyan` and is also what paints the sidebar
 * rail. The alias stays where it is; only this reading of it is unwrapped.
 */
const LINK_COLOR = "var(--kub-accent-text)";

// Order matters: code first so backticks shield their contents from other rules,
// then strike / bold / italic, then URLs and mentions.
const PATTERNS = [
  { name: "code",    re: /`([^`\n]+?)`/ },
  { name: "strike",  re: /~~([^~\n]+?)~~/ },
  { name: "bold",    re: /\*\*([^*\n]+?)\*\*/ },
  { name: "italic",  re: /\*([^*\n]+?)\*/ },
  { name: "url",     re: /\bhttps?:\/\/[^\s<]+[^\s<.,;:'")\]]/ },
  { name: "mention", re: /(^|\s)@([a-zA-Z0-9_]{2,32})/ },
] as const;

type Token =
  | { kind: "text"; value: string }
  | { kind: "code" | "strike" | "bold" | "italic"; value: string }
  | { kind: "url"; href: string }
  | { kind: "mention"; user: string; lead: string }
  | { kind: "command"; shown: string; send: string };

/**
 * What a chat needs to know before a `/command` in it is anything but text
 * (D-263).
 *
 * Absent — which is every chat without a bot, and every surface that draws a
 * message outside the conversation — and the tokenizer below never even looks
 * for one, so nothing about an ordinary message changes.
 *
 * It is the whole bot vocabulary rather than a bare callback because the three
 * decisions are not this file's to make: whether the token runs at all
 * (`botCommandMentionRuns`) and what pressing it sends (`botCommandRunText`)
 * both live in `botChatSurfaces.ts`, where `node --test` can mutate them.
 */
export interface BotCommandsInText {
  readonly commands: readonly BotCommand[];
  readonly addressing: BotChatAddressing;
  readonly onRun: (text: string) => void;
}

interface LocationPreview {
  href: string;
  lat: number;
  lng: number;
}

/**
 * The first runnable command in the slice, or null.
 *
 * Not a `PATTERNS` entry, because it is the only token whose existence depends
 * on something outside the text: a `/shift` is a command in a chat whose bot
 * registered «shift» and six characters anywhere else. `readBotCommandMention`
 * reads the token against the authoriser's own grammar and
 * `botCommandMentionRuns` decides whether it is this chat's.
 *
 * A command begins at a slice boundary or after whitespace, the same
 * convention the `mention` pattern uses — and with the same known slack, that
 * a token consumed just before makes position 0 look like a boundary. It costs
 * nothing here: the character before a consumed token is bold's asterisk or
 * code's backtick, and Telegram treats a command after either as a command too.
 */
function nextCommandMatch(
  input: string,
  bot: BotCommandsInText,
): { start: number; len: number; token: Token } | null {
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== "/") continue;
    if (index > 0 && (input[index - 1] ?? "").trim() !== "") continue;
    const mention = readBotCommandMention(input.slice(index));
    if (!mention) continue;
    if (!botCommandMentionRuns(mention, bot.commands, bot.addressing)) continue;
    return {
      start: index,
      len: mention.length,
      token: {
        kind: "command",
        shown: input.slice(index, index + mention.length),
        send: botCommandRunText(mention, bot.addressing),
      },
    };
  }
  return null;
}

function nextMatch(input: string, bot: BotCommandsInText | null): { start: number; len: number; token: Token } | null {
  let best: { start: number; len: number; token: Token } | null = null;
  if (bot) {
    const command = nextCommandMatch(input, bot);
    if (command) best = command;
  }
  for (const { name, re } of PATTERNS) {
    const m = re.exec(input);
    if (!m) continue;
    if (best && m.index >= best.start) continue;
    let token: Token;
    let consumed = m[0].length;
    let start = m.index;
    switch (name) {
      case "code":
      case "strike":
      case "bold":
      case "italic":
        token = { kind: name, value: m[1] };
        break;
      case "url":
        token = { kind: "url", href: m[0] };
        break;
      case "mention":
        // m[1] is leading whitespace (or empty at line start); we want to
        // preserve it as plain text, not consume it as part of the mention.
        token = { kind: "mention", user: m[2], lead: m[1] };
        start += m[1].length;
        consumed = m[0].length - m[1].length;
        break;
      default:
        continue;
    }
    if (!best || start < best.start) best = { start, len: consumed, token };
  }
  return best;
}

function tokenize(input: string, bot: BotCommandsInText | null): Token[] {
  const out: Token[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const slice = input.slice(cursor);
    const hit = nextMatch(slice, bot);
    if (!hit) {
      out.push({ kind: "text", value: slice });
      break;
    }
    if (hit.start > 0) out.push({ kind: "text", value: slice.slice(0, hit.start) });
    out.push(hit.token);
    cursor += hit.start + hit.len;
  }
  return out;
}

function renderUrlText(href: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  for (let index = 0; index < href.length; index += 1) {
    const char = href[index];
    nodes.push(char);
    if (index < href.length - 1 && "/.?&=-_#".includes(char)) {
      nodes.push(<wbr key={`br-${index}`} />);
    }
  }
  return nodes;
}

export function parseLocationPreview(content: string): LocationPreview | null {
  const trimmed = content.trim();
  const prefixMatch = /^(?:📍\s*)?Местоположение:\s*/u.exec(trimmed);
  if (!prefixMatch) return null;

  const rest = trimmed.slice(prefixMatch[0].length);
  const urlMatch = /^\bhttps?:\/\/[^\s<]+[^\s<.,;:'")\]]/.exec(rest);
  if (!urlMatch) return null;
  if (rest.slice(urlMatch[0].length).trim().length > 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(urlMatch[0]);
  } catch {
    return null;
  }

  if (parsed.hostname !== "maps.google.com" && parsed.hostname !== "www.maps.google.com") return null;
  const query = parsed.searchParams.get("q");
  if (!query) return null;

  const [latRaw, lngRaw] = query.split(",");
  if (!latRaw || !lngRaw) return null;
  const lat = Number.parseFloat(latRaw.trim());
  const lng = Number.parseFloat(lngRaw.trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { href: urlMatch[0], lat, lng };
}

export function isLocationPreviewMessage(content: string): boolean {
  return parseLocationPreview(content) !== null;
}

function renderToken(t: Token, key: number, bot: BotCommandsInText | null): React.ReactNode {
  switch (t.kind) {
    case "command":
      return (
        <button
          key={key}
          type="button"
          data-bot-command-run={t.send}
          // The press must not reach the bubble under it. A message row
          // carries its own gestures — the menu, the selection, the reply —
          // and a command that both ran and opened the row's menu would be
          // one press doing two things.
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            bot?.onRun(t.send);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          // `inline` so it wraps with the sentence it is part of, and the
          // colour the mentions already take: it is a word in a body of text,
          // held to 4.5:1, not a control with a shape.
          className="inline cursor-pointer bg-transparent p-0 font-medium [overflow-wrap:anywhere]"
          style={{ color: LINK_COLOR }}
        >
          {t.shown}
        </button>
      );
    case "text":
      return <React.Fragment key={key}>{t.value}</React.Fragment>;
    case "bold":
      return <strong key={key}>{t.value}</strong>;
    case "italic":
      return <em key={key}>{t.value}</em>;
    case "code":
      return (
        <code
          key={key}
          className="rounded px-1 py-0.5 text-[0.85em]"
          style={{ background: "rgba(0,0,0,0.25)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        >
          {t.value}
        </code>
      );
    case "strike":
      return <s key={key}>{t.value}</s>;
    case "url":
      return (
        <a
          key={key}
          href={t.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline max-w-full underline [overflow-wrap:anywhere] [word-break:break-word]"
          style={{ color: LINK_COLOR }}
        >
          {renderUrlText(t.href)}
        </a>
      );
    case "mention":
      return (
        <React.Fragment key={key}>
          {t.lead}
          <span className="font-medium" style={{ color: LINK_COLOR }}>@{t.user}</span>
        </React.Fragment>
      );
  }
}

export function FormattedText({
  content,
  bot = null,
}: {
  content: string;
  /**
   * What makes a `/command` in this message pressable, or null (D-263).
   *
   * Null everywhere but a conversation holding a bot, so the overwhelming
   * majority of messages are tokenized exactly as they were before: the scan
   * for a command is not run at all.
   */
  bot?: BotCommandsInText | null;
}) {
  const location = parseLocationPreview(content);
  if (location) {
    return (
      <>
        <span className="hidden sm:inline">📍 Местоположение: </span>
        <span className="sm:hidden">📍 </span>
        <a
          href={location.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline max-w-full underline [overflow-wrap:break-word] [word-break:normal]"
          style={{ color: LINK_COLOR }}
        >
          {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
        </a>
      </>
    );
  }

  // Preserve line breaks while still letting tokens span within a line.
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, lineIdx) => {
        const nodes = tokenize(line, bot).map((token, index) => renderToken(token, index, bot));
        return (
          <React.Fragment key={lineIdx}>
            {nodes}
            {lineIdx < lines.length - 1 && <br />}
          </React.Fragment>
        );
      })}
    </>
  );
}
