import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadModule, parseSync } from 'libpg-query';

const owner = '00000000-0000-4000-8000-000000000001';
const viewer = '00000000-0000-4000-8000-000000000002';
const task = '00000000-0000-4000-8000-000000000003';
const title = 'QA private coassignee rehearsal';

async function statements(path) {
  const source = await readFile(new URL(`../../${path}`, import.meta.url));
  await loadModule();
  return parseSync(source.toString()).stmts.map(({ stmt, stmt_location = 0, stmt_len }) => ({
    stmt, sql: source.subarray(stmt_location, stmt_len ? stmt_location + stmt_len : undefined).toString(),
  }));
}

const namesFunction = (stmt, name) => stmt.CreateFunctionStmt?.funcname
  .map(({ String: { sval } }) => sval).join('.') === `public.${name}`;

async function archivedFunction(file, name) {
  const rows = await statements(`.migration-backup/supabase/migrations/${file}.sql`);
  const matched = rows.filter(({ stmt }) => namesFunction(stmt, name));
  assert.equal(matched.length, 1, `expected one archived definition of ${name}`);
  return matched[0].sql;
}

const production = await (async () => {
  const migration = await statements('supabase/migrations/20260929100000_task_coassignees.sql');
  const table = migration.findIndex(({ stmt }) => stmt.CreateStmt?.relation.relname === 'task_coassignees');
  const policy = migration.findIndex(({ stmt }) => stmt.AlterPolicyStmt?.table.relname === 'tasks'
    && stmt.AlterPolicyStmt.policy_name === 'tasks select scoped');
  const rpc = migration.findIndex(({ stmt }) => namesFunction(stmt, 'task_set_coassignees'));
  assert.ok(table >= 0 && table < policy && policy < rpc);
  assert.ok(migration[rpc + 1].stmt.GrantStmt && migration[rpc + 2].stmt.GrantStmt);
  return {
    dependencies: (await Promise.all([
      archivedFunction('20260520_role_cleanup_task_filters_sanctions', '_task_visible_to_current_user_v3'),
      archivedFunction('20260521_task_soft_delete_owner_tech_admin', '_task_deleted_visible_to_current_user'),
      archivedFunction('20260504_notifications', '_notify'),
      archivedFunction('20260504_tasks_system', 'task_append_event'),
    ])).join(';\n'),
    membership: migration.slice(table, policy).map(({ sql }) => sql).join(';\n'),
    policy: migration[policy].sql,
    rpc: migration[rpc].sql,
    grants: migration.slice(rpc + 1, rpc + 3).map(({ sql }) => sql).join(';\n'),
  };
})();

// Only the schema shape, Auth claim reader and unrelated permission lookups
// are fixture code. There are no delivery integrations in this database.
const fixture = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  grant usage on schema auth to authenticated;
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
  $$;
  create type public.task_visibility as enum ('private', 'chat', 'staff');
  create type public.task_assignment_scope as enum ('user', 'staff_pool', 'manager_pool');
  create table public.profiles (id uuid primary key);
  create table public.location_members (location_id uuid, user_id uuid);
  create table public.tasks (
    id uuid primary key, title text, created_by uuid, assignee_id uuid,
    status text, priority text, visibility public.task_visibility, assignment_scope public.task_assignment_scope,
    chat_id uuid, location_id uuid, target_role text, route_admin_id uuid, created_for_admin boolean default false,
    deleted_at timestamptz, updated_at timestamptz default now()
  );
  create table public.task_events (task_id uuid, actor_id uuid, kind text, payload jsonb);
  create table public.notifications (user_id uuid, kind text, payload jsonb);
  alter table public.tasks enable row level security;
  create policy "tasks select scoped" on public.tasks for select to authenticated using (false);
  grant select on public.tasks to authenticated;
  create function public.is_banned(uuid) returns boolean language sql stable as $$select false$$;
  create function public.is_manager_or_admin(uuid) returns boolean language sql stable as $$select false$$;
  create function public.is_location_admin(uuid, uuid) returns boolean language sql stable as $$select false$$;
  create function public.has_permission(uuid, text) returns boolean language sql stable as $$select false$$;
  create function public.has_location_permission(uuid, uuid, text) returns boolean language sql stable as $$select false$$;
  create function public.is_chat_member(uuid) returns boolean language sql stable as $$select false$$;
`;

async function asActor(db, user, fn) {
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: 'authenticated' })]);
  await db.exec('set local role authenticated');
  const { rows } = await db.query(`select current_user as role, auth.uid() as id,
    row_security_active('public.tasks') and row_security_active('public.task_coassignees') as rls`);
  assert.deepEqual(rows, [{ role: 'authenticated', id: user, rls: true }]);
  await fn();
  await db.exec('reset role');
}

async function rehearse({ dependencies, membership, policy, rpc, grants } = production) {
  const db = new PGlite();
  const replace = (ids) => db.query('select public.task_set_coassignees($1, $2::uuid[])', [task, ids]);
  const visible = () => db.query('select id from public.tasks where id = $1', [task]);
  const notice = {
    user_id: viewer, kind: 'task_assigned',
    payload: { task_id: task, title, priority: 'normal', actor_id: owner, coassignee: true },
  };
  try {
    await db.exec('begin');
    try {
      await db.exec([fixture, dependencies, membership, policy, rpc, grants].join(';\n'));
      await db.query('insert into public.profiles values ($1), ($2)', [owner, viewer]);
      await db.query(`insert into public.tasks (id, title, created_by, assignee_id, status, priority, visibility, assignment_scope)
        values ($1, $2, $3, $3, 'new', 'normal', 'private', 'user')`, [task, title, owner]);

      for (const [step, wanted, rows, notifications] of [
        [0, null,     0, 0], [1, [viewer], 1, 1], [2, [], 0, 1],
        [3, [viewer], 1, 2], [4, [],       0, 2],
      ]) {
        await asActor(db, owner, async () => {
          assert.deepEqual((await visible()).rows, [{ id: task }]);
          if (wanted !== null) await replace(wanted);
        });
        await asActor(db, viewer, async () => {
          assert.equal((await visible()).rows.length, rows, `viewer task rows at step ${step}`);
          if (step === 1) {
            await db.exec('savepoint viewer_replacement');
            try {
              await assert.rejects(() => replace([]), { code: '42501', message: 'forbidden' }, 'viewer replacement');
            } finally {
              await db.exec('rollback to viewer_replacement; release viewer_replacement');
            }
            assert.deepEqual((await visible()).rows, [{ id: task }]);
          }
        });
        assert.deepEqual((await db.query('select user_id, added_by from public.task_coassignees where task_id = $1', [task])).rows,
          rows ? [{ user_id: viewer, added_by: owner }] : []);
        assert.deepEqual((await db.query('select * from public.notifications')).rows,
          Array(notifications).fill(notice), `assignment notifications at step ${step}`);
        assert.equal((await db.query('select count(*)::int as count from public.task_events where task_id = $1', [task])).rows[0].count, step);
      }
    } finally {
      await db.exec('rollback');
      assert.deepEqual((await db.query("select to_regclass('public.tasks') as task, to_regclass('public.notifications') as notifications")).rows,
        [{ task: null, notifications: null }]);
    }
  } finally {
    await db.close();
  }
}

test('actual coassignee RPC grants, revokes, restores and revokes private visibility', () => rehearse());

for (const [name, field, before, after, expected] of [
  ['missing RLS branch', 'policy', ' OR _task_coassigned_to_me(id)', '', /viewer task rows at step 1/],
  ['skipped revocation', 'rpc', 'and user_id = any (v_removed);', 'and false;', /viewer task rows at step 2/],
  ['viewer write bypass', 'rpc', "raise exception 'forbidden' using errcode = '42501';", 'null;', /viewer replacement/],
  ['missing assignment notice', 'rpc', 'if v_user is distinct from v_caller then', 'if false then', /assignment notifications at step 1/],
]) {
  test(`rejects regression: ${name}`, async () => {
    assert.equal(production[field].split(before).length, 2, 'mutate exactly one production clause');
    await assert.rejects(() => rehearse({ ...production, [field]: production[field].replace(before, after) }), expected);
  });
}
