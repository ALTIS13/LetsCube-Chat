import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  avatarVariantSubject,
  pickAvatarVariant,
} from "../../artifacts/kub/src/lib/avatarVariantStore.ts";
import {
  IMMUTABLE_CACHE_CONTROL,
  REUSED_PATH_CACHE_CONTROL,
  cacheControlFor,
} from "../../artifacts/kub/src/lib/mediaCacheControl.ts";

const CHAT_ID = "7be464a0-a510-4e09-9f70-69d17a5eab02";
const PROFILE_ID = "6f8b94d6-72de-42fc-927c-ba18909b5d5c";

const migration = readFileSync(
  ".migration-backup/supabase/migrations/20260904040000_chat_avatar_variants.sql",
  "utf8",
);
const normalizedMigration = migration.replace(/\s+/g, " ").toLowerCase();
const worker = readFileSync("artifacts/api-server/src/workers/mediaVariantsWorker.ts", "utf8");
const rules = readFileSync("artifacts/api-server/src/workers/mediaVariantRules.ts", "utf8");
const hook = readFileSync("artifacts/kub/src/hooks/useMediaVariants.ts", "utf8");

test("a group's picture asks about the chat, because no person owns it", () => {
  // The whole point. Measured before this existed: three group avatars on this
  // deployment totalled 2 586 818 bytes, the largest 2 303 559, drawn into a
  // 48-pixel circle. An `avatar_128` here averages 2 717 bytes.
  assert.deepEqual(avatarVariantSubject(CHAT_ID, null), { profileId: null, chatId: CHAT_ID });
  assert.deepEqual(avatarVariantSubject(CHAT_ID, undefined), { profileId: null, chatId: CHAT_ID });
});

test("a private chat still asks about the person, not the chat", () => {
  // `useChats` replaces a private chat's `avatar_url` with the other member's
  // before an avatar ever sees it, so the variants that match what is on screen
  // are that person's. Asking the chat instead would quietly undo D-029's fix
  // for every private conversation.
  assert.deepEqual(avatarVariantSubject(CHAT_ID, PROFILE_ID), {
    profileId: PROFILE_ID,
    chatId: null,
  });
});

test("only ever one of the two ids is asked about", () => {
  // Two stores, two different columns. Setting both would put a chat id into a
  // query about profiles and leave a private chat taking whichever answer
  // arrived first.
  for (const [chatId, profileId] of [
    [CHAT_ID, PROFILE_ID],
    [CHAT_ID, null],
    [null, PROFILE_ID],
    [null, null],
  ] as const) {
    const subject = avatarVariantSubject(chatId, profileId);
    assert.ok(
      !(subject.profileId && subject.chatId),
      `both ids set for chat=${chatId} profile=${profileId}`,
    );
  }
});

test("a picture nobody owns asks about nothing", () => {
  assert.deepEqual(avatarVariantSubject(null, null), { profileId: null, chatId: null });
});

test("an empty answer does not hide a store that found a picture", () => {
  // A store says "asked, and there is none" with an empty object, not
  // `undefined`. Under `a ?? b` that empty object wins and the original is
  // downloaded even though the other store had the small version.
  const none = {};
  const found = { avatar128Url: "chat-128" };
  assert.deepEqual(pickAvatarVariant(none, found), found);
  assert.deepEqual(pickAvatarVariant(undefined, found), found);
  assert.deepEqual(pickAvatarVariant(found, { avatar128Url: "other-128" }), found);
});

test("with nothing found, an answered nothing is still an answer", () => {
  // Distinguishable from `undefined`, which means "not answered yet" — the
  // caller waits on that rather than starting the original.
  assert.deepEqual(pickAvatarVariant({}, {}), {});
  assert.equal(pickAvatarVariant(undefined, undefined), undefined);
  assert.deepEqual(pickAvatarVariant(undefined, {}), {});
});

test("a variant found only at 256 still counts as found", () => {
  const only256 = { avatar256Url: "chat-256" };
  assert.deepEqual(pickAvatarVariant({}, only256), only256);
});

test("a chat's avatar variant is not cached as though it never changes", () => {
  // `variants/chats/{chat}/{kind}.webp` has nowhere to put a version, so a new
  // group photo overwrites the address. Calling that immutable would show last
  // month's picture until next year.
  const path = `variants/chats/${CHAT_ID}/avatar_128.webp`;
  assert.equal(cacheControlFor(path), REUSED_PATH_CACHE_CONTROL);
  assert.notEqual(cacheControlFor(path), IMMUTABLE_CACHE_CONTROL);
});

test("the worker gives a chat's variant the same lifetime the client expects", () => {
  // Two deployments that cannot share a module. This is what notices when one
  // of them learns about the new prefix and the other does not.
  assert.ok(
    worker.includes('path.startsWith("variants/chats/")'),
    "the worker would upload a chat variant as immutable",
  );
  assert.ok(
    worker.includes(`"${REUSED_PATH_CACHE_CONTROL}"`),
    "the worker lost the reused-path value",
  );
});

test("a chat's variant path is its own, so a chat and a profile cannot collide", () => {
  assert.ok(
    rules.includes("`variants/chats/${chatId}/${kind}.webp`"),
    "chat avatar variants must not share the profiles prefix",
  );
  assert.ok(
    rules.includes("`variants/profiles/${profileId}/${kind}.webp`"),
    "profile avatar variants moved without the chat ones following",
  );
});

test("asking by chat excludes the pictures sent inside that chat", () => {
  // A message variant carries the id of the chat it lives in — that column is
  // the scope for its read policy, not its subject. Without `message_id is
  // null` both queries would return every `image_thumb` in the chat, and the
  // worker would count them when deciding whether the avatar was done.
  for (const [label, source] of [
    ["worker", worker],
    ["client", hook],
  ] as const) {
    assert.ok(
      /is\(\s*"message_id"\s*,\s*null\s*\)/.test(source),
      `${label} asks by chat_id without excluding message variants`,
    );
  }
});

test("the avatar on screen actually asks, rather than deciding for itself", () => {
  // The three tests above prove the helper answers correctly; this is the one
  // that notices if nothing calls it. It can only be a source check — a `.tsx`
  // needs a renderer, and this suite has none — so it asserts the wiring, not
  // the rendering: the component delegates the choice, and the hook it feeds
  // exists to answer for a chat.
  const component = readFileSync("artifacts/kub/src/components/ui/ChatAvatar.tsx", "utf8");
  assert.ok(
    component.includes("avatarVariantSubject(chat.id, profileId)"),
    "ChatAvatar no longer asks which store to use",
  );
  assert.ok(
    component.includes("useChatAvatarVariant("),
    "the picture never asks the chat store, so a group avatar stays original",
  );
  assert.ok(
    hook.includes("export function useChatAvatarVariant"),
    "the hook a chat avatar depends on is gone",
  );
  assert.ok(
    /createAvatarVariantStore\(\s*\(chatIds\)/.test(hook),
    "chat ids are no longer batched through the shared store",
  );
});

test("the migration admits a row that names a chat and no message", () => {
  // The scope check permitted exactly two shapes, so before this every insert
  // of a chat-avatar row was rejected outright.
  assert.ok(
    normalizedMigration.includes(
      "(message_id is null and chat_id is not null and profile_id is null)",
    ),
    "the third shape is missing, so no chat avatar variant can be written",
  );
});

test("the migration keeps the two shapes that already worked", () => {
  for (const shape of [
    "(message_id is not null and chat_id is not null and profile_id is null)",
    "(message_id is null and chat_id is null and profile_id is not null)",
  ]) {
    assert.ok(normalizedMigration.includes(shape), `dropped an existing shape: ${shape}`);
  }
});

test("the migration guards a chat against two ready rows of one kind", () => {
  // The worker replaces a variant by deleting then inserting; two overlapping
  // ticks would otherwise leave two `ready` rows and the client would take
  // whichever came back first. The message and profile rows already have this.
  assert.ok(
    /create unique index[^;]*media_variants_chat_avatar_kind_uidx[^;]*\(\s*chat_id\s*,\s*variant_kind\s*\)/.test(
      normalizedMigration,
    ),
    "no unique index on (chat_id, variant_kind)",
  );
  assert.ok(
    /media_variants_chat_avatar_kind_uidx[^;]*where[^;]*message_id is null/.test(
      normalizedMigration,
    ),
    "the index would collide with the chat's message variants",
  );
  assert.ok(
    /media_variants_chat_avatar_kind_uidx[^;]*where[^;]*status = 'ready'/.test(normalizedMigration),
    "a failed row would block the retry that replaces it",
  );
});

test("the migration adds no read policy, because the right one already exists", () => {
  // `media variants chat members can read` is already
  // `chat_id is not null and is_chat_member(chat_id)`, which is the intended
  // audience. Making these public — as profile avatars are — would be a real
  // exposure: `profiles` is world-readable, `chats` is members-only, so a
  // public row would newly tell a non-member that a chat id has a picture and
  // where to fetch it.
  assert.ok(
    !/create policy/.test(normalizedMigration),
    "a new read policy appeared; chat membership already scopes these rows",
  );
});
