import { createMentionText, parseMessageMentions, type MentionText } from "./memberMentions.ts";

interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const key = (owner: string, chat: string) => `kub:draft:v2:${owner}:${chat}`;

export function readMentionDraft(storage: DraftStorage, owner: string, chat: string): MentionText {
  try {
    const raw = JSON.parse(storage.getItem(key(owner, chat)) ?? "null");
    if (raw?.version !== 2 || raw.owner !== owner || raw.chat !== chat || typeof raw.content !== "string") return createMentionText("");
    const entities = parseMessageMentions(raw.content, raw.mentionEntities);
    return entities ? { content: raw.content, mentionEntities: entities } : createMentionText(raw.content);
  } catch { return createMentionText(""); }
}

export function writeMentionDraft(storage: DraftStorage, owner: string, chat: string, snapshot: MentionText): void {
  if (!owner) return;
  if (!snapshot.content) { storage.removeItem(key(owner, chat)); return; }
  storage.setItem(key(owner, chat), JSON.stringify({ version: 2, owner, chat, ...snapshot }));
}
