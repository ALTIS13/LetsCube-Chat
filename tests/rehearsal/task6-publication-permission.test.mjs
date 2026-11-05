import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { appOutboxHarness, fictionalOutboxEntry, postgrestResponse } from "../helpers/app-outbox-harness.mjs";

const migrations = new URL("../../.migration-backup/supabase/migrations/", import.meta.url);
const membership = "20260504_chats_membership_hardening";
const moderation = "20260504_roles_admin";
const blocks = "20260914120000_personal_blocks_and_reports";
const sender = "20260831100000_bot_platform_foundation";
const stage = new URL("../../docs/proposals/2026-11-06-task6-channel-publication.sql", import.meta.url);
const rollback = new URL("../../docs/proposals/2026-11-06-task6-channel-publication.rollback.sql", import.meta.url);
const stageBaseline = process.env.LETSCUBE_TASK6_STAGE_BASELINE === "1";

function definition(file, start, end = ";") {
  const sql = readFileSync(new URL(`${file}.sql`, migrations), "utf8");
  const from = sql.indexOf(start);
  const to = sql.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing fixture definition: ${start}`);
  return sql.slice(from, to + end.length);
}
const fn = (file, name) => definition(file, `create or replace function public.${name}(`, "$$;");
const triggerFn = (file, name) => definition(file, `create or replace function private.${name}(`, "$function$;");
const policy = (file, name) => definition(file, `create policy "${name}"`);

// Only the text INSERT/SELECT boundary is reproduced. No notifier, gateway,
// Auth server, real credentials, sockets, or persisted database are used.
const schema = `
  create role anon nologin nobypassrls;
  create role authenticated nologin nobypassrls;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema private;
  grant usage on schema auth to authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  $$;
  create type public.chat_member_role as enum ('owner', 'admin', 'member');
  create table public.chats (id uuid primary key, type text not null, created_by uuid, created_at timestamptz);
  create table public.profiles (id uuid primary key);
  create table public.chat_members (
    chat_id uuid not null references public.chats(id), user_id uuid not null,
    role public.chat_member_role not null, cleared_at timestamptz, primary key (chat_id, user_id)
  );
  create table public.bans (user_id uuid, expires_at timestamptz);
  create table public.mutes (user_id uuid, chat_id uuid, expires_at timestamptz);
  create table public.user_blocks (blocker_id uuid, blocked_id uuid);
  create table public.messages (
    id uuid primary key default gen_random_uuid(),
    chat_id uuid not null references public.chats(id),
    user_id uuid references public.profiles(id) on delete set null, bot_id uuid,
    client_message_id uuid unique, type text not null, content text,
    created_at timestamptz not null default now(), client_sent_at timestamptz,
    topic_id uuid, edited_at timestamptz, deleted_at timestamptz, pinned boolean default false,
    reply_to_id uuid references public.messages(id) on delete set null,
    forwarded_from_id uuid references public.messages(id) on delete set null,
    media_url text, media_bucket text, media_path text, media_metadata jsonb, system_payload jsonb
  );
  create table public.topics (id uuid primary key, chat_id uuid references public.chats(id));
  create table public.message_hidden_for_users (message_id uuid, user_id uuid);
  create table public.media_variants (
    message_id uuid, chat_id uuid, owner_id uuid, profile_id uuid, source_bucket text, source_path text,
    variant_kind text, variant_bucket text, variant_path text, mime_type text, width int, height int,
    size_bytes bigint, status text
  );
  alter table public.chats enable row level security;
  alter table public.chat_members enable row level security;
  alter table public.messages enable row level security;
  grant select, insert, update on public.messages to authenticated;
  ${fn(membership, "is_chat_member")}
  ${fn(moderation, "is_banned")}
  ${fn(moderation, "is_muted")}
  ${fn(blocks, "blocked_from_chat")}
  ${policy(membership, "Chat members can view messages")}
  ${policy(sender, "Chat members can send messages")}
  ${policy(moderation, "block muted/banned from sending")}
  ${policy(blocks, "block writes to someone who refused you")}
  -- The roles migration generates these two in a loop.
  create policy "block banned writes (insert)" on public.messages as restrictive for insert
    with check (not public.is_banned(auth.uid()));
  create policy "block banned reads" on public.messages as restrictive for select
    using (not public.is_banned(auth.uid()));
  create policy "Users can edit own messages" on public.messages for update using (user_id=auth.uid());

  ${triggerFn("20260930170000_a_chat_keeps_its_kind", "chats_identity_is_fixed")}
  create trigger trg_chats_identity_is_fixed before update on public.chats
    for each row execute function private.chats_identity_is_fixed();
  ${triggerFn(sender, "enforce_message_sender_on_insert")}
  ${triggerFn(sender, "enforce_message_sender_on_update")}
  ${triggerFn(sender, "mark_profile_delete_message_tombstones")}
  create trigger trg_messages_sender_on_insert before insert on public.messages
    for each row execute function private.enforce_message_sender_on_insert();
  create trigger trg_messages_sender_on_update before update of user_id, bot_id, type on public.messages
    for each row execute function private.enforce_message_sender_on_update();
  create trigger trg_profiles_mark_message_tombstones before delete on public.profiles
    for each row execute function private.mark_profile_delete_message_tombstones();

  ${definition("20260911144000_forward_message_with_media",
    "create or replace function public.forward_message(", "$function$;")}
  revoke all on function public.forward_message(uuid,uuid,uuid,timestamptz,uuid) from public;
  grant execute on function public.forward_message(uuid,uuid,uuid,timestamptz,uuid) to authenticated;

  -- Same last-write boundary as the bot RPC. Gateway admission, idempotency
  -- and media upload/storage are deliberately outside this adapter.
  create function public.task6_bot_writer(chat uuid, bot uuid, client_id uuid) returns uuid
    language sql security definer set search_path='' as $$
      insert into public.messages(chat_id, bot_id, client_message_id, type, content)
      values (chat, bot, client_id, 'text', 'Fictional bot text') returning id
    $$;
  revoke all on function public.task6_bot_writer(uuid,uuid,uuid) from public;
  grant execute on function public.task6_bot_writer(uuid,uuid,uuid) to service_role;
`;

async function asActor(db, actor, sql, params, role = "authenticated") {
  assert.ok(["authenticated", "service_role"].includes(role));
  await db.exec("savepoint actor_request");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: actor, role })]);
    await db.exec(`set local role ${role}`);
    const { rows: [identity] } = await db.query(
      "select current_user as role, auth.uid() as uid, row_security_active('public.messages') as rls");
    assert.deepEqual(identity, { role, uid: actor, rls: role === "authenticated" });
    const result = await db.query(sql, params);
    await db.exec("reset role; release savepoint actor_request");
    return result.rows;
  } catch (error) {
    await db.exec("rollback to savepoint actor_request; release savepoint actor_request");
    throw error;
  }
}

const readMessage = (db, actor, chat, author, id) => asActor(db, actor,
  "select id, chat_id, user_id, client_message_id from public.messages where chat_id=$1 and user_id=$2 and client_message_id=$3",
  [chat, author, id]);

async function send(db, entry) {
  const posts = [];
  const faults = [];
  const h = appOutboxHarness({ async fetch(input, init) {
    try {
      const request = new Request(input, init);
      const url = new URL(request.url);
      assert.equal(url.origin, "http://127.0.0.1:54321");
      if (request.method === "PATCH") {
        // The outbox's unrelated recency update is not part of this fixture.
        assert.equal(url.pathname, "/rest/v1/chats");
        assert.equal(url.searchParams.get("id"), `eq.${entry.chatId}`);
        return new Response(null, { status: 204 });
      }
      assert.equal(url.pathname, "/rest/v1/messages");
      assert.ok(url.searchParams.has("select"));
      if (request.method === "GET") {
        for (const [key, value] of Object.entries({
          chat_id: entry.chatId, user_id: entry.userId, client_message_id: entry.clientMessageId,
        })) assert.equal(url.searchParams.get(key), `eq.${value}`);
        return postgrestResponse(200, await readMessage(db, entry.userId, entry.chatId, entry.userId, entry.clientMessageId));
      }
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("prefer"), "return=representation");
      const body = await request.json();
      assert.deepEqual(body, {
        chat_id: entry.chatId, user_id: entry.userId, client_message_id: entry.clientMessageId,
        client_sent_at: entry.clientSentAt, type: "text", content: entry.content,
        topic_id: null, reply_to_id: null, forwarded_from_id: null,
        media_bucket: null, media_path: null, media_url: null,
      });
      try {
        const [row] = await asActor(db, entry.userId,
          `insert into public.messages (chat_id, user_id, client_message_id, client_sent_at, type, content)
           values ($1, $2, $3, $4, $5, $6) returning *`,
          [body.chat_id, body.user_id, body.client_message_id, body.client_sent_at, body.type, body.content]);
        posts.push({ status: 201, code: null });
        return postgrestResponse(201, row);
      } catch (error) {
        if (error.code !== "42501" || !(
          error.message.includes('row-level security policy for table "messages"') ||
          error.message === "channel_publication_forbidden"
        )) throw error;
        posts.push({ status: 403, code: error.code });
        return postgrestResponse(403, { code: error.code, message: error.message });
      }
    } catch (error) {
      faults.push(error);
      throw error;
    }
  } });
  try {
    h.show(entry);
    await h.outbox.start(entry.userId);
    const outcome = await h.outbox.enqueue(entry);
    assert.equal(faults.length, 0, "adapter or setup errors are not RLS refusals");
    assert.equal(posts.length, 1, "one actual SDK POST per attempt");
    const { rows } = await db.query(
      "select id, chat_id, user_id from public.messages where client_message_id=$1", [entry.clientMessageId]);
    if (posts[0].status === 201) {
      assert.equal(outcome.kind, "sent");
      assert.deepEqual(rows, [{ id: outcome.row.id, chat_id: entry.chatId, user_id: entry.userId }]);
    } else {
      assert.equal(outcome.kind, "refused");
      assert.deepEqual(rows, []);
    }
    return posts[0];
  } finally {
    h.close();
  }
}

test("Task6 text publication: role boundary on one fictional channel", { timeout: 30000 }, async t => {
  const db = new PGlite();
  const [chat, owner, reader] = Array.from({ length: 3 }, () => randomUUID());
  const entry = userId => fictionalOutboxEntry({
    userId, chatId: chat, clientMessageId: randomUUID(), tempId: randomUUID(),
    clientSentAt: new Date().toISOString(), content: "Fictional Task6 publication",
  });
  const published = entry(owner);
  const allowed = { status: 201, code: null };
  const denied = { status: 403, code: "42501" };
  try {
    await db.exec(schema);
    await db.exec("begin");
    try {
      await db.query("insert into public.profiles(id) values ($1), ($2)", [owner, reader]);
      await db.query("insert into public.chats(id, type) values ($1, 'channel')", [chat]);
      await db.query("insert into public.chat_members(chat_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')",
        [chat, owner, reader]);
      await t.test("publisher control: channel owner can publish", async () => {
        assert.deepEqual(await send(db, published), allowed);
      });
      await t.test("reader control: ordinary member can read the exact owner publication", async () => {
        const rows = await readMessage(db, reader, chat, owner, published.clientMessageId);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].user_id, owner);
      });
      const observed = await send(db, entry(reader));
      t.diagnostic(`member POST mapped status=${observed.status}, SQLSTATE=${observed.code ?? "none"}`);
      await t.test("publication gate: ordinary member cannot publish", {
        skip: process.env.LETSCUBE_TASK6_REQUIRE_READER_DENIAL !== "1" && "opt-in acceptance gate; current RLS is role-neutral",
      }, () => assert.deepEqual(observed, denied, "reader must be denied while still a member"));
      await t.test("removal control: same reader loses both read and write after membership removal", async () => {
        const removed = await db.query(
          "delete from public.chat_members where chat_id=$1 and user_id=$2 and role='member' returning user_id", [chat, reader]);
        assert.deepEqual(removed.rows, [{ user_id: reader }]);
        assert.deepEqual(await readMessage(db, reader, chat, owner, published.clientMessageId), []);
        assert.deepEqual(await send(db, entry(reader)), denied);
      });
    } finally {
      await db.exec("rollback");
    }
    const { rows: [counts] } = await db.query(`select
      (select count(*)::int from public.chats) as chats,
      (select count(*)::int from public.chat_members) as memberships,
      (select count(*)::int from public.messages) as messages`);
    assert.deepEqual(counts, { chats: 0, memberships: 0, messages: 0 });
    t.diagnostic("fixture rollback verified: 0 chats, memberships, messages");
  } finally {
    await db.close();
  }
});

test("Task6 staged publication: all producers converge on current channel authority", { timeout: 30000 }, async t => {
  const db = new PGlite();
  const [channel, group, dm, micro, topic, owner, admin, reader, outsider, bot] =
    Array.from({ length: 10 }, () => randomUUID());
  const entry = (userId, chatId = channel) => fictionalOutboxEntry({
    userId, chatId, clientMessageId: randomUUID(), tempId: randomUUID(),
    clientSentAt: new Date().toISOString(), content: "Fictional Task6 staged publication",
  });
  const allowed = { status: 201, code: null };
  const denied = { status: 403, code: "42501" };
  const publicationError = { code: "42501", message: "channel_publication_forbidden" };
  const write = (actor, chat, { kind = "text", author = actor, scope = null } = {}) =>
    asActor(db, actor, `insert into public.messages(chat_id, user_id, topic_id, type, content, media_path)
      values ($1, $2, $3, $4, 'Fictional text', case when $4='image' then 'fictional.png' end) returning id`,
    [chat, author, scope, kind]);
  const forward = (actor, source, target, id, scope = null) => asActor(db, actor,
    "select id, forwarded_from_id, media_path, topic_id from public.forward_message($1,$2,$3,null,$4)",
    [source, target, id, scope]);
  const botWrite = (target, id) => asActor(db, null,
    "select public.task6_bot_writer($1,$2,$3)", [target, bot, id], "service_role");
  const find = id => db.query("select id from public.messages where client_message_id=$1", [id]);
  const edit = (actor, id, content) => asActor(db, actor,
    "update public.messages set content=$2,edited_at=now() where id=$1 returning id", [id, content]);

  try {
    await db.exec(schema);
    if (!stageBaseline) await db.exec(readFileSync(stage, "utf8"));
    await db.exec("begin");
    try {
      for (const actor of [owner, admin, reader, outsider]) {
        await db.query("insert into public.profiles(id) values ($1)", [actor]);
      }
      for (const [chat, kind] of [[channel, "channel"], [group, "group"], [dm, "private"], [micro, "dm_group"]]) {
        await db.query("insert into public.chats(id,type) values ($1,$2)", [chat, kind]);
        await db.query("insert into public.chat_members(chat_id,user_id,role) values ($1,$2,'owner'),($1,$3,'admin'),($1,$4,'member')",
          [chat, owner, admin, reader]);
      }
      await db.query("insert into public.topics values ($1,$2)", [topic, group]);
      const published = entry(owner);
      const [{ id: source }] = await write(owner, group, { kind: "image", scope: topic });
      const [{ id: ownGroupRow }] = await write(reader, group, { scope: topic });
      await t.test("owner and admin publish through the actual outbox; a member reads but cannot write", async () => {
        assert.deepEqual(await send(db, published), allowed);
        assert.deepEqual(await send(db, entry(admin)), allowed);
        assert.equal((await readMessage(db, reader, channel, owner, published.clientMessageId)).length, 1);
        assert.deepEqual(await send(db, entry(reader)), denied);
      });
      await t.test("outsider, mismatched JWT author and direct reader media cannot publish", async () => {
        await assert.rejects(write(reader, channel, { kind: "image" }), publicationError);
        await assert.rejects(write(outsider, channel), { code: "42501" });
        await assert.rejects(write(reader, channel, { author: owner }), { code: "42501" });
        assert.equal((await write(admin, channel, { kind: "image" })).length, 1);
      });
      await t.test("real SECURITY DEFINER media forward obeys the target only and preserves old ACKs", async () => {
        const retry = randomUUID(), deniedId = randomUUID();
        const [accepted] = await forward(admin, source, channel, retry);
        assert.equal(accepted.forwarded_from_id, source);
        assert.equal(accepted.media_path, "fictional.png");
        await assert.rejects(forward(reader, source, channel, deniedId), publicationError);
        assert.deepEqual((await find(deniedId)).rows, []);
        await db.query("update public.chat_members set role='member' where chat_id=$1 and user_id=$2", [channel, admin]);
        assert.deepEqual(await forward(admin, source, channel, retry), [accepted]);
        await assert.rejects(forward(admin, source, channel, randomUUID()), publicationError);
        const [outbound] = await forward(reader, accepted.id, group, randomUUID(), topic);
        assert.equal(outbound.forwarded_from_id, accepted.id);
        assert.equal(outbound.topic_id, topic);
      });
      await t.test("group topic, private DM, Group chat and their usual bot writer remain unchanged", async () => {
        assert.equal((await write(reader, group, { scope: topic })).length, 1);
        for (const chat of [dm, micro]) assert.equal((await write(reader, chat)).length, 1);
        for (const chat of [group, dm, micro]) {
          const id = randomUUID();
          await botWrite(chat, id);
          assert.equal((await find(id)).rows.length, 1);
        }
        const id = randomUUID();
        await assert.rejects(botWrite(channel, id), publicationError);
        assert.deepEqual((await find(id)).rows, []);
      });
      await t.test("reader cannot move a row into a channel or edit a former publication", async () => {
        await assert.rejects(asActor(db, reader,
          "update public.messages set chat_id=$1 where id=$2 returning id", [channel, ownGroupRow]), publicationError);
        const [{ id }] = await readMessage(db, owner, channel, owner, published.clientMessageId);
        assert.deepEqual(await edit(owner, id, "Fictional edit"), [{ id }]);
        await db.query("update public.chat_members set role='member' where chat_id=$1 and user_id=$2", [channel, owner]);
        await assert.rejects(edit(owner, id, "Fictional after demotion"), publicationError);
        await assert.rejects(write(owner, channel), publicationError);
        await assert.rejects(asActor(db, owner,
          "update public.messages set chat_id=$1 where id=$2 returning id", [group, id]), publicationError);
        await assert.rejects(asActor(db, owner,
          "update public.messages set deleted_at=now(),content='Fictional bypass' where id=$1 returning id", [id]), publicationError);
        assert.deepEqual(await asActor(db, owner,
          "update public.messages set deleted_at=now() where id=$1 returning id", [id]), [{ id }]);
        await assert.rejects(asActor(db, owner,
          "update public.messages set deleted_at=null where id=$1 returning id", [id]), publicationError);
        await db.query("delete from public.profiles where id=$1", [owner]);
        assert.equal((await db.query("select user_id from public.messages where id=$1", [id])).rows[0].user_id, null);
      });
      await t.test("trusted sender-less system write survives; an API member cannot spoof it", async () => {
        const insert = "insert into public.messages(chat_id,type,content) values ($1,'system','Fictional join')";
        await db.query(insert, [channel]);
        await assert.rejects(asActor(db, reader, insert, [channel]), { code: "42501" });
        await assert.rejects(write(reader, channel, { kind: "system" }), { code: "23514" });
      });
    } finally {
      await db.exec("rollback");
    }
    if (!stageBaseline) {
      await t.test("rollback preserves staged rows and restores the baseline", async () => {
        await db.exec("begin");
        try {
          await db.query("insert into public.profiles(id) values ($1),($2)", [reader, owner]);
          await db.query("insert into public.chats(id,type) values ($1,'channel')", [channel]);
          await db.query("insert into public.chat_members(chat_id,user_id,role) values ($1,$2,'member'),($1,$3,'owner')",
            [channel, reader, owner]);
          await write(owner, channel);
          await assert.rejects(write(reader, channel), publicationError);
          await db.exec("commit");
        } catch (error) {
          await db.exec("rollback");
          throw error;
        }
        const snapshot = () => db.query("select * from public.messages where chat_id=$1", [channel]);
        const before = (await snapshot()).rows;
        assert.equal(before.length, 1);
        await db.exec(readFileSync(rollback, "utf8"));
        assert.deepEqual((await snapshot()).rows, before);
        await db.exec("begin");
        try {
          assert.equal((await write(reader, channel)).length, 1);
        } finally {
          await db.exec("rollback");
        }
        await db.query("delete from public.messages where id=$1 and chat_id=$2", [before[0].id, channel]);
        await db.query("delete from public.chat_members where chat_id=$1 and user_id in ($2,$3)", [channel, reader, owner]);
        await db.query("delete from public.chats where id=$1", [channel]);
        await db.query("delete from public.profiles where id in ($1,$2)", [reader, owner]);
      });
    }
    const { rows: [counts] } = await db.query(`select
      (select count(*)::int from public.chats) as chats,
      (select count(*)::int from public.chat_members) as memberships,
      (select count(*)::int from public.messages) as messages,
      (select count(*)::int from public.profiles) as profiles`);
    assert.deepEqual(counts, { chats: 0, memberships: 0, messages: 0, profiles: 0 });
  } finally {
    await db.close();
  }
});

test("Task6 staged SQL aborts atomically on usage, prestate or guard drift", {
  skip: stageBaseline,
  timeout: 30000,
}, async t => {
  const db = new PGlite();
  const sql = readFileSync(stage, "utf8");
  const scope = randomUUID();
  const rejectStage = async (candidate, message) => {
    try {
      await assert.rejects(db.exec(candidate), { message });
    } finally {
      await db.exec("rollback");
    }
    const { rows: [state] } = await db.query(`select
      to_regprocedure('private.guard_task6_channel_publication()') is null as no_function,
      not exists(select 1 from pg_trigger where tgname='trg_00_task6_channel_publication') as no_trigger`);
    assert.deepEqual(state, { no_function: true, no_trigger: true });
  };
  try {
    await db.exec(schema);
    await t.test("an existing channel forces a fresh usage review", async () => {
      await db.query("insert into public.chats(id,type) values ($1,'channel')", [scope]);
      await rejectStage(sql, "task6_channel_usage_requires_review");
      assert.equal((await db.query("select count(*)::int as n from public.chats where id=$1", [scope])).rows[0].n, 1);
      await db.query("delete from public.chats where id=$1", [scope]);
    });
    await t.test("an unexpected permissive writer refuses the prestate", async () => {
      await db.exec("create policy fixture_writer on public.messages for insert with check (true)");
      await rejectStage(sql, "task6_channel_publication_prestate_drift");
      await db.exec("drop policy fixture_writer on public.messages");
    });
    for (const [name, from, to] of [
      ["invoker", "VOLATILE SECURITY DEFINER", "VOLATILE SECURITY INVOKER"],
      ["missing update", "BEFORE INSERT OR UPDATE ON public.messages", "BEFORE INSERT ON public.messages"],
      ["public execute", "FROM PUBLIC, anon, authenticated, service_role", "FROM anon, authenticated, service_role"],
    ]) {
      await t.test(`self-check rejects ${name}`, async () => {
        const candidate = sql.replace(from, to);
        assert.notEqual(candidate, sql);
        await rejectStage(candidate, "task6_channel_publication_selfcheck_failed");
      });
    }
  } finally {
    await db.close();
  }
});
