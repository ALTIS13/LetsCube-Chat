/**
 * Sending text that means what it says.
 *
 * This file exists because of gap **G-5**. The LETSCUBE Bot API has no
 * `parse_mode`, and the client formats every message it receives whether the
 * sender wanted that or not. Read off `artifacts/kub/src/lib/formatText.tsx`,
 * verified rather than assumed:
 *
 *   - the tokenizer runs **per line** (`content.split("\n")`, then tokenize);
 *   - the rules are, in this order, `` `code` ``, `~~strike~~`, `**bold**`,
 *     `*italic*`, bare http(s) URLs, and `@mention` preceded by start-of-line
 *     or whitespace;
 *   - `code` is matched **first**, and its body is `[^`\n]+?` — so a backtick
 *     span shields everything inside it from every other rule;
 *   - there is **no escape character**. Nothing a sender can write makes a
 *     literal `*pair*` render as `*pair*`.
 *
 * So there are exactly two ways to send a string verbatim: contain it in a
 * backtick span, or contain no formatting characters at all. `asCode` does the
 * first; `plain` does the second by telling the caller when it is not possible.
 *
 * A bot that ignores this ships a webhook card where a payload's `*` italicises
 * the rest of the line, and a SHA-256 that looks right but had two characters
 * eaten. Both are the kind of defect that gets reported as «иногда ломается».
 */

/**
 * Wraps text so the client renders it character for character.
 *
 * Per line, because a backtick span cannot contain a newline. A line
 * containing backticks is split at them, so that each backtick-free run is
 * shielded and the backticks themselves survive as literal text between the
 * runs — lossless, which matters when the text is somebody's data.
 *
 * An empty line stays empty: `` `` `` is not a code span (the pattern needs at
 * least one inner character) and would arrive as two literal backticks.
 */
export function asCode(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (line === "") return "";
      return line
        .split("`")
        .map((run) => (run === "" ? "" : `\`${run}\``))
        .join("`");
    })
    .join("\n");
}

const FORMATTING_CHARACTERS = /[`~*]/;

/**
 * Whether this string would survive the client's formatter unchanged.
 *
 * `@` and bare URLs are deliberately not counted: a mention and a link render
 * as themselves plus a colour, so nothing is lost. `` ` ``, `~` and `*` are
 * the three that can disappear.
 */
export function survivesFormatting(text: string): boolean {
  return !FORMATTING_CHARACTERS.test(text);
}

/**
 * Text from an untrusted source, rendered so it cannot reformat the message
 * around it.
 *
 * The whole point is the *around it*: a stray `*` in one field of a webhook
 * payload does not just mangle that field, it italicises everything up to the
 * next `*` anywhere on the line, which may be a different field entirely.
 */
export function untrusted(text: string): string {
  return survivesFormatting(text) ? text : asCode(text);
}

/** `sendMessage` refuses anything longer, and refuses it as a validation error. */
export const MAX_MESSAGE_LENGTH = 4096;

/**
 * Cuts a message to the platform's limit, on a line boundary where it can.
 *
 * The marker is counted before the cut rather than appended after it, which is
 * the off-by-one that turns «truncate to fit» into a 400 from the gateway.
 */
export function clampMessage(text: string, limit = MAX_MESSAGE_LENGTH): string {
  if (text.length <= limit) return text;
  const marker = "\n… (обрезано)";
  const room = Math.max(0, limit - marker.length);
  const cut = text.slice(0, room);
  const lastNewline = cut.lastIndexOf("\n");
  // Only prefer the line boundary if it does not throw away most of the text.
  const body = lastNewline > room * 0.6 ? cut.slice(0, lastNewline) : cut;
  return body + marker;
}
