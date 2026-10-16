import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { chatMuteState } from "../../artifacts/kub/src/lib/chatMute.ts";

const moduleUrl = new URL("../../artifacts/kub/src/lib/topicNotificationPreferences.ts", import.meta.url);
async function subject(source?: string) {
  if (source === undefined) {
    try { source = readFileSync(moduleUrl, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  assert.notEqual(source, undefined, "topic inheritance and canonical scope are not implemented");
  const output = ts.transpile(source!, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const scope = { userId: "reader-a", accountEpoch: 7, chatId: "chat-a", topicId: "topic-a" };
const topics = [
  { id: "topic-a", chat_id: "chat-a", is_general: false, archived: false },
  { id: "topic-general", chat_id: "chat-a", is_general: true, archived: false },
  { id: "topic-archived", chat_id: "chat-a", is_general: false, archived: true },
  { id: "topic-foreign", chat_id: "chat-b", is_general: false, archived: false },
];
const snapshot = { userId: "reader-a", accountEpoch: 7, chatId: "chat-a", topics };

test("a topic override changes only parent mute, never independent restrictions", async () => {
  const { resolveTopicAlert } = await subject();
  for (const [mode, parentMuted, allowed, expected] of [
    ["inherit", false, true, true], ["inherit", true, true, false],
    ["enabled", true, true, true], ["enabled", false, true, true],
    ["disabled", true, true, false], ["disabled", false, true, false],
    ["inherit", false, false, false], ["enabled", true, false, false],
    ["disabled", false, false, false],
  ]) assert.equal(resolveTopicAlert(mode, parentMuted, allowed), expected);
});

test("unknown settings and unavailable restrictions never become delivery permission", async () => {
  const { resolveTopicAlert } = await subject();
  for (const mode of [null, undefined, "unknown", "ENABLED", {}, 1]) {
    assert.equal(resolveTopicAlert(mode, false, true), false);
  }
  for (const restrictions of [undefined, null, "true", 1, {}]) {
    assert.equal(resolveTopicAlert("enabled", false, restrictions), false);
  }
  for (const parentMuted of [undefined, null, "false", 0]) {
    assert.equal(resolveTopicAlert("inherit", parentMuted, true), false);
  }
});

test("temporary parent mute expires for inherit while an explicit child disable persists", async () => {
  const { resolveTopicAlert } = await subject();
  const until = "2026-10-16T12:00:00Z";
  assert.equal(resolveTopicAlert("inherit", chatMuteState({ pushEnabled: true, mutedUntil: until }, Date.parse("2026-10-16T11:59:59Z")).muted, true), false);
  assert.equal(resolveTopicAlert("inherit", chatMuteState({ pushEnabled: true, mutedUntil: until }, Date.parse(until)).muted, true), true);
  assert.equal(resolveTopicAlert("disabled", chatMuteState({ pushEnabled: true, mutedUntil: until }, Date.parse(until)).muted, true), false);
  assert.equal(chatMuteState({ pushEnabled: false, mutedUntil: until }, Date.parse(until)).muted, true);
});

test("null and actual same-chat general topic share one preference key", async () => {
  const { canonicalTopicNotificationScope: canonical } = await subject();
  assert.equal(canonical({ ...scope, topicId: null }, snapshot), "general");
  assert.equal(canonical({ ...scope, topicId: "topic-general" }, snapshot), "general");
  assert.equal(canonical(scope, snapshot), "topic-a");
  assert.equal(canonical({ ...scope, topicId: "general" }, snapshot), null);
});

test("general aliases refuse an archived general and require an owned snapshot",async()=>{
  const {canonicalTopicNotificationScope:canonical}=await subject();
  const archivedGeneral={...snapshot,topics:topics.map(t=>({...t,archived:t.is_general||t.archived}))};
  assert.equal(canonical({...scope,topicId:null},archivedGeneral),null);
  assert.equal(canonical({...scope,topicId:"topic-general"},archivedGeneral),null);
  assert.equal(canonical({...scope,topicId:null},null),null);
  assert.equal(canonical({...scope,topicId:null},{...snapshot,accountEpoch:8}),null);
  assert.equal(canonical({...scope,topicId:null},{...snapshot,topics:[]}),"general");
});

test("archived missing foreign or unread topics cannot silently select general", async () => {
  const { canonicalTopicNotificationScope: canonical } = await subject();
  for (const topicId of ["topic-archived", "missing", "topic-foreign", "", undefined]) {
    assert.equal(canonical({ ...scope, topicId }, snapshot), null);
  }
  assert.equal(canonical(scope, null), null);
  assert.equal(canonical(scope, { ...snapshot, topics: null }), null);
  assert.equal(canonical({ ...scope, chatId: "chat-b" }, snapshot), null);
});

test("another account or another incarnation cannot reuse topic identity", async () => {
  const { canonicalTopicNotificationScope: canonical } = await subject();
  assert.equal(canonical(scope, { ...snapshot, userId: "reader-b" }), null);
  assert.equal(canonical(scope, { ...snapshot, accountEpoch: 8 }), null);
  assert.equal(canonical({ ...scope, userId: null, topicId: null }, null), null);
  assert.equal(canonical({ ...scope, accountEpoch: NaN, topicId: null }, null), null);
});

test("literal precedence and scope cases reject compiled omission controls", async () => {
  const original = readFileSync(moduleUrl, "utf8");
  const changes = [
    ["independent restrictions", "if (restrictionsAllowed !== true) return false;", "", (m: any) => m.resolveTopicAlert("enabled", true, false), false],
    ["explicit disable", 'if (mode === "disabled") return false;', 'if (mode === "disabled") return true;', (m: any) => m.resolveTopicAlert("disabled", false, true), false],
    ["explicit enable", 'if (mode === "enabled") return true;', "", (m: any) => m.resolveTopicAlert("enabled", true, true), true],
    ["account owner", "snapshot.userId !== scope.userId ||", "", (m: any) => m.canonicalTopicNotificationScope(scope, { ...snapshot, userId: "reader-b" }), null],
    ["session owner", "snapshot.accountEpoch !== scope.accountEpoch ||", "", (m: any) => m.canonicalTopicNotificationScope(scope, { ...snapshot, accountEpoch: 8 }), null],
    ["topic archive", "topic.archived === false", "true", (m: any) => m.canonicalTopicNotificationScope({ ...scope, topicId: "topic-archived" }, snapshot), null],
    ["topic chat", "topic.chat_id === scope.chatId &&", "", (m: any) => m.canonicalTopicNotificationScope({ ...scope, topicId: "topic-foreign" }, snapshot), null],
  ] as const;
  for (const [name, before, after, run, expected] of changes) {
    assert.equal(original.split(before).length, 2, `${name}: unique mutation anchor`);
    const mutant = await subject(original.replace(before, after));
    assert.notEqual(run(mutant), expected, `${name}: omitted rule must break its literal expectation`);
  }
});
