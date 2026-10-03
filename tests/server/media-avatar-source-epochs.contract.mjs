import assert from "node:assert/strict";

// Pure actual-SQL scenarios. These logical observations confer no Storage,
// physical-generation, admission, publication, deletion or refund authority.
export const avatarEpochOwners = Object.freeze([
  { scope: "profile", table: "profiles", id: "e6110000-0000-4000-8000-000000000001" },
  { scope: "chat", table: "chats", id: "e6110000-0000-4000-8000-000000000002" },
  { scope: "bot", table: "bots", id: "e6110000-0000-4000-8000-000000000003" },
]);
export const avatarEpochOther = "e6110000-0000-4000-8000-000000000099";
export const avatarEpochReplacement = "e6110000-0000-4000-8000-000000000098";
export const sqlLiteral = value => value === null ? "null" : "'" + String(value).replaceAll("'", "''") + "'";
export const avatarEpochUrl = (owner, part) => owner.scope === "bot"
  ? `https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/${owner.id}/fictional-${part}.png`
  : `https://avatar-epoch.invalid/${owner.scope}/${owner.id}/fictional-${part}.png`;

export async function insertAvatarEpochOwner({ exec }, owner, value = null) {
  const extra = owner.scope === "bot" ? ",username,display_name" : owner.scope === "chat" ? ",type" : "";
  const values = owner.scope === "bot" ? ",'fictional_epoch_bot','Fictional Epoch'" : owner.scope === "chat" ? ",'group'" : "";
  await exec(`insert into public.${owner.table}(id,avatar_url${extra}) values (${sqlLiteral(owner.id)},${sqlLiteral(value)}${values});`);
}

export async function currentAvatarEpoch({ query }, owner) {
  const [{ present }] = await query("select to_regclass('private.media_avatar_source_current') is not null as present");
  const rows = present ? await query(`select * from private.media_avatar_source_current
    where scope=${sqlLiteral(owner.scope)} and owner_id=${sqlLiteral(owner.id)}`) : [];
  assert.equal(rows.length, 1, "literal current-source oracle: exactly one DB-minted owner observation");
  const row = rows[0];
  assert.equal(row.scope, owner.scope); assert.equal(row.owner_id, owner.id);
  assert.match(row.source_epoch, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(typeof row.tombstone, "boolean");
  return row;
}

export async function avatarEpochHistory({ query }, owner) {
  return query(`select * from private.media_avatar_source_history
    where scope=${sqlLiteral(owner.scope)} and owner_id=${sqlLiteral(owner.id)} order by observed_at,source_epoch`);
}

export async function assertAvatarEpochLink(deps, owner, url, tombstone = false) {
  const current = await currentAvatarEpoch(deps, owner);
  assert.equal(current.avatar_url, url, "literal final-source URL, not outer stale NEW");
  assert.equal(current.tombstone, tombstone, "literal current tombstone state");
  const history = await avatarEpochHistory(deps, owner);
  const linked = history.filter(row => row.source_epoch === current.source_epoch);
  assert.equal(linked.length, 1);
  assert.deepEqual(linked[0], { ...current, event_kind: linked[0].event_kind });
  assert.ok(["insert", "assignment", "bootstrap", "reconcile", "delete", "id_replace", "truncate"].includes(linked[0].event_kind));
  return current;
}

export async function runAvatarEpochAssignments(deps, owner) {
  const { exec } = deps, a = avatarEpochUrl(owner, "a"), b = avatarEpochUrl(owner, "b");
  await insertAvatarEpochOwner(deps, owner);
  const initial = await assertAvatarEpochLink(deps, owner, null);
  const epochs = [initial.source_epoch];
  for (const url of [null, a, a, b, a, null]) {
    await exec(`update public.${owner.table} set avatar_url=${sqlLiteral(url)} where id=${sqlLiteral(owner.id)};`);
    const row = await assertAvatarEpochLink(deps, owner, url);
    assert.ok(!epochs.includes(row.source_epoch), "literal explicit event oracle: equal/NULL/ABA/clear must rotate");
    epochs.push(row.source_epoch);
  }
  const history = await avatarEpochHistory(deps, owner);
  assert.equal(history.length, 7, "one INSERT plus six explicit assignment events");
  assert.equal(history.filter(row => row.event_kind === "insert").length, 1);
  assert.equal(history.filter(row => row.event_kind === "assignment").length, 6);
  const before = await currentAvatarEpoch(deps, owner);
  const unrelated = owner.scope === "profile" ? "presence_status='idle'"
    : owner.scope === "chat" ? "name='Fictional Name'" : "description='Fictional Description'";
  await exec(`update public.${owner.table} set ${unrelated} where id=${sqlLiteral(owner.id)};`);
  assert.deepEqual(await currentAvatarEpoch(deps, owner), before, "unrelated owner writes do not rotate or rewrite current");
  assert.deepEqual(await avatarEpochHistory(deps, owner), history);
  return { events: 7, distinctEpochs: new Set(epochs).size };
}
