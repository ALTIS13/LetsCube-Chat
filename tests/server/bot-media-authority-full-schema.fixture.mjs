import assert from "node:assert/strict";
import { installAuthorityRepair } from "./bot-media-authority-repair.fixture.mjs";
import { installFullSchemaRepair, mutateFullSchemaRepair } from "./bot-media-authority-full-schema-repair.fixture.mjs";
import { quote } from "./bot-media-coverage.fixture.mjs";

// Transport and isolation are supplied by the operator; never selects a host or
// loads credentials. All changes, including bootstrap, live in one rollback.
export const fullSchemaIds = {
  actor: "e5070000-0000-4000-8000-000000000001",
  outsider: "e5070000-0000-4000-8000-000000000002",
  bot: "e5070000-0000-4000-8000-000000000003",
  sourceChat: "e5070000-0000-4000-8000-000000000004",
  targetChat: "e5070000-0000-4000-8000-000000000005",
  source: "e5070000-0000-4000-8000-000000000006",
  reply: "e5070000-0000-4000-8000-000000000007",
  topic: "e5070000-0000-4000-8000-000000000008",
};
const q = fullSchemaIds;
export const fullSchemaSeed = `
  reset role; set request.jwt.claim.sub='';
  insert into public.registration_invites(code,label,max_uses)
    values ('FICTIONAL_AUTHORITY_20261003','Fictional authority fixture',2);
  insert into auth.users(id,raw_user_meta_data) values
    ('${q.actor}','{"full_name":"Fictional authority actor","invite_code":"FICTIONAL_AUTHORITY_20261003"}'),
    ('${q.outsider}','{"full_name":"Fictional authority outsider","invite_code":"FICTIONAL_AUTHORITY_20261003"}');
  insert into public.chats(id,type,name,created_by,is_forum) values
    ('${q.sourceChat}','group','Fictional source','${q.actor}',true),
    ('${q.targetChat}','group','Fictional target','${q.actor}',true);
  insert into public.bots(id,username,display_name) values
    ('${q.bot}','fictional_authority_bot','Fictional authority bot');
  insert into public.chat_bot_members(chat_id,bot_id,privacy_mode,joined_at) values
    ('${q.sourceChat}','${q.bot}','full',now()-interval '1 hour'),
    ('${q.targetChat}','${q.bot}','full',now()-interval '1 hour');
  insert into public.topics(id,chat_id,name) values ('${q.topic}','${q.sourceChat}','Fictional topic');
  insert into public.messages(id,chat_id,bot_id,type,content) values
    ('${q.reply}','${q.sourceChat}','${q.bot}','text','Fictional reply');
  insert into public.messages(id,chat_id,user_id,type,media_bucket,media_path,reply_to_id) values
    ('${q.source}','${q.sourceChat}','${q.actor}','file','chat-media',
      '${q.actor}/fictional-authority.pdf','${q.reply}');
`;
export const forwardCall = (key = "e5070000-0000-4000-8000-000000000020") =>
  `select to_jsonb(public.forward_message('${q.source}','${q.targetChat}','${key}',now(),null))`;
export const sendCall = (key, payload = { file_id: q.source }) =>
  `select public.bot_send_message_internal('${q.bot}','${q.sourceChat}','sendDocument',${quote(JSON.stringify(payload))}::jsonb,${quote(key)})`;

async function expectState(db, statement, state) {
  const [row] = await db.query(`select pg_temp.authority_outcome(${quote(
    `do $proof$ begin ${statement}; end $proof$;`)} ) as state`);
  assert.equal(row.state, state, "literal SQLSTATE, never a setup-error substitute");
}

export async function fullSchemaCatalog(db) {
  return db.query(`select p.oid::regprocedure::text as signature,
    pg_get_userbyid(p.proowner) as owner,p.provolatile,p.prosecdef,p.proconfig,
    has_function_privilege('anon',p.oid,'execute') as anon,
    has_function_privilege('authenticated',p.oid,'execute') as authenticated,
    has_function_privilege('service_role',p.oid,'execute') as service_role
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='fixture_authority' order by p.proname`);
}

export async function runFullSchemaAuthority(db, { check, baseline = false, preinstalled = false, mutant }) {
  await db.exec("begin; set local statement_timeout='20s'; set local lock_timeout='2s';");
  try {
    await db.exec(`create temporary table authority_marker(id integer);
      create function pg_temp.authority_outcome(statement text) returns text language plpgsql as $$
        begin execute statement; return '00000'; exception when others then return sqlstate; end $$;`);
    if (!preinstalled) await db.exec(fullSchemaSeed);
    if (!baseline && !preinstalled) {
      await installAuthorityRepair(db, { forward: true });
      if (process.env.BOT_MEDIA_AUTHORITY_FULL_REPAIR !== "0") await installFullSchemaRepair(db);
    }
    if (mutant) await mutateFullSchemaRepair(db, mutant);
    async function isolated(name, run) {
      await db.exec("savepoint authority_case; reset role; set request.jwt.claim.sub='';");
      try { await check(name, run); }
      finally { await db.exec("rollback to authority_case; release authority_case;"); }
    }
    if (!baseline) await isolated("private exact catalog and actual client denials", async () => {
      const catalog = await fullSchemaCatalog(db);
      assert.equal(catalog.length, process.env.BOT_MEDIA_AUTHORITY_FULL_REPAIR === "0" ? 5 : 9);
      for (const row of catalog) assert.deepEqual(
        { owner: row.owner, volatile: row.provolatile, definer: row.prosecdef, config: row.proconfig,
          anon: row.anon, authenticated: row.authenticated, service_role: row.service_role },
        { owner: "postgres", volatile: "v", definer: true, config: ['search_path=""'],
          anon: false, authenticated: false, service_role: false });
      for (const role of ["anon", "authenticated", "service_role"]) {
        await db.exec(`set local role ${role};`);
        await expectState(db, `perform fixture_authority.bot_target_current('${q.bot}','${q.sourceChat}')`, "42501");
        await db.exec("reset role;");
      }
    });
    await isolated("real file-id send and cached return", async () => {
      await db.exec("set local role service_role;");
      const first = (await db.query(sendCall("authority-full-send")))[0].bot_send_message_internal;
      const cached = (await db.query(sendCall("authority-full-send")))[0].bot_send_message_internal;
      assert.equal(first.duplicate, false); assert.equal(cached.duplicate, true);
      assert.equal(cached.message_id, first.message_id);
    });
    await isolated("real forward RPC succeeds with complete triggers", async () => {
      await db.exec(`set local role authenticated; set request.jwt.claim.sub='${q.actor}';`);
      const [row] = await db.query(forwardCall());
      assert.equal(row.to_jsonb.chat_id, q.targetChat);
      assert.equal(row.to_jsonb.forwarded_from_id, q.source);
    });
    await isolated("authenticated legacy forward table fallback has real RLS", async () => {
      await db.exec(`set local role authenticated; set request.jwt.claim.sub='${q.actor}';`);
      await db.exec(`insert into public.messages(id,chat_id,user_id,type,media_bucket,media_path,forwarded_from_id)
        values ('e5070000-0000-4000-8000-000000000021','${q.targetChat}','${q.actor}','file',
        'chat-media','${q.actor}/fictional-authority.pdf','${q.source}');`);
      assert.equal((await db.query("select count(*)::int as n from public.messages where id='e5070000-0000-4000-8000-000000000021'"))[0].n, 1);
      await db.exec(`set request.jwt.claim.sub='${q.outsider}';`);
      await expectState(db, `insert into public.messages(chat_id,user_id,type,content)
        values ('${q.targetChat}','${q.outsider}','text','fictional')`, "42501");
    });
    for (const [name, change, state] of [
      ["hidden source", `insert into public.message_hidden_for_users(message_id,user_id) values ('${q.source}','${q.actor}')`, "P0002"],
      ["cleared history", `update public.chat_members set cleared_at=now()+interval '1 hour' where chat_id='${q.sourceChat}' and user_id='${q.actor}'`, "P0002"],
      ["real active ban", `insert into public.bans(user_id,reason) values ('${q.actor}','fictional')`, "42501"],
      ["real target mute", `insert into public.mutes(user_id,chat_id,reason) values ('${q.actor}','${q.targetChat}','fictional')`, "42501"],
      ["real global mute", `insert into public.mutes(user_id,reason) values ('${q.actor}','fictional')`, "42501"],
    ]) await isolated(name, async () => {
      await db.exec(change + ";");
      await db.exec(`set local role authenticated; set request.jwt.claim.sub='${q.actor}';`);
      await expectState(db, "perform public.forward_message(" +
        `'${q.source}','${q.targetChat}',null,null,null)`, state);
    });
    await isolated("expired sanctions do not prohibit a forward", async () => {
      await db.exec(`insert into public.bans(user_id,reason,expires_at) values ('${q.actor}','fictional',now()-interval '1 hour');
        insert into public.mutes(user_id,chat_id,reason,expires_at) values ('${q.actor}','${q.targetChat}','fictional',now()-interval '1 hour');
        set local role authenticated; set request.jwt.claim.sub='${q.actor}';`);
      const [row] = await db.query(forwardCall()); assert.equal(row.to_jsonb.chat_id, q.targetChat);
    });
    await isolated("restricted bot source reply loses authority", async () => {
      await db.exec(`update public.chat_bot_members set privacy_mode='restricted' where bot_id='${q.bot}' and chat_id='${q.sourceChat}';`);
      assert.equal((await db.query(`select private.bot_can_receive_message('${q.bot}','${q.source}') as readable`))[0].readable, true);
      await db.exec(`update public.messages set reply_to_id=null where id='${q.source}';`);
      assert.equal((await db.query(`select private.bot_can_receive_message('${q.bot}','${q.source}') as readable`))[0].readable, false);
      await db.exec("set local role service_role;");
      await expectState(db, `perform public.bot_send_message_internal('${q.bot}','${q.sourceChat}','sendDocument',
        '{"file_id":"${q.source}"}','authority-full-restricted')`, "P0002");
    });
    await isolated("actual open and archived topic semantics", async () => {
      await db.exec("set local role service_role;");
      assert.equal((await db.query(sendCall("authority-full-topic", { file_id: q.source, topic_id: q.topic })))[0].bot_send_message_internal.duplicate, false);
      await db.exec(`reset role; update public.topics set archived=true where id='${q.topic}'; set local role service_role;`);
      await expectState(db, `perform public.bot_send_message_internal('${q.bot}','${q.sourceChat}','sendDocument',
        '{"file_id":"${q.source}","topic_id":"${q.topic}"}','authority-full-archived')`, "42501");
    });
    await isolated("cached send refuses changed allowed target", async () => {
      await db.exec("set local role service_role;");
      await db.query(sendCall("authority-full-cache-binding"));
      await expectState(db, `perform public.bot_send_message_internal('${q.bot}','${q.targetChat}','sendDocument',
        '{"file_id":"${q.source}"}','authority-full-cache-binding')`, "23505");
    });
    await isolated("private recipient block rejects RPC like the table route", async () => {
      await db.exec(`insert into public.chats(id,type,created_by) values
        ('e5070000-0000-4000-8000-000000000030','private','${q.actor}');
        insert into public.chat_members(chat_id,user_id) values
        ('e5070000-0000-4000-8000-000000000030','${q.outsider}');
        insert into public.user_blocks(blocker_id,blocked_id) values ('${q.outsider}','${q.actor}');
        set local role authenticated; set request.jwt.claim.sub='${q.actor}';`);
      await expectState(db, `insert into public.messages(chat_id,user_id,type,content)
        values ('e5070000-0000-4000-8000-000000000030','${q.actor}','text','fictional')`, "42501");
      await expectState(db, `perform public.forward_message('${q.source}',
        'e5070000-0000-4000-8000-000000000030',null,null,null)`, "42501");
    });
    await isolated("hidden source rejects a stale direct fallback payload", async () => {
      await db.exec(`insert into public.message_hidden_for_users(message_id,user_id)
        values ('${q.source}','${q.actor}');
        set local role authenticated; set request.jwt.claim.sub='${q.actor}';`);
      await expectState(db, `insert into public.messages(chat_id,user_id,type,media_bucket,media_path,forwarded_from_id)
        values ('${q.targetChat}','${q.actor}','file','chat-media','${q.actor}/fictional-authority.pdf','${q.source}')`, "P0002");
    });
    await isolated("profile cascade keeps legitimate sanction cleanup working", async () => {
      await db.exec(`insert into public.bans(user_id,reason) values ('${q.outsider}','fictional cascade');
        insert into public.mutes(user_id,chat_id,reason) values ('${q.outsider}','${q.targetChat}','fictional cascade');
        insert into public.user_blocks(blocker_id,blocked_id) values ('${q.outsider}','${q.actor}');`);
      await expectState(db, `delete from auth.users where id='${q.outsider}'`, "00000");
      assert.equal((await db.query(`select count(*)::int as n from public.profiles where id='${q.outsider}'`))[0].n, 0);
    });
    await isolated("chat cascade keeps member cleanup working", async () => {
      await db.exec(`insert into public.chats(id,type,created_by) values
        ('e5070000-0000-4000-8000-000000000031','group','${q.outsider}');`);
      await expectState(db, "delete from public.chats where id='e5070000-0000-4000-8000-000000000031'", "00000");
      assert.equal((await db.query("select count(*)::int as n from public.chat_members where chat_id='e5070000-0000-4000-8000-000000000031'"))[0].n, 0);
    });
    await isolated("missing sentinel still refuses standalone inserts and updates", async () => {
      const missing = "e5070000-0000-4000-8000-000000000099";
      await expectState(db, `insert into public.bans(user_id,reason) values ('${missing}','fictional missing')`, "42501");
      await db.exec(`insert into public.bans(user_id,reason) values ('${q.outsider}','fictional update');`);
      await expectState(db, `update public.bans set user_id='${missing}' where user_id='${q.outsider}'`, "42501");
      await expectState(db, `insert into public.chat_members(chat_id,user_id) values ('${missing}','${q.outsider}')`, "42501");
      await expectState(db, `update public.chat_members set chat_id='${missing}' where chat_id='${q.targetChat}' and user_id='${q.actor}'`, "42501");
    });
    return { rollback: true };
  } finally {
    await db.exec("rollback;");
  }
}
