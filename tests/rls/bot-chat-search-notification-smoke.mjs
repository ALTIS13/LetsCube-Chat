#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const container = `letscube-bot-task6-pg17-${process.pid}`;
const image = "postgres:17-alpine";
const commandDriver = process.env.BOT_PG_SMOKE_COMMAND_DRIVER || null;
const temp = mkdtempSync(join(tmpdir(), "letscube-bot-task6-pg17-"));
const files = {
  fixture: resolve(root, ".superpowers/sdd/2026-08-30-bot-platform/task-3-controller-disposable-fixture.sql"),
  migration: resolve(root, ".migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql"),
  smoke: resolve(root, "tests/server/bot-platform-db-smoke.sql"),
  concurrency: resolve(root, "tests/server/bot-platform-db-concurrency-probe.sql"),
};
const rehearsalMigration = resolve(temp, "migration-rehearsal.sql");
writeFileSync(
  rehearsalMigration,
  stripProposalTransaction(readFileSync(files.migration, "utf8")),
  "utf8",
);

let started = false;
try {
  run("docker", ["version", "--format", "{{.Server.Version}}"], { quiet: true });
  run("docker", ["run", "-d", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image], { quiet: true });
  started = true;
  waitForPostgres();

  runPsql(`
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$roles$;
`);

  for (const [name, source] of Object.entries(files)) {
    run("docker", ["cp", source, `${container}:/tmp/${name}.sql`]);
  }
  run("docker", ["cp", rehearsalMigration, `${container}:/tmp/migration-rehearsal.sql`]);

  runPsqlFile("/tmp/fixture.sql", "compatibility fixture");
  installProposalCompatibilitySchema();

  const schemaBefore = dumpSchema();
  console.log("Running proposal rollback rehearsal...");
  runPsql(`
begin;
\\i /tmp/migration-rehearsal.sql
rollback;
`);
  const schemaAfter = dumpSchema();
  assert(
    schemaAfter === schemaBefore,
    `proposal rollback changed schema: ${firstDifference(schemaBefore, schemaAfter)}`,
  );
  console.log("Proposal rollback rehearsal restored schema.");

  runPsqlFile("/tmp/migration.sql", "fresh proposal apply");
  runPsqlFile("/tmp/smoke.sql", "rollback smoke and role probes");

  const rollbackProbe = runPsql(
    "select current_setting('server_version_num'), count(*) from public.bots;",
    { tuplesOnly: true },
  ).trim();
  assert(/^17\d{4}\|0$/.test(rollbackProbe), `unexpected post-rollback state: ${rollbackProbe}`);

  runPsqlFile("/tmp/concurrency.sql", "two-session concurrency probes");
  console.log(`bot_chat_search_notification_smoke_ok|${rollbackProbe}`);
} finally {
  if (started) {
    spawnCommand("docker", ["rm", "-fv", container], { cwd: root, encoding: "utf8", stdio: "ignore" });
  }
  rmSync(temp, { recursive: true, force: true });
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // The official image briefly starts an init-only server on the Unix socket.
    // Probe TCP so the smoke continues only after the final server is listening.
    const ready = spawnCommand("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], {
      cwd: root,
      encoding: "utf8",
      stdio: "ignore",
    });
    if (ready.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error("PostgreSQL 17 did not become ready");
}

function dumpSchema() {
  const dump = run(
    "docker",
    [
      "exec",
      container,
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--schema-only",
      "--no-owner",
      "--no-privileges",
    ],
    { quiet: true },
  );
  return dump
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !/^\\(?:un)?restrict\b/.test(line.trim()))
    .join("\n")
    .trimEnd();
}

function runPsqlFile(path, label) {
  console.log(`Running ${label}...`);
  run("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", path]);
}

function installProposalCompatibilitySchema() {
  console.log("Installing proposal compatibility schema...");
  runPsql(`
create schema extensions;
create extension pg_trgm with schema extensions;
grant usage on schema extensions to authenticated;
alter table public.chat_members
  add column joined_at timestamptz not null default now(),
  add column last_read_at timestamptz null;
alter table public.profiles
  add column avatar_url text null;
grant select on table public.message_hidden_for_users to authenticated;
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text null,
  scope text not null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.permissions (
  key text primary key,
  name text not null,
  description text null,
  category text null
);
create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);
create table public.user_global_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid null references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
insert into public.roles (key, name, scope, is_system)
values
  ('owner', 'Owner', 'global', true),
  ('tech_admin', 'Technical administrator', 'global', true);
create function public.has_permission(p_user_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_global_roles assignment
    join public.roles role_row on role_row.id = assignment.role_id
    join public.role_permissions permission_row on permission_row.role_id = role_row.id
    where assignment.user_id = p_user_id
      and role_row.is_active is true
      and permission_row.permission_key = p_permission_key
  );
$function$;
`);
}

function runPsql(sql, { tuplesOnly = false } = {}) {
  const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
  if (tuplesOnly) args.push("-At");
  return run("docker", args, { input: sql, quiet: tuplesOnly });
}

function run(command, args, { input, quiet = false } = {}) {
  const result = spawnCommand(command, args, {
    cwd: root,
    encoding: "utf8",
    input,
    stdio: quiet ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    const detail = quiet ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout ?? "";
}

function spawnCommand(command, args, options) {
  return commandDriver
    ? spawnSync(process.execPath, [commandDriver, command, ...args], options)
    : spawnSync(command, args, options);
}

function stripProposalTransaction(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const executable = lines
    .map((line, index) => ({ index, value: line.trim() }))
    .filter(({ value }) => value && !value.startsWith("--"));
  const first = executable[0];
  const last = executable.at(-1);
  assert(first && /^begin;$/i.test(first.value), "proposal must start with top-level BEGIN");
  assert(last && /^commit;$/i.test(last.value), "proposal must end with top-level COMMIT");
  lines.splice(last.index, 1);
  lines.splice(first.index, 1);
  return `${lines.join("\n").trimEnd()}\n`;
}

function firstDifference(before, after) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const limit = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < limit; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      return `line ${index + 1}: before=${JSON.stringify(beforeLines[index] ?? null)} after=${JSON.stringify(afterLines[index] ?? null)}`;
    }
  }
  return "unknown mismatch";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
