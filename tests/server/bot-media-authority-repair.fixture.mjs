import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mutateInstalled, quote } from "./bot-media-coverage.fixture.mjs";

export const repairEnabled = process.env.BOT_MEDIA_AUTHORITY_REPAIR === "1";
const send = "public.bot_send_message_internal(uuid,uuid,text,jsonb,text)";
const commandSignature = "public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)";
const forwardSignature = "public.forward_message(uuid,uuid,uuid,timestamptz,uuid)";
const sha = value => createHash("sha256").update(value).digest("hex");
const sql = readFileSync(new URL("./fixtures/bot-media-authority-candidate.sql", import.meta.url), "utf8");
const fileCheck = `  if v_file_id is not null then
    perform fixture_authority.file_id_current(p_bot_id,p_chat_id,v_file_id);
    perform fixture_authority.file_payload_current(p_bot_id,p_chat_id,v_file_id,v_message_type,v_reply_to_id,v_topic_id);
  end if;

`;
const forwardCheck = `  perform fixture_authority.forward_current(v_uid,p_source_message_id,p_target_chat_id,p_topic_id);

`;
const cachedSendBinding = `    perform m.id from public.messages m where m.id=v_existing_message_id
      and m.chat_id=p_chat_id and m.bot_id=p_bot_id for share nowait;
    if not found then raise exception 'bot_idempotency_conflict' using errcode='23505'; end if;
`;
const cachedCommandBinding = `    if (v_existing->'result') ? 'chat_id'
      and (v_existing->'result'->>'chat_id') is distinct from p_chat_id::text then
      raise exception 'bot_idempotency_conflict' using errcode='23505';
    end if;
`;

async function body(db, signature) {
  return (await db.query(`select prosrc from pg_proc where oid=${quote(signature)}::regprocedure`))[0].prosrc;
}

function insertOnce(source, marker, inserted) {
  assert.equal(source.split(marker).length, 2, "one exact accepted writer insertion point");
  return source.replace(marker, inserted + marker);
}

// Only replaces compiled functions inside the caller's disposable local fixture.
export async function installAuthorityRepair(db, { forward = false } = {}) {
  assert.equal(sha(await body(db, send)), "7786e30e6ad6e9184fc88cf46dba8868d3bafbc7821dc088103c2c2ca3b022c8");
  await db.exec(sql);
  await mutateInstalled(db, send, source => insertOnce(source,
    "  insert into private.bot_message_idempotency(", fileCheck));
  await mutateInstalled(db, send, source => {
    const marker = "  if found then\n    return (";
    assert.equal(source.split(marker).length, 2);
    return source.replace(marker, "  if found then\n" + cachedSendBinding + "    perform fixture_authority.bot_target_current(p_bot_id,p_chat_id);\n    return (");
  });
  assert.equal(sha(await body(db, commandSignature)), "44da5bb4fa49322ac1ff6c89a31830c4bcd46e6537b7cbe9dfe064d13ea992a2");
  await mutateInstalled(db, commandSignature, source => {
    const marker = "  if coalesce((v_existing->>'found')::boolean, false) then\n";
    assert.equal(source.split(marker).length, 2);
    return source.replace(marker, marker + cachedCommandBinding + "    perform fixture_authority.bot_target_current(p_bot_id,p_chat_id);\n");
  });
  if (forward) {
    assert.equal(sha(await body(db, forwardSignature)), "535058cdf0cc4a973bf3356082a52d8e2e6fce4f7b58cd988c6cb1138459eec2");
    await mutateInstalled(db, forwardSignature, source => insertOnce(source,
      "  if v_copy.media_url is not null or v_copy.media_path is not null then", forwardCheck));
    await mutateInstalled(db, forwardSignature, source => {
      const marker = "      return v_copy;";
      assert.equal(source.split(marker).length, 3, "both cached and unique-conflict early returns");
      return source.replaceAll(marker, "      perform fixture_authority.forward_current(v_uid,p_source_message_id,p_target_chat_id,p_topic_id);\n" + marker);
    });
    await db.exec(`set role postgres; create trigger fixture_hidden_entry_guard
      before insert or update of message_id,user_id on public.message_hidden_for_users
      for each row execute function fixture_authority.hidden_entry_guard();`);
  }
  const mutant = process.env.BOT_MEDIA_AUTHORITY_REPAIR_MUTANT;
  if (mutant) {
    assert.ok(["file-check", "forward-check", "hide-guard", "hide-wait", "source-lock-wait", "cache-target", "forward-cache", "missing-member", "file-payload", "forward-kind", "isolation", "helper-acl", "cache-binding"].includes(mutant), "known bounded fixture mutation only");
    if (mutant === "file-check") await mutateInstalled(db, send, source => {
      assert.ok(source.includes(fileCheck)); return source.replace(fileCheck, "");
    });
    if (mutant === "forward-check") {
      assert.ok(forward);
      await mutateInstalled(db, forwardSignature, source => {
        assert.ok(source.includes(forwardCheck)); return source.replace(forwardCheck, "");
      });
    }
    if (mutant === "hide-guard") {
      assert.ok(forward);
      await db.exec("set role postgres; drop trigger fixture_hidden_entry_guard on public.message_hidden_for_users;");
    }
    if (mutant === "hide-wait") {
      assert.ok(forward);
      await mutateInstalled(db, "fixture_authority.hidden_entry_guard()", source => {
        assert.ok(source.includes("for update nowait")); return source.replace("for update nowait", "for update");
      });
    }
    if (mutant === "source-lock-wait") {
      const signature = forward ? "fixture_authority.forward_current(uuid,uuid,uuid,uuid)" : "fixture_authority.file_id_current(uuid,uuid,uuid)";
      await mutateInstalled(db, signature, source => {
        const marker = "where m.id=p_source for share nowait";
        assert.ok(source.includes(marker)); return source.replace(marker, "where m.id=p_source for share");
      });
    }
    if (mutant === "cache-target") {
      for (const signature of [send, commandSignature]) await mutateInstalled(db, signature, source => {
        const marker = "    perform fixture_authority.bot_target_current(p_bot_id,p_chat_id);\n";
        assert.equal(source.split(marker).length, 2); return source.replace(marker, "");
      });
    }
    if (mutant === "forward-cache") {
      assert.ok(forward);
      await mutateInstalled(db, forwardSignature, source => {
        const marker = "      perform fixture_authority.forward_current(v_uid,p_source_message_id,p_target_chat_id,p_topic_id);\n";
        assert.equal(source.split(marker).length, 3); return source.replaceAll(marker, "");
      });
    }
    if (mutant === "missing-member") {
      await mutateInstalled(db, "fixture_authority.bot_target_current(uuid,uuid)", source => {
        const marker = "  if not found then raise exception 'bot_chat_forbidden' using errcode='42501'; end if;\n";
        assert.equal(source.split(marker).length, 4); return source.replaceAll(marker, "");
      });
      if (forward) {
        await mutateInstalled(db, "fixture_authority.forward_current(uuid,uuid,uuid,uuid)", source => {
          const a = "  if not v_source_held then raise exception 'message_not_found' using errcode='P0002'; end if;\n";
          const b = "  if not v_target_held then raise exception 'not_chat_member' using errcode='42501'; end if;\n";
          assert.ok(source.includes(a) && source.includes(b)); return source.replace(a, "").replace(b, "");
        });
        await mutateInstalled(db, "fixture_authority.hidden_entry_guard()", source => {
          const marker = "    if not found then raise exception 'not_chat_member' using errcode='42501'; end if;\n";
          assert.equal(source.split(marker).length, 2); return source.replace(marker, "");
        });
      }
    }
    if (mutant === "file-payload") await mutateInstalled(db, send, source => {
      const marker = "    perform fixture_authority.file_payload_current(p_bot_id,p_chat_id,v_file_id,v_message_type,v_reply_to_id,v_topic_id);\n";
      assert.equal(source.split(marker).length, 2); return source.replace(marker, "");
    });
    if (mutant === "forward-kind") {
      assert.ok(forward);
      await mutateInstalled(db, "fixture_authority.forward_current(uuid,uuid,uuid,uuid)", source => {
        const marker = "  if coalesce(v_source.type,'text')='system' then\n    raise exception 'message_not_forwardable' using errcode='22023';\n  end if;\n";
        assert.equal(source.split(marker).length, 2); return source.replace(marker, "");
      });
    }
    if (mutant === "isolation") {
      for (const signature of ["fixture_authority.bot_target_current(uuid,uuid)", "fixture_authority.forward_current(uuid,uuid,uuid,uuid)"]) {
        await mutateInstalled(db, signature, source => {
          const marker = "  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then\n    raise exception 'fixture_authority_requires_read_committed' using errcode='0A000';\n  end if;\n";
          assert.equal(source.split(marker).length, 2); return source.replace(marker, "");
        });
      }
    }
    if (mutant === "helper-acl") await db.exec("set role postgres; grant execute on function fixture_authority.bot_target_current(uuid,uuid) to service_role;");
    if (mutant === "cache-binding") {
      for (const [signature, marker] of [[send, cachedSendBinding], [commandSignature, cachedCommandBinding]]) {
        await mutateInstalled(db, signature, source => {
          assert.equal(source.split(marker).length, 2); return source.replace(marker, "");
        });
      }
    }
  }
}
