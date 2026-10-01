/** D-331 text/caption protocol; no UI or storage. Edits create UUID revisions; reads/retries preserve them. */
export type MentionEntity =
  | { kind: "user"; user_id: string; offset: number; length: number; label: string }
  | { kind: "bot"; bot_id: string; offset: number; length: number; label: string };

export type MessageMentionsV1 = {
  version: 1;
  revision: string | null;
  items: MentionEntity[];
};

export interface MentionText {
  content: string;
  mentionEntities: MessageMentionsV1;
}

export const MAX_MEMBER_MENTIONS = 32;
export const MAX_MENTION_LABEL_UNITS = 128;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_CONTROLS = /[\p{Cc}\p{Zl}\p{Zp}\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => {
    if (typeof key !== "string" || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

function isUtf16Boundary(text: string, position: number): boolean {
  if (!Number.isSafeInteger(position) || position < 0 || position > text.length) return false;
  const before = text.charCodeAt(position - 1);
  const after = text.charCodeAt(position);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function isWellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validLabel(label: unknown): label is string {
  return typeof label === "string" && label.startsWith("@")
    && label.length <= MAX_MENTION_LABEL_UNITS && label.trim() === label
    && /[^\p{Z}\p{M}\p{Cf}]/u.test(label.slice(1))
    && !LABEL_CONTROLS.test(label) && isWellFormed(label);
}

interface TextRange { start: number; end: number }

function overlaps(start: number, end: number, ranges: readonly TextRange[]): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

function escapedAt(content: string, position: number): boolean {
  let backslashes = 0;
  while (position > 0 && content[--position] === "\\") backslashes += 1;
  return backslashes % 2 === 1;
}

/** Conservative masks, including unfinished code while typing; not a markdown renderer. */
function maskedRanges(content: string): TextRange[] {
  const ranges: TextRange[] = [];
  const fences = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm;
  for (const match of content.matchAll(fences)) {
    if (overlaps(match.index, match.index + match[0].length, ranges)) continue;
    const run = match[1];
    const closing = new RegExp(`^ {0,3}${run[0]}{${run.length},}[ \\t]*(?:\\r?\\n|$)`, "gm");
    closing.lastIndex = match.index + match[0].length;
    const end = closing.exec(content);
    ranges.push({ start: match.index, end: end ? end.index + end[0].length : content.length });
  }
  const ticks = /`+/g;
  let tick: RegExpExecArray | null;
  while ((tick = ticks.exec(content))) {
    if (escapedAt(content, tick.index) || overlaps(tick.index, ticks.lastIndex, ranges)) continue;
    const newline = content.indexOf("\n", ticks.lastIndex);
    const lineEnd = newline < 0 ? content.length : newline;
    const closing = /`+/g;
    closing.lastIndex = ticks.lastIndex;
    let end = lineEnd;
    let close: RegExpExecArray | null;
    while ((close = closing.exec(content)) && close.index < lineEnd) {
      if (close[0].length === tick[0].length && !escapedAt(content, close.index)) {
        end = closing.lastIndex;
        break;
      }
    }
    ranges.push({ start: tick.index, end });
    ticks.lastIndex = end;
  }
  for (const pattern of [
    /\b(?:https?:\/\/|www\.)[^\s<>`]+/giu,
    /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
    /(?:^|[\s(*~\[])\/[a-z][a-z0-9_]*(?:@[a-z0-9_]*)?/giu,
  ]) {
    for (const match of content.matchAll(pattern)) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

function unmaskedItems(content: string, items: MentionEntity[]): MentionEntity[] {
  const masks = maskedRanges(content);
  return items.filter((item) => !overlaps(item.offset, item.offset + item.length, masks));
}

export function emptyMessageMentions(): MessageMentionsV1 {
  return { version: 1, revision: null, items: [] };
}

/** Strict persisted-input validation; never generates a revision or resolves a handle. */
export function parseMessageMentions(content: string, raw: unknown): MessageMentionsV1 | null {
  try {
    return parseEnvelope(content, raw);
  } catch {
    return null;
  }
}

function parseEnvelope(content: string, raw: unknown): MessageMentionsV1 | null {
  if (typeof content !== "string" || !isWellFormed(content)
    || !exactRecord(raw, ["version", "revision", "items"])) return null;
  if (raw.version !== 1 || !Array.isArray(raw.items) || raw.items.length > MAX_MEMBER_MENTIONS) return null;
  if (raw.revision !== null && !isUuid(raw.revision)) return null;
  if (raw.items.length > 0 && raw.revision === null) return null;
  if (Reflect.ownKeys(raw.items).length !== raw.items.length + 1) return null;
  for (let index = 0; index < raw.items.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(raw.items, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
  }
  const items: MentionEntity[] = [];
  const masks = maskedRanges(content);
  let previousEnd = 0;
  for (const value of raw.items) {
    if (!value || typeof value !== "object") return null;
    const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
    const idKey = kind === "user" ? "user_id" : kind === "bot" ? "bot_id" : null;
    if (!idKey || !exactRecord(value, ["kind", idKey, "offset", "length", "label"])) return null;
    const { offset, length, label } = value;
    const id = value[idKey];
    if (!isUuid(id) || typeof offset !== "number" || typeof length !== "number"
      || !Number.isSafeInteger(length) || length <= 0 || !isUtf16Boundary(content, offset)
      || offset < previousEnd || !isUtf16Boundary(content, offset + length)
      || !validLabel(label) || length !== label.length || content.slice(offset, offset + length) !== label
      || overlaps(offset, offset + length, masks)) return null;
    items.push(kind === "user"
      ? { kind: "user", user_id: id, offset, length, label }
      : { kind: "bot", bot_id: id, offset, length, label });
    previousEnd = offset + length;
  }
  return { version: 1, revision: raw.revision, items };
}

export interface MentionTextEdit {
  start: number;
  end: number;
  text: string;
}

/** A conservative contiguous diff; text alone never reconstructs a removed identity. */
export function diffMentionTextEdit(before: string, after: string): MentionTextEdit | null {
  if (!isWellFormed(before) || !isWellFormed(after)) throw new TypeError("Invalid UTF-16 text");
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  while (!isUtf16Boundary(before, start) || !isUtf16Boundary(after, start)) start -= 1;
  let end = before.length;
  let afterEnd = after.length;
  while (end > start && afterEnd > start && before[end - 1] === after[afterEnd - 1]) {
    end -= 1;
    afterEnd -= 1;
  }
  while (!isUtf16Boundary(before, end) || !isUtf16Boundary(after, afterEnd)) {
    end += 1;
    afterEnd += 1;
  }
  return { start, end, text: after.slice(start, afterEnd) };
}

function checkedSnapshot(snapshot: MentionText): MentionText {
  const mentionEntities = parseMessageMentions(snapshot.content, snapshot.mentionEntities);
  if (!mentionEntities) throw new TypeError("Invalid mention snapshot");
  return { content: snapshot.content, mentionEntities };
}

function requireFreshRevision(revision: string, previous: string | null): void {
  if (!isUuid(revision) || revision.toLowerCase() === previous?.toLowerCase()) {
    throw new TypeError("A fresh UUID revision is required");
  }
}

function requireRange(content: string, start: number, end: number): void {
  if (start > end || !isUtf16Boundary(content, start) || !isUtf16Boundary(content, end)) {
    throw new RangeError("Invalid UTF-16 range");
  }
}

/** Explicit replacement also drops identity on a paste of the same visible label. */
export function replaceMentionText(snapshot: MentionText, edit: MentionTextEdit, revision?: string): MentionText {
  const source = checkedSnapshot(snapshot);
  requireRange(source.content, edit.start, edit.end);
  if (!isWellFormed(edit.text)) throw new TypeError("Invalid UTF-16 text");
  if (edit.start === edit.end && !edit.text) return source;
  const nextRevision = revision ?? crypto.randomUUID();
  requireFreshRevision(nextRevision, source.mentionEntities.revision);
  const delta = edit.text.length - (edit.end - edit.start);
  const items = source.mentionEntities.items.flatMap((item): MentionEntity[] => {
    if (edit.end <= item.offset) return [{ ...item, offset: item.offset + delta }];
    if (edit.start >= item.offset + item.length) return [item];
    return [];
  });
  const content = source.content.slice(0, edit.start) + edit.text + source.content.slice(edit.end);
  return { content, mentionEntities: { version: 1, revision: nextRevision, items: unmaskedItems(content, items) } };
}

export function rebaseMentionText(snapshot: MentionText, content: string, revision?: string): MentionText {
  const source = checkedSnapshot(snapshot);
  const edit = diffMentionTextEdit(source.content, content);
  return edit ? replaceMentionText(source, edit, revision) : source;
}

/** Display/caption projection, not a content save: retain the persisted revision. */
export function sliceMentionText(snapshot: MentionText, start: number, end: number, revision?: string): MentionText {
  const source = checkedSnapshot(snapshot);
  requireRange(source.content, start, end);
  if (revision !== undefined) requireFreshRevision(revision, source.mentionEntities.revision);
  const content = source.content.slice(start, end);
  return {
    content,
    mentionEntities: {
      ...source.mentionEntities,
      revision: revision ?? source.mentionEntities.revision,
      items: unmaskedItems(content, source.mentionEntities.items
        .filter((item) => item.offset >= start && item.offset + item.length <= end)
        .map((item) => ({ ...item, offset: item.offset - start }))),
    },
  };
}

export function trimMentionText(snapshot: MentionText, revision?: string): MentionText {
  const start = snapshot.content.length - snapshot.content.trimStart().length;
  const end = Math.max(start, snapshot.content.trimEnd().length);
  if (start === 0 && end === snapshot.content.length) return checkedSnapshot(snapshot);
  return sliceMentionText(snapshot, start, end, revision ?? crypto.randomUUID());
}

export interface MentionCompletion {
  start: number;
  end: number;
  query: string;
}

export function getMentionCompletion(
  content: string,
  selectionStart: number,
  selectionEnd = selectionStart,
  items: readonly MentionEntity[] = [],
): MentionCompletion | null {
  if (selectionStart !== selectionEnd || !isUtf16Boundary(content, selectionStart)) return null;
  const match = /(?:^|[\s(*~\[])@([^\s@`*~()[\]<>\\]*)$/u.exec(content.slice(0, selectionStart));
  if (!match || LABEL_CONTROLS.test(match[1])) return null;
  const start = selectionStart - match[1].length - 1;
  if (overlaps(start, selectionStart, maskedRanges(content))
    || items.some((item) => start < item.offset + item.length && selectionStart > item.offset)) return null;
  return { start, end: selectionStart, query: match[1] };
}

export interface MemberMentionCandidate {
  kind: "user" | "bot";
  id: string;
  label: string;
  username?: string | null;
  avatar_url?: string | null;
  disambiguator?: string;
}

export interface MemberMentionScope {
  userId: string;
  chatId: string;
  topicId: string | null;
  generation: number;
}

export interface MemberMentionRoster {
  scope: MemberMentionScope;
  state: "ready" | "loading" | "error" | "denied";
  candidates: readonly MemberMentionCandidate[];
}

export const emptyMentionEntities = emptyMessageMentions;
export const mentionCompletionContext = getMentionCompletion;

/** Read-only compatibility boundary: invalid/legacy metadata cannot activate a profile. */
export function readMentionEntities(content: string, raw: unknown): MessageMentionsV1 {
  return parseMessageMentions(content, raw) ?? emptyMessageMentions();
}

export function createMentionText(content: string, metadata?: unknown): MentionText {
  return { content, mentionEntities: readMentionEntities(content, metadata) };
}

/** Matches attachCaptionHandoff's whitespace rule, carrying both identity snapshots. */
export function concatMentionText(held: MentionText, typed: MentionText, revision?: string): MentionText {
  const left = checkedSnapshot(held);
  const right = checkedSnapshot(typed);
  if (!left.content) return right;
  if (!right.content) return left;
  const separator = /\s$/.test(left.content) || /^\s/.test(right.content) ? "" : " ";
  const shift = left.content.length + separator.length;
  const content = left.content + separator + right.content;
  const nextRevision = revision ?? crypto.randomUUID();
  requireFreshRevision(nextRevision, left.mentionEntities.revision);
  requireFreshRevision(nextRevision, right.mentionEntities.revision);
  const items = unmaskedItems(content, [
    ...left.mentionEntities.items,
    ...right.mentionEntities.items.map((item) => ({ ...item, offset: item.offset + shift })),
  ]);
  if (items.length > MAX_MEMBER_MENTIONS) throw new RangeError("Too many mention entities");
  return { content, mentionEntities: { version: 1, revision: nextRevision, items } };
}

function searchKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU");
}

function candidateKey(candidate: MemberMentionCandidate): string {
  return `${candidate.kind}:${candidate.id.toLowerCase()}`;
}

function validCandidate(candidate: MemberMentionCandidate): boolean {
  return (candidate.kind === "user" || candidate.kind === "bot") && isUuid(candidate.id)
    && validLabel(candidate.label) && !overlaps(0, candidate.label.length, maskedRanges(candidate.label));
}

function compareCandidates(a: MemberMentionCandidate, b: MemberMentionCandidate): number {
  return searchKey(a.label).localeCompare(searchKey(b.label), "ru-RU")
    || candidateKey(a).localeCompare(candidateKey(b))
    || (a.username ?? "").localeCompare(b.username ?? "")
    || (a.avatar_url ?? "").localeCompare(b.avatar_url ?? "");
}

/** Input must be the caller's scoped roster, never a global directory. No result cap. */
export function matchMentionCandidates(candidates: readonly MemberMentionCandidate[], query: string): MemberMentionCandidate[] {
  const unique = new Map<string, MemberMentionCandidate>();
  for (const candidate of candidates.filter(validCandidate).sort(compareCandidates)) {
    const key = candidateKey(candidate);
    if (unique.has(key)) continue;
    const copy: MemberMentionCandidate = { kind: candidate.kind, id: candidate.id, label: candidate.label };
    if (candidate.username !== undefined) copy.username = candidate.username;
    if (candidate.avatar_url !== undefined) copy.avatar_url = candidate.avatar_url;
    unique.set(key, copy);
  }
  const all = [...unique.values()];
  const needle = searchKey(query.replace(/^@/, "").trim());
  return all.flatMap((candidate) => {
    const display = searchKey(candidate.label.slice(1));
    const handle = searchKey((candidate.username ?? "").replace(/^@/, ""));
    const matches = !needle || handle.startsWith(needle)
      || [...display.matchAll(/[\p{L}\p{N}_]+/gu)].some((word) => display.slice(word.index).startsWith(needle));
    if (!matches) return [];
    const peers = all.filter((peer) => searchKey(peer.label) === searchKey(candidate.label));
    if (peers.length > 1) {
      if (handle && peers.every((peer) => candidateKey(peer) === candidateKey(candidate)
        || searchKey((peer.username ?? "").replace(/^@/, "")) !== handle)) {
        candidate.disambiguator = `@${candidate.username!.replace(/^@/, "")}`;
      } else {
        const id = candidate.id.replaceAll("-", "").toLowerCase();
        let width = 8;
        while (width < id.length && peers.some((peer) => candidateKey(peer) !== candidateKey(candidate)
          && peer.id.replaceAll("-", "").toLowerCase().endsWith(id.slice(-width)))) width += 4;
        candidate.disambiguator = width === id.length && peers.some((peer) => peer.kind !== candidate.kind
          && peer.id.toLowerCase() === candidate.id.toLowerCase()) ? `${candidate.kind}:${id}` : id.slice(-width);
      }
    }
    return [candidate];
  });
}

export function filterMentionCandidates(roster: MemberMentionRoster, scope: MemberMentionScope, query: string): MemberMentionCandidate[] {
  if (roster.state !== "ready" || !isUuid(scope.userId) || !isUuid(scope.chatId)
    || (scope.topicId !== null && !isUuid(scope.topicId)) || !Number.isSafeInteger(scope.generation)
    || scope.generation < 0 || roster.scope.userId.toLowerCase() !== scope.userId.toLowerCase()
    || roster.scope.chatId.toLowerCase() !== scope.chatId.toLowerCase()
    || roster.scope.topicId?.toLowerCase() !== scope.topicId?.toLowerCase()
    || roster.scope.generation !== scope.generation) return [];
  return matchMentionCandidates(roster.candidates.filter((candidate) => candidate.kind !== "user"
    || candidate.id.toLowerCase() !== scope.userId.toLowerCase()), query);
}

export function insertMemberMention(
  snapshot: MentionText,
  context: MentionCompletion,
  candidate: MemberMentionCandidate,
  revision?: string,
): { snapshot: MentionText; caret: number } {
  const source = checkedSnapshot(snapshot);
  const current = getMentionCompletion(source.content, context.end, context.end, source.mentionEntities.items);
  if (!current || current.start !== context.start || current.query !== context.query) {
    throw new RangeError("Stale or masked mention completion");
  }
  if (!validCandidate(candidate)) throw new TypeError("Invalid mention candidate");
  if (source.mentionEntities.items.length >= MAX_MEMBER_MENTIONS) throw new RangeError("Too many mention entities");
  const suffix = source.content.slice(context.end);
  const separator = /^\s/.test(suffix) ? "" : " ";
  const result = replaceMentionText(source,
    { start: context.start, end: context.end, text: candidate.label + separator }, revision);
  const common = { offset: context.start, length: candidate.label.length, label: candidate.label };
  const item: MentionEntity = candidate.kind === "user"
    ? { kind: "user", user_id: candidate.id, ...common }
    : { kind: "bot", bot_id: candidate.id, ...common };
  result.mentionEntities.items.push(item);
  result.mentionEntities.items.sort((a, b) => a.offset - b.offset);
  // Move past an existing space as well; do not jump across an existing newline.
  const caret = context.start + candidate.label.length + separator.length + (suffix.startsWith(" ") ? 1 : 0);
  return { snapshot: checkedSnapshot(result), caret };
}
