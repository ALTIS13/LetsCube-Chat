import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mutateInstalled } from "./bot-media-coverage.fixture.mjs";

// Only the operator's separately verified, network-isolated full-schema copy.
export async function installFullSchemaRepair(db) {
  await mutateInstalled(db, "fixture_authority.forward_current(uuid,uuid,uuid,uuid)", source => {
    const marker = "  if public.is_muted(p_user,p_chat) then";
    assert.equal(source.split(marker).length, 2);
    return source.replace(marker, `  if public.blocked_from_chat(p_chat,p_user) then
    raise exception 'recipient_blocked_sender' using errcode='42501';
  end if;
` + marker);
  });
  await db.exec(readFileSync(new URL("./fixtures/bot-media-authority-full-schema-candidate.sql", import.meta.url), "utf8"));
  await installSanctionRetention(db);
}

export async function installSanctionRetention(db) {
  await db.exec("reset role; " + readFileSync(new URL("./fixtures/bot-media-authority-sanctions-candidate.sql", import.meta.url), "utf8"));
  await mutateInstalled(db, "fixture_authority.forward_current(uuid,uuid,uuid,uuid)", source => {
    const marker = "  if public.is_banned(p_user) then";
    assert.equal(source.split(marker).length, 2);
    return source.replace(marker, "  perform fixture_authority.human_target_current(p_user,p_chat);\n" + marker);
  });
}

// Executable mutants operate on compiled definitions, not on an expected-value
// constant. The operator supplies an isolated copy and restores the transaction.
export async function mutateFullSchemaRepair(db, mutant) {
  assert.ok(["private-block", "fallback", "profile-cascade", "chat-cascade", "missing-sentinel",
    "helper-acl", "fk-lock", "sanctions", "block-retention", "member-retention", "retention-call"].includes(mutant));
  await db.exec("reset role;");
  const change = async (signature, marker, replacement) => mutateInstalled(db, signature, source => {
    assert.equal(source.split(marker).length, 2, "one installed mutation target");
    return source.replace(marker, replacement);
  });
  if (mutant === "private-block") await change("fixture_authority.forward_current(uuid,uuid,uuid,uuid)",
    "  if public.blocked_from_chat(p_chat,p_user) then\n    raise exception 'recipient_blocked_sender' using errcode='42501';\n  end if;\n", "");
  if (mutant === "fallback") await db.exec("drop trigger fixture_forward_insert_guard on public.messages;");
  if (mutant === "helper-acl") await db.exec("grant execute on function fixture_authority.human_target_current(uuid,uuid) to authenticated;");
  for (const [name, signature] of [["profile-cascade", "fixture_authority.sanction_mutation_guard()"],
    ["chat-cascade", "fixture_authority.member_topology_guard()"]]) {
    if (mutant === name) await change(signature, " and not (tg_op='DELETE' and pg_trigger_depth()>1)", "");
  }
  if (mutant === "missing-sentinel") {
    for (const [signature, message] of [["fixture_authority.sanction_mutation_guard()", "sanction_subject_missing"],
      ["fixture_authority.member_topology_guard()", "authority_chat_missing"]]) {
      await change(signature, `raise exception '${message}' using errcode='42501';`, "null;");
    }
  }
  if (mutant === "fk-lock") {
    for (const signature of ["fixture_authority.sanction_mutation_guard()", "fixture_authority.member_topology_guard()"]) {
      await change(signature, "for no key update nowait", "for update nowait");
    }
  }
  if (mutant === "sanctions") await db.exec(`drop trigger fixture_sanction_guard on public.bans;
    drop trigger fixture_sanction_guard on public.mutes;`);
  if (mutant === "block-retention") await db.exec("drop trigger fixture_block_guard on public.user_blocks;");
  if (mutant === "member-retention") await db.exec("drop trigger fixture_member_topology_guard on public.chat_members;");
  if (mutant === "retention-call") await change("fixture_authority.forward_current(uuid,uuid,uuid,uuid)",
    "  perform fixture_authority.human_target_current(p_user,p_chat);\n", "");
}
