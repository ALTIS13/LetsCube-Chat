import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// Only an exact newly owned container is writable. No SQL targets the live DB.
const owner = randomUUID(), name = `letscube-bot-inline-${owner}`;
const image = "sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00";
const backup = "/srv/letscube/backups/automated/20261002-134829/db/supabase-postgres.custom";
const backupHash = "08f8d39d7c1ce49d4d2c6e1281477d193181c01264e8326b693c4d2aded66c5e";
const db = "bot_inline_qa", root = new URL("../../../", import.meta.url);
const stem = "supabase/migrations/20261002020000_bot_inline_media_ingest";
const B = "d2580000-0000-4000-8000-000000000001", T = "d2580000-0000-4000-8000-000000000002";
const C = "d2580000-0000-4000-8000-000000000003", U = "d2580000-0000-4000-8000-000000000004";
const L = "d2580000-0000-4000-8000-000000000005";
const fp = "a".repeat(64), path = `${C}/bots/${B}/${fp}.pdf`;
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
let id, checks = 0;
function command(args, input = "", timeout = 45_000) {
  const child = spawn("ssh", ["-i", "C:/Users/maksi/.ssh/letscube_ed25519", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
    "root@ms.letscube.ru", args.map(shellQuote).join(" ")]);
  let stdout = "", stderr = "";
  child.stdout.on("data", part => { stdout += part; });
  child.stderr.on("data", part => { stderr += part; });
  child.stdin.on("error", () => {});
  const timer = setTimeout(() => child.kill(), timeout);
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout: stdout.trim(), stderr }); });
  });
  child.stdin.end(input);
  return done;
}
async function docker(args, input = "") {
  const result = await command(["docker", ...args], input);
  assert.equal(result.code, 0, `isolated Docker ${args[0]} failed; private diagnostics suppressed`);
  return result.stdout;
}
async function owned() {
  assert.match(id, /^[a-f0-9]{64}$/);
  const [container] = JSON.parse(await docker(["inspect", id]));
  assert.equal(container.Name, `/${name}`); assert.equal(container.Id, id); assert.equal(container.Image, image);
  assert.equal(container.Config.Labels["letscube.bot-inline.owner"], owner);
  assert.equal(container.HostConfig.NetworkMode, "none"); assert.equal(container.HostConfig.Privileged, false);
  assert.deepEqual(container.HostConfig.PortBindings, {});
  assert.ok(container.Mounts.every(mount => !["bind", "volume"].includes(mount.Type)));
}
function sql(text, database = db) {
  assert.ok(id);
  return command(["docker", "exec", "-i", id, "psql", "-X", "-qAt", "-h", "/tmp", "-U", "supabase_admin",
    "-d", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], text);
}
async function q(text, database, ddlOnly = false) {
  const result = await sql(text, database);
  const code = result.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? "unknown";
  const identifier = result.stderr.match(/(?:column|relation|function) "([a-z_][a-z_0-9]*)"/)?.[1] ?? "unknown";
  const permission = result.stderr.match(/permission denied for (?:schema|table|function|sequence) [a-z_][a-z_0-9]*/)?.[0] ?? "none";
  const ownership = result.stderr.match(/(?:must be owner of|must be member of role|permission denied to (?:set role|create))[ A-Za-z_\"]*/)?.[0] ?? "none";
  if (ddlOnly && result.code !== 0) console.error(result.stderr.split("\n").find(line => /ERROR:\s+[A-Z0-9]{5}:/.test(line))?.slice(0, 220));
  assert.equal(result.code, 0, `isolated SQL failed SQLSTATE=${code} identifier=${identifier} permission=${permission} ownership=${ownership}; private diagnostics suppressed`);
  return result.stdout;
}
async function bad(text, state, marker) {
  const result = await sql(`BEGIN; ${text} ROLLBACK;`);
  assert.notEqual(result.code, 0);
  assert.ok(result.stderr.includes(state) && result.stderr.includes(marker), "wrong isolated refusal; raw diagnostics suppressed");
}
async function check(label, work) { await work(); checks++; console.log(`PASS ${label}`); }
const reserve = (key = "d258-full-restore-1", lease = L) => `SELECT public.bot_media_ingest_reserve_internal('${B}','${T}','${C}','sendDocument',${quote(key)},'${fp}','${path}','application/pdf',68,'${"b".repeat(64)}','${lease}');`;
const payload = { media_bucket: "chat-media", media_path: path,
  media_metadata: { mime_type: "application/pdf", size: 68, size_bytes: 68, kind: "file", file_name: "report.pdf" } };
const commit = (key = "d258-full-restore-1", data = payload, lease = L) => `SELECT public.bot_media_ingest_commit_internal('${B}','${T}',${quote(key)},'${fp}','${lease}',${quote(JSON.stringify(data))}::jsonb);`;
const object = `INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('chat-media','${path}','{"size":68,"mimetype":"application/pdf"}'::jsonb);`;
const tx = text => q(`BEGIN; SET LOCAL statement_timeout='20s'; ${text} ROLLBACK;`);
const service = text => `SET LOCAL ROLE service_role; ${text} RESET ROLE;`;
const functions = ["bot_upload_authorize_internal", "bot_send_message_internal", "bot_message_command_internal"];
async function catalog() {
  return q(`SELECT json_build_object('functions',(SELECT json_agg(json_build_object('name',p.proname,'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
    'owner',p.proowner,'acl',p.proacl,'settings',p.proconfig,'volatility',p.provolatile,'definer',p.prosecdef) ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN(${functions.map(quote).join(",")})),
    'policies',(SELECT json_agg(json_build_object('name',p.polname,'roles',p.polroles,'command',p.polcmd,'permissive',p.polpermissive,
    'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass));`);
}
try {
  assert.equal(await docker(["ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"]), "");
  const hash = await command(["sha256sum", backup]);
  assert.equal(hash.code, 0); assert.equal(hash.stdout.split(/\s+/)[0], backupHash);
  id = await docker(["run", "-d", "--name", name, "--label", `letscube.bot-inline.owner=${owner}`, "--network", "none",
    "--memory", "512m", "--cpus", "1", "--pids-limit", "128", "--tmpfs", "/tmp:rw,size=256m,mode=1777", "--user", "postgres",
    "--entrypoint", "/bin/sleep", image, "infinity"]);
  await owned();
  await docker(["exec", id, "initdb", "-D", "/tmp/bot-inline", "-U", "supabase_admin", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  await docker(["exec", "-d", id, "postgres", "-D", "/tmp/bot-inline", "-c", "listen_addresses=", "-c", "unix_socket_directories=/tmp",
    "-c", "max_connections=40", "-c", "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements,supabase_vault",
    "-c", `cron.database_name=${db}`, "-c", "cron.launch_active_jobs=off", "-c", "pg_net.database_name=postgres"]);
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await command(["docker", "exec", id, "pg_isready", "-h", "/tmp"])).code === 0) { ready = true; break; }
    await delay(100);
  }
  assert.ok(ready); await q(`CREATE DATABASE ${db};`, "postgres");
  const roles = ["anon", "authenticated", "authenticator", "dashboard_user", "pgbouncer", "postgres", "service_role", "supabase_auth_admin",
    "supabase_etl_admin", "supabase_functions_admin", "supabase_privileged_role", "supabase_read_only_user", "supabase_realtime_admin",
    "supabase_replication_admin", "supabase_storage_admin"];
  const bypass = new Set(["postgres", "service_role", "supabase_etl_admin", "supabase_read_only_user"]);
  await q(roles.map(role => `CREATE ROLE ${role} NOLOGIN ${bypass.has(role) ? "BYPASSRLS" : "NOBYPASSRLS"};`).join("\n"), "postgres");
  const restored = await command(["bash", "-c", `docker exec -i ${id} pg_restore --exit-on-error --single-transaction -h /tmp -U supabase_admin -d ${db} < ${backup}`], "", 120_000);
  assert.equal(restored.code, 0, "full archive restore failed; private diagnostics suppressed");
  assert.equal(await q("SELECT current_setting('server_version')||':'||current_setting('cron.launch_active_jobs')||':'||current_setting('pg_net.database_name');"), "17.6:off:postgres");
  await q("ALTER ROLE supabase_admin SET search_path TO public,auth,extensions; ALTER ROLE postgres SUPERUSER;", "postgres");
  await owned(); console.log("RESTORE verified full PG17.6 archive; network=none, jobs=off, ports=0, host mounts=0");
  const before = await catalog();
  await q(`BEGIN; UPDATE public.registration_invite_settings SET invite_only_enabled=false WHERE id;
    INSERT INTO auth.users(id,raw_user_meta_data) VALUES('${U}','{"full_name":"D258 Isolated QA"}');
    INSERT INTO public.chats(id,name,type,created_by) VALUES('${C}','D258 isolated group','group','${U}');
    INSERT INTO public.bots(id,username,display_name) VALUES('${B}','d258_isolated_bot','D258 Isolated Bot');
    INSERT INTO public.chat_bot_members(chat_id,bot_id,privacy_mode,joined_at) VALUES('${C}','${B}','full',clock_timestamp()-interval '1 hour');
    INSERT INTO private.bot_tokens(id,bot_id,token_prefix,token_hash) VALUES('${T}','${B}','d258_synthetic_qa','${"0".repeat(64)}'); COMMIT;`);
  // RED checks use the shipped function, not a reimplemented mock.
  const lie = await tx(object + service(`SELECT count(*) FROM public.bot_upload_authorize_internal('${B}','${C}','chat-media','${path}','application/pdf',69,60);`));
  assert.equal(lie, "1"); console.log("EXPECTED RED shipped grant accepts a false size; positive object exists");
  await q(await readFile(new URL(`${stem}.sql`, root), "utf8"), undefined, true);
  await check("storage metadata lie rejected; exact attributes pass", async () => {
    await bad(object + service(`SELECT count(*) FROM public.bot_upload_authorize_internal('${B}','${C}','chat-media','${path}','application/pdf',69,60);`), "22023", "bot_upload_object_attributes_invalid");
    assert.equal(await tx(object + service(`SELECT count(*) FROM public.bot_upload_authorize_internal('${B}','${C}','chat-media','${path}','application/pdf',68,60);`)), "1");
  });
  await check("PDF ingest commits actual message, canonical metadata and consumed grant", async () => {
    const result = await tx(service(reserve()) + object + service(commit()) + `
      SELECT json_build_array((SELECT count(*) FROM public.messages WHERE chat_id='${C}' AND bot_id='${B}' AND type='file'),
      (SELECT media_metadata->>'file_name' FROM public.messages WHERE chat_id='${C}' AND bot_id='${B}'),
      (SELECT media_metadata->>'size_bytes' FROM public.messages WHERE chat_id='${C}' AND bot_id='${B}'),
      (SELECT state FROM private.bot_media_ingests WHERE bot_id='${B}'),
      (SELECT count(*) FROM private.bot_upload_grants WHERE bot_id='${B}' AND consumed_at IS NOT NULL));`);
    assert.deepEqual(JSON.parse(result.split("\n").at(-1)), [1, "report.pdf", "68", "complete", 1]);
  });
  await check("commit response loss preserves one receipt and one message", async () => {
    const result = await tx(service(reserve()) + object + service(commit() + commit() + reserve()) + `
      SELECT json_build_array((SELECT count(*) FROM public.messages WHERE chat_id='${C}' AND bot_id='${B}'),
      (SELECT count(*) FROM private.bot_media_ingests WHERE bot_id='${B}'));`);
    assert.deepEqual(JSON.parse(result.split("\n").at(-1)), [1, 1]);
  });
  await check("revocation after reservation and member removal both refuse commit", async () => {
    await bad(service(reserve()) + object + `UPDATE private.bot_tokens SET revoked_at=clock_timestamp() WHERE id='${T}';` + service(commit()), "42501", "bot_media_ingest_token_revoked");
    await bad(service(reserve()) + object + `UPDATE public.chat_bot_members SET removed_at=clock_timestamp() WHERE chat_id='${C}' AND bot_id='${B}';` + service(commit()), "42501", "bot_chat_forbidden");
  });
  await check("expired own lease is retryable, wrong lease remains forbidden; exact retry recovers", async () => {
    const expire = `UPDATE private.bot_media_ingests SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE bot_id='${B}';`;
    await bad(service(reserve()) + expire + service(commit()), "55000", "bot_media_ingest_lease_expired");
    const nextLease = "d2580000-0000-4000-8000-000000000006";
    await bad(service(reserve()) + service(commit(undefined, payload, nextLease)), "42501", "bot_ingest_lease_invalid");
    const result = await tx(service(reserve()) + expire + service(reserve(undefined, nextLease)) + object + service(commit(undefined, payload, nextLease)) +
      `SELECT count(*) FROM public.messages WHERE chat_id='${C}' AND bot_id='${B}';`);
    assert.equal(result.split("\n").at(-1), "1");
  });
  await check("ordinary authenticated storage cannot write the bot namespace", async () => {
    await bad(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${U}"}'; ${object}`, "42501", "row-level security");
    const ordinary = `${C}/qa-ordinary.pdf`;
    assert.equal(await tx(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${U}"}';
      INSERT INTO storage.objects(bucket_id,name) VALUES('chat-media','${ordinary}'); RESET ROLE;
      SELECT count(*) FROM storage.objects WHERE bucket_id='chat-media' AND name='${ordinary}';`), "1");
  });
  await check("safe rollback restores exact functions and prior Storage policies", async () => {
    await q(await readFile(new URL(`${stem}.rollback.sql`, root), "utf8"));
    assert.equal(await catalog(), before);
    assert.equal(await q("SELECT relrowsecurity FROM pg_class WHERE oid='private.bot_media_ingests'::regclass;"), "t");
    assert.equal(await q("SELECT count(*) FROM pg_proc WHERE proname IN ('bot_media_ingest_reserve_internal','bot_media_ingest_commit_internal');"), "0");
  });
  console.log(`SUMMARY ${checks} full-restore groups passed; production mutations=0; provider sends=0`);
} finally {
  if (id) { await owned(); await docker(["rm", "-f", id]); }
}
