import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createBotMethodRepository } from "../../artifacts/api-server/src/bot/repository.ts";
import { createMessageHandlers } from "../../artifacts/api-server/src/bot/methods/messages.ts";
import { fullSchemaIds as q } from "./bot-media-authority-full-schema.fixture.mjs";
import { mutateInstalled, quote } from "./bot-media-coverage.fixture.mjs";

// The operator supplies only an owned, network-isolated PostgREST connection.
// These cases never choose a host, load credentials, or contact Storage.
export const httpText = {
  id: "e5070000-0000-4000-8000-000000000090", chat_id: q.sourceChat,
  user_id: q.actor, type: "text", content: "Fictional HTTP commit",
};
const forward = key => ({ p_source_message_id: q.source, p_target_chat_id: q.targetChat,
  p_client_message_id: key, p_client_sent_at: "2026-10-03T09:00:00Z", p_topic_id: null });
const fingerprint = (method, input) => createHash("sha256").update(JSON.stringify([method, input])).digest("hex");

export async function installHttpProbe(db) {
  await db.exec(`set local role postgres;
    create function public.fixture_http_state() returns jsonb language sql stable security invoker
    set search_path='' as $$ select jsonb_build_object('role',current_user,'actor',auth.uid(),
      'isolation',current_setting('transaction_isolation'),'readonly',current_setting('transaction_read_only')) $$;
    revoke all on function public.fixture_http_state() from public,anon,service_role;
    grant execute on function public.fixture_http_state() to authenticated;
    create function public.fixture_http_unsupported() returns void language plpgsql volatile security invoker
    set search_path='' set default_transaction_isolation='repeatable read' as $$ begin
      insert into public.messages(id,chat_id,user_id,type,content)
      values ('e5070000-0000-4000-8000-000000000091','${q.sourceChat}','${q.actor}','text','Fictional unsupported');
    end $$;
    revoke all on function public.fixture_http_unsupported() from public,anon,service_role;
    grant execute on function public.fixture_http_unsupported() to authenticated;
    reset role;`);
}

// A test-only repair of the gateway's previously uncovered early return. A
// STABLE preflight is read-only under PostgREST and cannot retain row locks.
export async function installHttpPreflightRepair(db) {
  const signature = "public.bot_media_command_preflight_internal(uuid,uuid,text,text,text)";
  await mutateInstalled(db, signature, source => {
    assert.equal(createHash("sha256").update(source).digest("hex"),
      "59a139737de279ae7646e5355e2440e9e1cfb484107730d2eb4063471531d7c3");
    const marker = "  v_existing := private.bot_operation_idempotency_lookup(";
    assert.equal(source.split(marker).length, 2);
    source = source.replace(marker, "  perform fixture_authority.bot_target_current(p_bot_id,p_chat_id);\n" + marker);
    const cached = "  if coalesce((v_existing->>'found')::boolean, false) then\n";
    assert.equal(source.split(cached).length, 2);
    return source.replace(cached, cached + `    if (v_existing->'result') ? 'chat_id'
      and (v_existing->'result'->>'chat_id') is distinct from p_chat_id::text then
      raise exception 'bot_idempotency_conflict' using errcode='23505';
    end if;
`);
  });
  await db.exec(`alter function ${signature} volatile;`);
}

export function gatewayHttp(request, control = { calls: [] }) {
  const repository = createBotMethodRepository({ async rpc(name, args) {
    assert.ok(["bot_media_command_preflight_internal", "bot_message_command_internal"].includes(name));
    control.calls.push({ name, args: structuredClone(args) });
    const result = await request("POST", "/rpc/" + name, args, "service_role");
    return { data: result.data, error: result.error };
  } });
  const handlers = createMessageHandlers(repository, fingerprint, async () => assert.fail("no chat action"));
  const send = input => handlers.sendDocument({ bot: { botId: q.bot, tokenId: "e5070000-0000-4000-8000-000000000099" },
    requestId: "fictional-http" }, input);
  return { send, control };
}

export async function runHttpAcceptance({ request, query, exec, blocker, digest, check }) {
  await check("HTTP impersonation uses authenticated actor and read-committed stable RPC", async () => {
    const r = await request("POST", "/rpc/fixture_http_state", {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { role: "authenticated", actor: q.actor, isolation: "read committed", readonly: "on" });
  });
  await check("REST text commit survives response and releases transaction barrier", async () => {
    const r = await request("POST", "/messages", httpText);
    assert.equal(r.status, 201);
    assert.equal((await query(`select count(*)::int as n from public.messages where id='${httpText.id}'`))[0].n, 1);
    await blocker.exec("begin;select pg_try_advisory_xact_lock(270311,1) as acquired;");
    try { assert.equal((await blocker.query("select exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory' and classid=270311 and objid=1 and granted and mode='ExclusiveLock') as acquired"))[0].acquired, true); }
    finally { await blocker.exec("rollback;"); }
  });
  await check("HTTP permission refusal has no message or trigger effects", async () => {
    const before = await digest();
    const r = await request("POST", "/messages", { ...httpText, id: "e5070000-0000-4000-8000-000000000092", user_id: q.outsider });
    assert.equal(r.status, 403); assert.equal(r.error.code, "42501");
    assert.equal(await digest(), before);
  });
  await check("HTTP exclusive closer returns literal 500/55P03 with full rollback", async () => {
    await blocker.exec("begin;select pg_advisory_xact_lock(270311,1);");
    try {
      const before = await digest();
      const r = await request("POST", "/messages", { ...httpText, id: "e5070000-0000-4000-8000-000000000093" });
      assert.equal(r.status, 500); assert.equal(r.error.code, "55P03");
      assert.equal(r.error.message, "fixture_coverage_busy"); assert.equal(await digest(), before);
    } finally { await blocker.exec("rollback;"); }
  });
  await check("HTTP unsupported isolation returns literal 400/0A000 with full rollback", async () => {
    const before = await digest(); const r = await request("POST", "/rpc/fixture_http_unsupported", {});
    assert.equal(r.status, 400); assert.equal(r.error.code, "0A000"); assert.equal(await digest(), before);
  });
  await check("real forward RPC commits once and retries with same identity", async () => {
    const key = "e5070000-0000-4000-8000-000000000094";
    const first = await request("POST", "/rpc/forward_message", forward(key));
    assert.equal(first.status, 200); assert.equal(first.data.forwarded_from_id, q.source);
    const before = await digest(); const again = await request("POST", "/rpc/forward_message", forward(key));
    assert.equal(again.status, 200); assert.equal(again.data.id, first.data.id); assert.equal(await digest(), before);
    await exec(`insert into public.mutes(user_id,chat_id,reason) values ('${q.actor}','${q.targetChat}','fictional-http');`);
    try {
      const refusedBefore = await digest(); const refused = await request("POST", "/rpc/forward_message", forward(key));
      assert.equal(refused.status, 403); assert.equal(refused.error.code, "42501"); assert.equal(await digest(), refusedBefore);
    } finally { await exec(`delete from public.mutes where user_id='${q.actor}' and chat_id='${q.targetChat}' and reason='fictional-http';`); }
  });
  await check("closed fictional coverage rolls back real bot command and both idempotency ledgers", async () => {
    await exec("update fixture_coverage.objects set closed=true where id=1;");
    try {
      const before = await digest();
      const r = await request("POST", "/rpc/bot_message_command_internal", { p_bot_id: q.bot, p_chat_id: q.sourceChat,
        p_method: "sendDocument", p_payload: { file_id: q.source }, p_idempotency_key: "fictional-http-closed", p_request_fingerprint: "a".repeat(64) }, "service_role");
      assert.equal(r.status, 500); assert.equal(r.error.code, "55000"); assert.equal(await digest(), before);
      assert.equal((await query(`select count(*)::int as n from private.bot_operation_idempotency where bot_id='${q.bot}' and idempotency_key='fictional-http-closed'`))[0].n, 0);
    } finally { await exec("update fixture_coverage.objects set closed=false where id=1;"); }
  });
}

export async function runGatewayHttpAcceptance({ request, query, exec, blocker, digest, check, key = "fictional-http-gateway" }) {
  const { send, control } = gatewayHttp(request);
  const input = { chat_id: q.sourceChat, file_id: q.source, idempotency_key: key };
  await check("actual gateway file-id retry returns one committed message without upload or extra accounting", async () => {
    const first = await send(input); assert.equal(first.chat_id, q.sourceChat);
    const before = await digest(); assert.deepEqual(await send(input), first); assert.equal(await digest(), before);
    assert.deepEqual(control.calls.map(x => x.name), ["bot_media_command_preflight_internal", "bot_message_command_internal", "bot_media_command_preflight_internal"]);
    const [ledger] = await query(`select count(*)::int as n from private.bot_operation_idempotency where bot_id='${q.bot}' and idempotency_key=${quote(key)} and request_fingerprint=${quote(fingerprint("sendDocument", input))}`);
    assert.equal(ledger.n, 1);
  });
  await check("gateway cached preflight refuses same fingerprint and key rebound to another allowed chat", async () => {
    const original = control.calls.find(x => x.name === "bot_media_command_preflight_internal").args;
    const before = await digest();
    const r = await request("POST", "/rpc/bot_media_command_preflight_internal", { ...original, p_chat_id: q.targetChat }, "service_role");
    assert.equal(r.status, 409); assert.equal(r.error.code, "23505"); assert.equal(await digest(), before);
  });
  await check("gateway cached preflight refuses a concurrently changing membership without stale success", async () => {
    const original = control.calls.find(x => x.name === "bot_media_command_preflight_internal").args;
    await blocker.exec(`begin;update public.chat_bot_members set privacy_mode='restricted'
      where bot_id='${q.bot}' and chat_id='${q.sourceChat}';`);
    try {
      assert.equal((await blocker.query(`select count(*)::int as n from public.chat_bot_members
        where bot_id='${q.bot}' and chat_id='${q.sourceChat}' and privacy_mode='restricted'`))[0].n, 1);
      const before = await digest();
      const r = await request("POST", "/rpc/bot_media_command_preflight_internal", original, "service_role");
      assert.equal(r.status, 500); assert.equal(r.error.code, "55P03"); assert.equal(await digest(), before);
    } finally { await blocker.exec("rollback;"); }
  });
  await check("actual gateway retry rechecks current membership before cached success", async () => {
    await exec(`update public.chat_bot_members set removed_at=now() where bot_id='${q.bot}' and chat_id='${q.sourceChat}';`);
    try { const before = await digest(); await assert.rejects(() => send(input), { code: "forbidden" }); assert.equal(await digest(), before); }
    finally { await exec(`update public.chat_bot_members set removed_at=null where bot_id='${q.bot}' and chat_id='${q.sourceChat}';`); }
  });
}
