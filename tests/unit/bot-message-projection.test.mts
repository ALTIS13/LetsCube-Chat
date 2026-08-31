import assert from "node:assert/strict";
import test from "node:test";

const actorModule = await import(
  "../../artifacts/kub/src/lib/messageActor.ts"
).catch(() => null);

function actorApi() {
  assert.ok(actorModule, "message actor resolver must exist");
  return actorModule;
}

const human = {
  id: "user-1",
  full_name: "Алина",
  username: "alina",
  avatar_url: "/avatars/alina.webp",
};

const bot = {
  id: "bot-1",
  display_name: "Помощник",
  username: "helper_bot",
  description: "",
  avatar_url: "https://api.letscube.ru/media/bots/helper.webp",
  state: "active",
  created_at: "2026-08-31T10:00:00.000Z",
  updated_at: "2026-08-31T10:00:00.000Z",
};

test("persisted sender IDs resolve user, bot, deleted bot, deleted user, and system actors", () => {
  const { resolveMessageActor } = actorApi();

  assert.deepEqual(
    resolveMessageActor({ type: "text", user_id: "user-1", bot_id: null, sender: human, bot: null }),
    { kind: "user", id: "user-1", profile: human },
  );
  assert.deepEqual(
    resolveMessageActor({ type: "text", user_id: null, bot_id: "bot-1", sender: null, bot }),
    { kind: "bot", id: "bot-1", bot },
  );
  assert.deepEqual(
    resolveMessageActor({ type: "text", user_id: null, bot_id: "bot-1", sender: null, bot: null }),
    { kind: "deleted_bot", id: "bot-1" },
  );
  assert.deepEqual(
    resolveMessageActor({ type: "text", user_id: null, bot_id: null, sender: null, bot: null }),
    { kind: "deleted_user" },
  );
  assert.deepEqual(
    resolveMessageActor({ type: "system", user_id: null, bot_id: null, sender: null, bot: null }),
    { kind: "system" },
  );
});

test("dual and mismatched projections fail closed without a human profile action", () => {
  const { resolveMessageActor, canUseHumanMessageControls } = actorApi();
  const invalidRows = [
    { type: "text", user_id: "user-1", bot_id: "bot-1", sender: human, bot },
    { type: "text", user_id: "user-1", bot_id: null, sender: { ...human, id: "user-2" }, bot: null },
    { type: "text", user_id: null, bot_id: "bot-1", sender: null, bot: { ...bot, id: "bot-2" } },
    { type: "system", user_id: "user-1", bot_id: null, sender: human, bot: null },
  ];

  for (const row of invalidRows) {
    assert.deepEqual(resolveMessageActor(row), { kind: "invalid" });
    assert.equal(canUseHumanMessageControls(row, "user-1"), false);
  }
});

test("deleted bot state never exposes a live bot actor", () => {
  const { resolveMessageActor, messageActorDisplayName } = actorApi();
  const row = {
    type: "text",
    user_id: null,
    bot_id: "bot-1",
    sender: null,
    bot: { ...bot, state: "deleted" },
  };

  assert.deepEqual(resolveMessageActor(row), { kind: "deleted_bot", id: "bot-1" });
  assert.equal(messageActorDisplayName(row), "Удалённый бот");
});

test("grouping and client message reconciliation are scoped to the persisted actor", () => {
  const { messageActorGroupingKey, sameActorClientMessage } = actorApi();
  const humanOptimistic = {
    id: "tmp:shared",
    type: "text",
    user_id: "user-1",
    bot_id: null,
    client_message_id: "shared-client-id",
    sender: human,
    bot: null,
  };
  const humanServer = { ...humanOptimistic, id: "message-1" };
  const botServer = {
    ...humanOptimistic,
    id: "message-2",
    user_id: null,
    bot_id: "bot-1",
    sender: null,
    bot,
  };

  assert.equal(sameActorClientMessage(humanOptimistic, humanServer), true);
  assert.equal(sameActorClientMessage(humanOptimistic, botServer), false);
  assert.equal(messageActorGroupingKey(humanServer), "user:user-1");
  assert.equal(messageActorGroupingKey(botServer), "bot:bot-1");
  assert.notEqual(
    messageActorGroupingKey({ ...botServer, id: "message-3", bot_id: "bot-2", bot: { ...bot, id: "bot-2" } }),
    messageActorGroupingKey(botServer),
  );
  assert.notEqual(
    messageActorGroupingKey({ ...humanOptimistic, id: "tombstone-1", user_id: null, sender: null }),
    messageActorGroupingKey({ ...humanOptimistic, id: "tombstone-2", user_id: null, sender: null }),
  );
});
