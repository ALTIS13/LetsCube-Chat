import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { avatarUploadPath } from "../../artifacts/kub/src/lib/mediaUpload.ts";

/**
 * A bot's picture is admitted by a storage policy that keys on the path prefix
 * and by a database check that keys on the URL. Both are elsewhere — in
 * Postgres — so what is exercised here is the one piece of the agreement that
 * lives in the client: the path it writes to.
 *
 * Getting it wrong is silent. The upload is refused by RLS, or worse, accepted
 * somewhere the policy did not mean to allow.
 */
function fakeFile(type: string): File {
  return { type, name: "x", size: 1 } as unknown as File;
}

test("a bot's picture goes under its own bot-avatars prefix", () => {
  const botId = "a09d11eb-a5c4-4487-b100-d912326c7f75";
  const path = avatarUploadPath("bot", botId, fakeFile("image/webp"));
  assert.ok(path.startsWith(`bot-avatars/${botId}/`), path);
  assert.ok(path.endsWith(".webp"), path);
});

test("each kind of avatar writes to the prefix its own policy admits", () => {
  // The three prefixes ask three different questions about who may write: your
  // own profile, a chat you administer, a bot you own. Crossing them would let
  // one policy answer for another.
  const id = "a09d11eb-a5c4-4487-b100-d912326c7f75";
  const file = fakeFile("image/png");
  assert.ok(avatarUploadPath("user", id, file).startsWith("avatars/"));
  assert.ok(avatarUploadPath("chat", id, file).startsWith("chat-avatars/"));
  assert.ok(avatarUploadPath("bot", id, file).startsWith("bot-avatars/"));

  const prefixes = new Set(
    (["user", "chat", "bot"] as const).map((kind) => avatarUploadPath(kind, id, file).split("/")[0]),
  );
  assert.equal(prefixes.size, 3, "no two kinds may share a prefix");
});

test("two uploads for the same bot do not collide", () => {
  const botId = "a09d11eb-a5c4-4487-b100-d912326c7f75";
  const first = avatarUploadPath("bot", botId, fakeFile("image/webp"));
  const second = avatarUploadPath("bot", botId, fakeFile("image/webp"));
  assert.notEqual(first, second);
});

test("the management route accepts only a public object under the bot prefix", () => {
  // The route's schema is the first gate and the database check is the second.
  // This pins the first: it must not admit a signed URL, another host, or a
  // path outside the bot-avatar prefix.
  const source = readFileSync(
    "artifacts/api-server/src/bot/managementRoutes.ts",
    "utf8",
  );
  const schema = source.slice(source.indexOf("const avatarInputSchema"));
  assert.ok(
    schema.includes('startsWith("https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/")'),
    "the avatar route no longer pins the public bot-avatar prefix",
  );
  assert.ok(schema.includes(".nullable()"), "clearing a picture must stay possible");
});

test("the migration keeps refusing signed urls and foreign hosts", () => {
  const sql = readFileSync(
    ".migration-backup/supabase/migrations/20260904010000_bot_avatar.sql",
    "utf8",
  );
  // Widening the check to admit a public object must not have relaxed the two
  // rules it was actually there for.
  assert.ok(sql.includes("not like '%/object/sign/%'"), "a signed url must stay refused");
  assert.ok(sql.includes("not like '%token=%'"), "a credential in the query must stay refused");
  assert.ok(
    sql.includes("or avatar_url like 'https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/%'"),
    "the one storage form admitted is the public bot-avatar prefix",
  );
  // And it must not have rewritten the function that guards every other avatar.
  assert.ok(
    !sql.includes("create or replace function public._kub_media_path_allowed"),
    "the shared media path policy must not be rewritten from a partial reading",
  );
});
