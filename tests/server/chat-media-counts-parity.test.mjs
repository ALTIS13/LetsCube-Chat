/**
 * The SQL copy of the media classifier, kept in step with the TypeScript one.
 *
 * `20260904110000_chat_media_counts.sql` had to restate `classifyMessageMedia`
 * and `extractFirstLink` from `artifacts/kub/src/lib/messageMediaSections.ts` in
 * SQL, because a client cannot count rows it has not fetched. That is two copies
 * of one rule, and two copies drift.
 *
 * So this does not read either file and compare their shapes. It loads the real
 * migration into a real PostgreSQL — PGlite, in process, no Docker — and runs
 * both implementations over one corpus of rows. A change to the regex on either
 * side that the other does not follow turns this red on the row that disagrees.
 *
 * The engine is not the deployed one, so on 2026-09-04 the thirty-four
 * primitives this SQL rests on were replayed on production (PostgreSQL 17.6,
 * supabase-db) and on PGlite (PostgreSQL 18.3, wasm32) and agreed on every one:
 * the whitespace class against U+00A0/U+FEFF/U+2028, `$` refusing to match
 * before a trailing newline, `~*` folding Cyrillic, `lower()` folding Cyrillic,
 * `->>` returning null for a non-object, `\U` astral ranges, and `regexp_count`.
 *
 * The same fixture also holds the visibility contract, because the counts are
 * only safe if the function cannot count what the caller could not already
 * read: the schema below carries production's own policies, permissive and
 * restrictive as they really are.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

import {
  buildMessageMediaSections,
  classifyMessageMedia,
  extractFirstLink,
  formatMediaCountLabel,
} from "../../artifacts/kub/src/lib/messageMediaSections.ts";

const rootPath = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATION_RELATIVE = ".migration-backup/supabase/migrations/20260904110000_chat_media_counts.sql";
const migrationSql = readFileSync(path.join(rootPath, MIGRATION_RELATIVE), "utf8");

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const MALLORY = "33333333-3333-4333-8333-333333333333";
const CHAT = "44444444-4444-4444-8444-444444444444";

/**
 * Production's own objects, reduced to what this function touches.
 *
 * The policies are copied from `pg_policy` on 2026-09-04, including which of
 * them is RESTRICTIVE. That detail is the whole test: two PERMISSIVE SELECT
 * policies are OR-ed, so modelling «block banned reads» as permissive would
 * quietly hand every chat to every non-member and the visibility assertions
 * below would pass for the wrong reason.
 */
const FIXTURE_SCHEMA = `
create role anon;
create role authenticated;
create role service_role;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

create table public.bans (user_id uuid primary key, expires_at timestamptz);

create table public.chats (id uuid primary key);

create table public.chat_members (
  chat_id uuid not null,
  user_id uuid not null,
  cleared_at timestamptz,
  primary key (chat_id, user_id)
);

create table public.messages (
  id uuid primary key,
  chat_id uuid not null,
  user_id uuid,
  content text,
  type text,
  media_url text,
  media_metadata jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.message_hidden_for_users (
  message_id uuid not null,
  user_id uuid not null,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create function public.is_banned(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.bans
    where user_id = uid and (expires_at is null or expires_at > now())
  )
$$;

create function public.is_chat_member(cid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.chat_members where chat_id = cid and user_id = auth.uid()
  )
$$;

alter table public.messages enable row level security;
create policy "Chat members can view messages" on public.messages
  for select using (public.is_chat_member(chat_id));
create policy "block banned reads" on public.messages
  as restrictive for select using (not public.is_banned(auth.uid()));

alter table public.chat_members enable row level security;
create policy "chat_members select" on public.chat_members
  for select using ((user_id = auth.uid()) or public.is_chat_member(chat_id));
create policy "block banned reads" on public.chat_members
  as restrictive for select using (not public.is_banned(auth.uid()));

alter table public.message_hidden_for_users enable row level security;
create policy "message_hidden_for_users select own" on public.message_hidden_for_users
  for select using (user_id = (select auth.uid()));

grant usage on schema public to anon, authenticated, service_role;
grant select on public.messages, public.chat_members, public.message_hidden_for_users
  to authenticated;
`;

/**
 * The rows both implementations have to agree about.
 *
 * Every branch of `classifyMessageMedia` is here, and so is every place the two
 * languages could plausibly part company: an empty-string attachment, which is
 * falsy in JavaScript and neither null nor absent in SQL; a `.webm` that is a
 * round video and must not be read as a voice note; the word "voice" in a
 * caption on a photo, where the voice predicate is never consulted; metadata
 * that is not an object at all; a caption whose leading whitespace is a tab or
 * a non-breaking space rather than a space; a link cut at a quote, at a
 * non-breaking space and at a full stop; and `http://` followed by one astral
 * character, where JavaScript counts nine UTF-16 units and SQL counts eight
 * characters.
 */
const CORPUS = [
  { name: "text with no link", type: "text", content: "Просто сообщение" },
  { name: "text with a link", type: "text", content: "смотри https://letscube.ru/a вот" },
  { name: "text with a link at the end of a sentence", type: "text", content: "тут https://letscube.ru/a." },
  { name: "text with a link in brackets", type: "text", content: "(см. https://letscube.ru/a)" },
  { name: "text with a link in guillemets", type: "text", content: "«https://letscube.ru/a»" },
  { name: "text whose link is only a scheme", type: "text", content: "https://." },
  { name: "text whose link is http and one character", type: "text", content: "http://x" },
  { name: "text whose link is http and two characters", type: "text", content: "http://xy" },
  { name: "text whose link is http and one astral character", type: "text", content: "http://\u{1F600}" },
  { name: "text with an uppercase scheme", type: "text", content: "HTTPS://Letscube.RU/a" },
  { name: "text with a quoted link", type: "text", content: 'ссылка "http://letscube.ru/b" тут' },
  { name: "text whose link ends at a non-breaking space", type: "text", content: "http://letscube.ru/b дальше" },
  { name: "text containing the word http and no address", type: "text", content: "поговорим про http позже" },
  { name: "text with a link and an attachment", type: "text", content: "https://letscube.ru/a", media_url: "https://cdn/x.png" },
  { name: "null content text", type: "text", content: null },

  { name: "photo", type: "image", content: "Пляж", media_url: "https://cdn/a.jpg" },
  { name: "photo captioned voice", type: "image", content: "voice memo screenshot", media_url: "https://cdn/a.jpg" },
  { name: "photo captioned голосовое", type: "image", content: "скрин про голосовое", media_url: "https://cdn/a.jpg" },
  { name: "photo whose url looks like a voice note", type: "image", content: null, media_url: "https://cdn/a.ogg" },
  { name: "gif by url", type: "image", content: null, media_url: "https://cdn/a.gif" },
  { name: "gif by uppercase url", type: "image", content: null, media_url: "https://cdn/A.GIF" },
  { name: "gif by caption", type: "image", content: "Cat.gif", media_url: "https://cdn/a.mp4" },
  { name: "image with no attachment", type: "image", content: "подпись", media_url: null },
  { name: "image with an empty attachment", type: "image", content: "подпись", media_url: "" },

  { name: "video", type: "video", content: "Отпуск", media_url: "https://cdn/a.mp4" },
  { name: "round video by metadata kind", type: "video", content: null, media_url: "https://cdn/a.mp4", media_metadata: { kind: "video_message" } },
  { name: "round video by metadata shape", type: "video", content: null, media_url: "https://cdn/a.mp4", media_metadata: { shape: "round" } },
  { name: "round video by caption", type: "video", content: "Видео-сообщение", media_url: "https://cdn/a.mp4" },
  { name: "round video by caption with a duration", type: "video", content: "Видео-сообщение (0:12)", media_url: "https://cdn/a.mp4" },
  { name: "round video by lowercase caption", type: "video", content: "видео-сообщение 0:12", media_url: "https://cdn/a.mp4" },
  { name: "round video whose caption has a leading tab", type: "video", content: "\tВидео-сообщение", media_url: "https://cdn/a.mp4" },
  { name: "round video whose caption has a leading nbsp", type: "video", content: " Видео-сообщение", media_url: "https://cdn/a.mp4" },
  { name: "round video whose caption has a trailing feff", type: "video", content: "Видео-сообщение﻿", media_url: "https://cdn/a.mp4" },
  { name: "video whose caption merely starts with the word", type: "video", content: "Видео-сообщениеX", media_url: "https://cdn/a.mp4" },
  { name: "round video recorded as webm", type: "video", content: "Видео-сообщение", media_url: "https://cdn/a.webm" },
  { name: "webm video that is not round", type: "video", content: "Клип", media_url: "https://cdn/a.webm" },
  { name: "gif filed as video", type: "video", content: null, media_url: "https://cdn/a.gif" },
  { name: "round video with array metadata", type: "video", content: null, media_url: "https://cdn/a.mp4", media_metadata: [1, 2] },
  { name: "round video with string metadata", type: "video", content: null, media_url: "https://cdn/a.mp4", media_metadata: "round" },
  { name: "round video with a numeric kind", type: "video", content: null, media_url: "https://cdn/a.mp4", media_metadata: { kind: 5 } },
  { name: "video with no attachment", type: "video", content: "Видео-сообщение", media_url: null },

  { name: "voice note by extension", type: "audio", content: null, media_url: "https://cdn/a.ogg" },
  { name: "voice note by uppercase extension", type: "audio", content: null, media_url: "https://cdn/A.WEBM" },
  { name: "voice note by extension with a query", type: "audio", content: null, media_url: "https://cdn/a.m4a?token=1" },
  { name: "voice note by extension with a fragment", type: "audio", content: null, media_url: "https://cdn/a.mp3#t=2" },
  { name: "voice note by caption", type: "audio", content: "Голосовое сообщение", media_url: "https://cdn/a.flac" },
  { name: "voice note by english caption", type: "audio", content: "Voice memo", media_url: "https://cdn/a.flac" },
  { name: "attached track", type: "audio", content: "Альбом", media_url: "https://cdn/a.flac" },
  { name: "attached track whose name embeds an extension", type: "audio", content: null, media_url: "https://cdn/a.ogg.flac" },

  { name: "file", type: "file", content: "Отчёт", media_url: "https://cdn/a.pdf" },
  { name: "file with no attachment", type: "file", content: "Отчёт", media_url: null },

  { name: "unknown type", type: "sticker", content: null, media_url: "https://cdn/a.webp" },
  { name: "null type", type: null, content: "https://letscube.ru/a", media_url: "https://cdn/a.webp" },
];

const withDefaults = (row, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  type: row.type ?? null,
  content: row.content ?? null,
  media_url: row.media_url ?? null,
  media_metadata: row.media_metadata ?? null,
});

/** @type {PGlite} */
let db;

before(async () => {
  db = await new PGlite();
  await db.exec(FIXTURE_SCHEMA);
  await db.exec(migrationSql);
});

after(async () => {
  await db?.close();
});

const asUser = async (userId) => {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
};

test("the migration applies without a transaction of its own", () => {
  // A migration that opens its own transaction closes the wrapping one, and the
  // rehearsal that is supposed to roll it back commits instead.
  const executable = migrationSql
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith("--"));
  assert.equal(executable.includes("begin;"), false, "the migration opens its own transaction");
  assert.equal(executable.includes("commit;"), false, "the migration commits its own transaction");
});

test("the classifier and its SQL copy agree on every row of the corpus", async (t) => {
  const disagreements = [];
  for (const [index, entry] of CORPUS.entries()) {
    const row = withDefaults(entry, index);
    const { rows } = await db.query(
      `select public.message_media_kind($1::text, $2::text, $3::text, $4::jsonb) as kind,
              public.message_first_link($2::text) as link`,
      [
        row.type,
        row.content,
        row.media_url,
        row.media_metadata === null ? null : JSON.stringify(row.media_metadata),
      ],
    );
    const sqlKind = rows[0].kind;
    const sqlLink = rows[0].link;
    const jsKind = classifyMessageMedia(row);
    const jsLink = extractFirstLink(row.content);

    if (sqlKind !== jsKind) {
      disagreements.push(`${entry.name}: kind js=${JSON.stringify(jsKind)} sql=${JSON.stringify(sqlKind)}`);
    }
    if (sqlLink !== jsLink) {
      disagreements.push(`${entry.name}: link js=${JSON.stringify(jsLink)} sql=${JSON.stringify(sqlLink)}`);
    }
  }
  t.diagnostic(`${CORPUS.length} rows compared`);
  assert.deepEqual(disagreements, [], `the two copies of the rule have drifted:\n${disagreements.join("\n")}`);
});

test("the corpus actually reaches every kind, so agreeing proves something", () => {
  const reached = new Set(
    CORPUS.map((entry, index) => classifyMessageMedia(withDefaults(entry, index))),
  );
  for (const kind of ["photo", "video", "gif", "file", "link", "voice", "videoMessage", "audio"]) {
    assert.ok(reached.has(kind), `no corpus row classifies as ${kind}`);
  }
  assert.ok(reached.has(null), "no corpus row classifies as nothing");
});

test("the counted totals are the ones the panel would have built from every row", async () => {
  await asUser(null);
  await db.exec("delete from public.messages; delete from public.message_hidden_for_users;");
  await db.query("insert into public.chats (id) values ($1) on conflict do nothing", [CHAT]);
  await db.query(
    "insert into public.chat_members (chat_id, user_id) values ($1, $2), ($1, $3) on conflict do nothing",
    [CHAT, ALICE, BOB],
  );

  // Padded to a teen count on purpose. Eleven to fourteen is where the Russian
  // agreement rule is easiest to get wrong, and a real teen total is only
  // reachable now that the number is a total rather than the page size.
  const rows = [];
  for (const [index, entry] of CORPUS.entries()) rows.push(withDefaults(entry, index));
  for (let extra = 0; extra < 10; extra += 1) {
    rows.push(withDefaults({ type: "image", content: null, media_url: "https://cdn/b.jpg" }, 100 + extra));
  }

  for (const row of rows) {
    await db.query(
      `insert into public.messages (id, chat_id, user_id, content, type, media_url, media_metadata)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        row.id,
        CHAT,
        ALICE,
        row.content,
        row.type,
        row.media_url,
        row.media_metadata === null ? null : JSON.stringify(row.media_metadata),
      ],
    );
  }

  await asUser(ALICE);
  await db.exec("set role authenticated");
  const { rows: counted } = await db.query("select kind, total from public.chat_media_counts($1)", [CHAT]);
  await db.exec("reset role");

  const expected = buildMessageMediaSections(rows);
  assert.deepEqual(
    Object.fromEntries(counted.map((row) => [row.kind, row.total])),
    Object.fromEntries(expected.map((section) => [section.kind, section.count])),
  );

  const photos = counted.find((row) => row.kind === "photo");
  assert.ok(
    photos.total >= 11 && photos.total <= 14,
    `the fixture no longer produces a teen count (${photos.total})`,
  );
  assert.equal(
    formatMediaCountLabel("photo", photos.total),
    `${photos.total} фотографий`,
    "a teen total takes the many form",
  );
});

test("a soft-deleted row is not counted", async () => {
  await asUser(ALICE);
  await db.exec("set role authenticated");
  const before = await db.query("select total from public.chat_media_counts($1) where kind = 'file'", [CHAT]);
  await db.exec("reset role");

  await db.exec("update public.messages set deleted_at = now() where type = 'file' and media_url is not null");
  await asUser(ALICE);
  await db.exec("set role authenticated");
  const after = await db.query("select total from public.chat_media_counts($1) where kind = 'file'", [CHAT]);
  await db.exec("reset role");
  await db.exec("update public.messages set deleted_at = null");

  assert.equal(before.rows[0].total, 1);
  assert.equal(after.rows.length, 0, "a deleted attachment is still counted");
});

test("clearing the history at one end takes the rows off that person's count only", async () => {
  await db.exec("update public.chat_members set cleared_at = now() where user_id = '" + ALICE + "'");

  await asUser(ALICE);
  await db.exec("set role authenticated");
  const alice = await db.query("select kind, total from public.chat_media_counts($1)", [CHAT]);
  await db.exec("reset role");

  await asUser(BOB);
  await db.exec("set role authenticated");
  const bob = await db.query("select kind, total from public.chat_media_counts($1)", [CHAT]);
  await db.exec("reset role");

  await db.exec("update public.chat_members set cleared_at = null");

  assert.deepEqual(alice.rows, [], "the person who cleared the history is still being counted");
  assert.ok(bob.rows.length > 0, "clearing at one end emptied the other end's card");
});

test("a message hidden by one member stays counted for the others", async () => {
  const { rows: files } = await db.query("select id from public.messages where type = 'file' and media_url is not null");
  await db.query(
    "insert into public.message_hidden_for_users (message_id, user_id) values ($1, $2)",
    [files[0].id, ALICE],
  );

  await asUser(ALICE);
  await db.exec("set role authenticated");
  const alice = await db.query("select total from public.chat_media_counts($1) where kind = 'file'", [CHAT]);
  await db.exec("reset role");

  await asUser(BOB);
  await db.exec("set role authenticated");
  const bob = await db.query("select total from public.chat_media_counts($1) where kind = 'file'", [CHAT]);
  await db.exec("reset role");

  await db.exec("delete from public.message_hidden_for_users");

  assert.equal(alice.rows.length, 0, "a row hidden for me is still on my count");
  assert.equal(bob.rows[0].total, 1, "a row hidden for somebody else came off my count");
});

test("someone who is not in the chat counts nothing in it", async () => {
  await asUser(MALLORY);
  await db.exec("set role authenticated");
  const { rows } = await db.query("select kind, total from public.chat_media_counts($1)", [CHAT]);
  const direct = await db.query("select count(*)::int as n from public.messages where chat_id = $1", [CHAT]);
  await db.exec("reset role");

  assert.deepEqual(rows, [], "a non-member was told what the chat contains");
  assert.equal(direct.rows[0].n, 0, "the fixture's own policies do not hide the chat, so the test proves nothing");
});

test("a banned member counts nothing", async () => {
  await db.query("insert into public.bans (user_id) values ($1)", [ALICE]);

  await asUser(ALICE);
  await db.exec("set role authenticated");
  const { rows } = await db.query("select kind, total from public.chat_media_counts($1)", [CHAT]);
  await db.exec("reset role");

  await db.exec("delete from public.bans");
  assert.deepEqual(rows, [], "the restrictive ban policy did not reach the count");
});

test("the count is exactly what the caller could have read row by row", async () => {
  // The claim the migration makes about itself: it discloses nothing that a
  // plain select would not. Counting both ways under the same identity is the
  // only way to assert that rather than assert it in a comment.
  for (const [name, actor] of [["member", ALICE], ["other member", BOB], ["outsider", MALLORY]]) {
    await asUser(actor);
    await db.exec("set role authenticated");
    const counted = await db.query("select kind, total from public.chat_media_counts($1)", [CHAT]);
    const readable = await db.query(
      `select id, type, content, media_url, media_metadata from public.messages
        where chat_id = $1 and deleted_at is null`,
      [CHAT],
    );
    await db.exec("reset role");

    const sections = buildMessageMediaSections(readable.rows);
    assert.deepEqual(
      Object.fromEntries(counted.rows.map((row) => [row.kind, row.total])),
      Object.fromEntries(sections.map((section) => [section.kind, section.count])),
      `${name}: the count and what that identity can actually read disagree`,
    );
  }
});
