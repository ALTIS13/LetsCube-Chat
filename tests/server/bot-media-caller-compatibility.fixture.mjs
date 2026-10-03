import assert from "node:assert/strict";
import { fullSchemaIds as q } from "./bot-media-authority-full-schema.fixture.mjs";
import { quote } from "./bot-media-coverage.fixture.mjs";

// No transport/bootstrap: the coordinator supplies a preseeded PG17 copy with
// real RLS/authorities and fixture_coverage installed. isolated(name, run) owns
// savepoint rollback and check reporting, as in runFullSchemaAuthority.
// No BEGIN/COMMIT, helper replacement, trigger disabling or permission widening.
export async function runCallerCompatibility({ exec, query, isolated }) {
  for (const method of [exec, query, isolated]) assert.equal(typeof method, "function");
  const textId = "e5070000-0000-4000-8000-000000000080";
  const actorRole = `set local role authenticated; set request.jwt.claim.sub='${q.actor}';`;
  const ownerRole = "reset role; set request.jwt.claim.sub='';";
  const seedText = async () => exec(`${actorRole}
    insert into public.messages(id,chat_id,user_id,type,content)
      values ('${textId}','${q.targetChat}','${q.actor}','text','Fictional caller text');`);
  const textState = async (id = textId) => {
    const rows = await query(`select chat_id,user_id,bot_id,type,content,pinned,
      deleted_at is not null as deleted,edited_at is not null as edited,
      media_url,media_bucket,media_path from public.messages where id='${id}'`);
    assert.equal(rows.length, 1, "the fictional message must actually exist");
    return rows[0];
  };
  const targetMessages = () => query(`select id,user_id,bot_id,type,content
    from public.messages where chat_id='${q.targetChat}' order by id`);
  const memberRows = () => query(`select user_id,role::text as role from public.chat_members
    where chat_id='${q.targetChat}' and user_id='${q.outsider}'`);
  const deletionRows = () => query(`select chat_id,deleted_by,author_id,chat_type,
    deleted_at=(select deleted_at from public.messages where id='${textId}') as timestamp_matches
    from private.message_deletions where message_id='${textId}' order by deleted_at`);
  const sharedCoverageCount = async () => (await query(`select count(*)::int as n from pg_locks
    where pid=pg_backend_pid() and locktype='advisory' and classid=270311
      and objid=1 and objsubid=2 and mode='ShareLock' and granted`))[0].n;

  // Catch inside a real PL/pgSQL subtransaction so unexpected SQL errors cannot
  // become refusal evidence, and the subsequent queries can inspect rollback.
  const expectRefusal = async (statement, state, message) => exec(`do $caller_proof$
    declare refused boolean := false; actual_state text; actual_message text;
    begin
      begin
        ${statement};
      exception when others then
        get stacked diagnostics actual_state=returned_sqlstate,actual_message=message_text;
        if actual_state is distinct from ${quote(state)}
          or actual_message is distinct from ${quote(message)} then raise; end if;
        refused := true;
      end;
      if not refused then raise exception 'caller_expected_literal_refusal_missing'; end if;
    end $caller_proof$;`);
  const ownExclusiveCoverage = async () => {
    await exec(ownerRole);
    const [row] = await query("select pg_try_advisory_xact_lock(270311,1) as acquired");
    assert.equal(row.acquired, true, "literal test-only same-backend closer ownership");
  };
  const poisonFictionalCloseState = async () => {
    await exec(ownerRole);
    const [row] = await query("select exists(select 1 from fixture_coverage.objects) as present");
    assert.equal(row.present, true, "the coordinator must seed fictional coverage objects");
    // Deliberate test-only bad close state, not an accepted close/delete oracle.
    await exec("update fixture_coverage.objects set closed=true;");
  };
  const unresolvedSeedSource = async () => {
    await exec(ownerRole);
    assert.deepEqual(await query(`select r.reference_state,r.hold_reason
      from public.messages m cross join lateral private.bot_message_media_references(
        m.media_bucket,m.media_path,m.media_url,m.media_metadata) r where m.id='${q.source}'`),
    [{ reference_state: "unresolved", hold_reason: "unregistered_object" }],
    "fullSchemaSeed's fictional source is not a registered Storage generation");
  };

  const cases = [
    // Detects a blanket rejection of media-free writes when any control is closed.
    ["authenticated text INSERT remains media-free with closed fictional objects", async () => {
      await poisonFictionalCloseState();
      assert.equal(await sharedCoverageCount(), 0, "not a coverage lock inherited from bootstrap");
      await seedText();
      assert.equal(await sharedCoverageCount(), 1, "actual transaction-held shared acquisition");
      assert.deepEqual(await textState(), {
        chat_id: q.targetChat, user_id: q.actor, bot_id: null, type: "text",
        content: "Fictional caller text", pinned: false, deleted: false, edited: false,
        media_url: null, media_bucket: null, media_path: null,
      });
      await exec(ownerRole);
      assert.equal((await query(`select count(*)::int as n
        from private.bot_message_media_observations where message_id='${textId}'`))[0].n, 0);
    }],
    // Detects silent zero-row RLS updates or loss of the actual author's edit.
    ["authenticated content edit preserves sender and records the actual edit", async () => {
      await seedText();
      await exec(`update public.messages set content='Fictional caller edited',edited_at=clock_timestamp()
        where id='${textId}';`);
      assert.deepEqual(await textState(), {
        chat_id: q.targetChat, user_id: q.actor, bot_id: null, type: "text",
        content: "Fictional caller edited", pinned: false, deleted: false, edited: true,
        media_url: null, media_bucket: null, media_path: null,
      });
    }],
    // Pin RPCs, not broad UPDATE grants; both their return and stored row matter.
    ["authenticated pin and unpin retain real RPC and stored-row effects", async () => {
      await seedText();
      const [pinned] = await query(`select to_jsonb(public.pin_message('${textId}')) as result`);
      assert.equal(pinned.result.id, textId);
      assert.equal(pinned.result.pinned, true);
      assert.equal((await textState()).pinned, true);
      const [unpinned] = await query(`select to_jsonb(public.unpin_message('${textId}')) as result`);
      assert.equal(unpinned.result.id, textId);
      assert.equal(unpinned.result.pinned, false);
      assert.deepEqual(await textState(), {
        chat_id: q.targetChat, user_id: q.actor, bot_id: null, type: "text",
        content: "Fictional caller text", pinned: false, deleted: false, edited: false,
        media_url: null, media_bucket: null, media_path: null,
      });
    }],
    // Real outer membership INSERT -> AFTER ROW trigger -> nested message INSERT.
    // Removing/skipping the service-message writer must fail the literal delta.
    ["authenticated membership INSERT emits exactly one real nested system message", async () => {
      await exec(actorRole);
      assert.equal(await sharedCoverageCount(), 0, "no earlier message writer supplies this lock");
      assert.deepEqual(await memberRows(), []);
      const before = await targetMessages();
      await exec(`insert into public.chat_members(chat_id,user_id,role)
        values ('${q.targetChat}','${q.outsider}','member');`);
      assert.equal(await sharedCoverageCount(), 1, "the real nested message acquires coverage");
      assert.deepEqual(await memberRows(), [{ user_id: q.outsider, role: "member" }]);
      const after = await targetMessages();
      const oldIds = new Set(before.map(row => row.id));
      const added = after.filter(row => !oldIds.has(row.id));
      assert.equal(after.length - before.length, 1);
      assert.equal(added.length, 1);
      assert.match(added[0].id, /^[0-9a-f-]{36}$/);
      const system = { ...added[0] };
      delete system.id;
      assert.deepEqual(system, {
        user_id: null, bot_id: null, type: "system",
        content: "Fictional authority actor \u0434\u043e\u0431\u0430\u0432\u0438\u043b(\u0430) \u0432 \u0433\u0440\u0443\u043f\u043f\u0443: Fictional authority outsider",
      });
    }],
    // The coverage refusal must abort the outer membership, not just its notice.
    ["nested membership coverage refusal leaves neither member nor system message", async () => {
      await ownExclusiveCoverage();
      await exec(actorRole);
      assert.deepEqual(await memberRows(), []);
      const before = await targetMessages();
      await expectRefusal(`insert into public.chat_members(chat_id,user_id,role)
        values ('${q.targetChat}','${q.outsider}','member')`, "55000", "fixture_closer_cannot_write");
      assert.deepEqual(await memberRows(), []);
      assert.deepEqual(await targetMessages(), before);
    }],
    // Real RPC CTE updates messages, then writes the private deletion ledger;
    // BEFORE ROW final scrub is an independent observable nested effect.
    ["delete_messages_for_everyone retains real deletion ledger and final scrub", async () => {
      await seedText();
      await query(`select public.pin_message('${textId}')`);
      const removed = await query(`select message_id from public.delete_messages_for_everyone(
        array['${textId}','${textId}']::uuid[]) as removed(message_id)`);
      assert.deepEqual(removed, [{ message_id: textId }]);
      assert.deepEqual(await textState(), {
        chat_id: q.targetChat, user_id: q.actor, bot_id: null, type: "text",
        content: null, pinned: false, deleted: true, edited: false,
        media_url: null, media_bucket: null, media_path: null,
      });
      await exec(ownerRole);
      assert.deepEqual(await deletionRows(), [{
        chat_id: q.targetChat, deleted_by: q.actor, author_id: q.actor,
        chat_type: "group", timestamp_matches: true,
      }]);
      await exec(actorRole);
      assert.deepEqual(await query(`select message_id from public.delete_messages_for_everyone(
        array['${textId}']::uuid[]) as removed(message_id)`), [{ message_id: textId }]);
      await exec(ownerRole);
      assert.equal((await deletionRows()).length, 1, "a real duplicate delete adds no second ledger entry");
    }],
    ["delete RPC coverage refusal preserves message and leaves no outer ledger entry", async () => {
      await seedText();
      const before = await textState();
      await ownExclusiveCoverage();
      assert.deepEqual(await deletionRows(), []);
      await exec(actorRole);
      await expectRefusal(`perform public.delete_messages_for_everyone(array['${textId}']::uuid[])`,
        "55000", "fixture_closer_cannot_write");
      assert.deepEqual(await textState(), before);
      await exec(ownerRole);
      assert.deepEqual(await deletionRows(), []);
    }],
    // Both content-only and pin updates enter final/OLD reference validation.
    // Removing AFTER coverage must fail these literal refusals, not a setup check.
    ...["content edit", "pin"].map(operation => [
      `${operation} refuses unresolved OLD media after fictional close without partial effects`, async () => {
        await unresolvedSeedSource();
        await poisonFictionalCloseState();
        await exec(actorRole);
        const before = await textState(q.source);
        assert.equal(before.deleted, false);
        assert.equal(before.pinned, false);
        await expectRefusal(operation === "pin" ? `perform public.pin_message('${q.source}')`
          : `update public.messages set content='Fictional forbidden edit',edited_at=clock_timestamp()
             where id='${q.source}'`, "55000", "fixture_unknown_after_close");
        assert.deepEqual(await textState(q.source), before);
      },
    ]),
  ];
  for (const [name, run] of cases) await isolated(name, run);
  return { cases: cases.length };
}
