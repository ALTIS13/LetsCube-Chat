import React from "react";

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
  | { kind: "mention"; user: string; lead: string };

function nextMatch(input: string): { start: number; len: number; token: Token } | null {
  let best: { start: number; len: number; token: Token } | null = null;
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

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const slice = input.slice(cursor);
    const hit = nextMatch(slice);
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

function renderToken(t: Token, key: number): React.ReactNode {
  switch (t.kind) {
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
          className="underline"
          style={{ color: "var(--tg-accent)" }}
        >
          {t.href}
        </a>
      );
    case "mention":
      return (
        <React.Fragment key={key}>
          {t.lead}
          <span className="font-medium" style={{ color: "var(--tg-accent)" }}>@{t.user}</span>
        </React.Fragment>
      );
  }
}

export function FormattedText({ content }: { content: string }) {
  // Preserve line breaks while still letting tokens span within a line.
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, lineIdx) => {
        const nodes = tokenize(line).map(renderToken);
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
