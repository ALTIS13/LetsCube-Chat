import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const moduleUrl = new URL('../../scripts/topic-notification-candidate.mjs', import.meta.url);
let candidate;
try { await access(moduleUrl); candidate = await import(moduleUrl); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  // Existing draft application commits each stage separately; this is the RED baseline.
  candidate = { composeTransactions: (parts) => parts.join('\n') };
}
const { composeTransactions } = candidate;

test('a later stage failure leaves neither earlier nor later schema changes', async () => {
  const db = new PGlite();
  try {
    const sql = composeTransactions([
      'BEGIN; CREATE TABLE first_stage(id integer); COMMIT;',
      "BEGIN; CREATE TABLE later_stage(id integer); DO $$BEGIN RAISE EXCEPTION 'fixture_fault'; END$$; COMMIT;",
    ]);
    await assert.rejects(db.exec(sql), /fixture_fault/);
    await db.exec('ROLLBACK;');
    assert.deepEqual((await db.query("SELECT to_regclass('first_stage')::text AS first, to_regclass('later_stage')::text AS later")).rows,
      [{ first: null, later: null }]);
  } finally { await db.close(); }
});

test('two successful stages commit together without discarding quoted contents', async () => {
  const db = new PGlite();
  try {
    await db.exec(composeTransactions([
      "/* BEGIN; */ BEGIN; CREATE TABLE candidate_values(value text); INSERT INTO candidate_values VALUES('COMMIT;'); COMMIT;",
      "BEGIN; INSERT INTO candidate_values VALUES($text$ROLLBACK; -- not a boundary$text$); COMMIT; -- END;",
    ]));
    assert.deepEqual((await db.query('SELECT value FROM candidate_values ORDER BY value')).rows,
      [{ value: 'COMMIT;' }, { value: 'ROLLBACK; -- not a boundary' }]);
  } finally { await db.close(); }
});

test('a LOCAL role in one original transaction cannot leak into the next stage', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE stage_owner; GRANT USAGE, CREATE ON SCHEMA public TO stage_owner;');
    await db.exec(composeTransactions([
      'BEGIN; SET LOCAL ROLE stage_owner; CREATE TABLE stage_owned(id integer); COMMIT;',
      'BEGIN; CREATE TABLE session_owned(id integer); COMMIT;',
    ]));
    assert.deepEqual((await db.query("SELECT c.relname, r.rolname = session_user AS session_owned FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.relname IN ('stage_owned','session_owned') ORDER BY c.relname")).rows,
      [{ relname: 'session_owned', session_owned: true }, { relname: 'stage_owned', session_owned: false }]);
  } finally { await db.close(); }
});

test('a pre-existing bounded caller role refuses before any DDL', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE bounded_caller; GRANT USAGE, CREATE ON SCHEMA public TO bounded_caller; SET ROLE bounded_caller;');
    await assert.rejects(db.exec(composeTransactions(['BEGIN; CREATE TABLE context_refused(id integer); COMMIT;'])), /candidate_execution_context_refused/);
    await db.exec('ROLLBACK; RESET ROLE;');
    assert.equal((await db.query("SELECT to_regclass('context_refused')::text AS value")).rows[0].value, null);
  } finally { await db.close(); }
});

test('each stage starts with its own baseline for every supported LOCAL setting', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE SCHEMA first_schema;');
    await db.exec(composeTransactions([
      "BEGIN; SET LOCAL search_path=first_schema; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='3s'; CREATE TABLE first_table(id integer); COMMIT;",
      "BEGIN; CREATE TABLE later_table(id integer); INSERT INTO later_table SELECT 1 WHERE current_setting('lock_timeout')='0' AND current_setting('statement_timeout')='0'; COMMIT;",
    ]));
    assert.deepEqual((await db.query("SELECT to_regclass('public.later_table')::text AS later, to_regclass('first_schema.later_table')::text AS leaked")).rows,
      [{ later: 'later_table', leaked: null }]);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.later_table')).rows[0].n, 1);
  } finally { await db.close(); }
});

for (const sql of [
  'BEGIN; SELECT 1; -- comment\rCOMMIT; SELECT 2;\nSELECT 3; COMMIT;',
  'BEGIN; SELECT 1 AS \u0435$tag$; COMMIT; SELECT 2 AS \u0431$tag$; COMMIT;',
]) {
  test(`PostgreSQL lexical boundaries cannot be hidden by ${sql.includes('\r') ? 'CR comments' : 'Unicode identifiers'}`, () => {
    assert.throws(() => composeTransactions([sql]), /CANDIDATE_SQL_REFUSED/);
  });
}

for (const boundary of ['COMMIT;', 'ROLLBACK;', 'ABORT;', 'END;', 'START TRANSACTION;',
  'SAVEPOINT nested;', 'RELEASE SAVEPOINT nested;', "PREPARE TRANSACTION 'nested';", 'SET TRANSACTION READ ONLY;']) {
  test(`rejects an embedded ${boundary.split(' ')[0]} boundary before execution`, () => {
    assert.throws(() => composeTransactions([`BEGIN; SELECT 1; ${boundary} SELECT 2; COMMIT;`]), /CANDIDATE_SQL_REFUSED/);
  });
}

for (const sql of [
  'SELECT 1; BEGIN; SELECT 2; COMMIT;', 'BEGIN; SELECT 1; COMMIT; SELECT 2;',
  'BEGIN; SELECT 1; COMMIT', 'BEGIN; SELECT 1; /* unterminated',
  "BEGIN; SELECT 'unterminated; COMMIT;", 'BEGIN; DO $fn$ BEGIN NULL; END; COMMIT;',
  'BEGIN; SELECT 1; \\echo secret\nCOMMIT;', 'BEGIN; SET standard_conforming_strings=off; COMMIT;',
  'BEGIN; SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE; COMMIT;',
  'BEGIN; SET LOCAL "standard_conforming_strings"=off; COMMIT;',
  'BEGIN; SET LOCAL app.unknown=on; COMMIT;',
]) {
  test(`refuses malformed or session-altering input ${JSON.stringify(sql)}`, () => {
    assert.throws(() => composeTransactions([sql]), /CANDIDATE_SQL_REFUSED/);
  });
}

test('nested comments, E strings and quoted identifiers cannot hide a real boundary', () => {
  const sql = composeTransactions([
    '/* outer /* COMMIT; */ still comment */ BEGIN; SELECT E\'it\\\'s; COMMIT;\', "ROLLBACK;"; COMMIT;',
  ]);
  assert.ok(sql.includes("E'it\\'s; COMMIT;'"));
  assert.throws(() => composeTransactions([
    'BEGIN; SELECT E\'it\\\'s; COMMIT;\'; /* nested /* comment */ */ ROLLBACK; COMMIT;',
  ]), /CANDIDATE_SQL_REFUSED/);
});

test('empty, over-budget and non-string stages never form an execution artifact', () => {
  for (const parts of [[], Array(7).fill('BEGIN; SELECT 1; COMMIT;'), [null], ['BEGIN; SELECT 1; COMMIT;\0'],
    ['BEGIN; /*' + ' '.repeat(6 * 1024 * 1024) + '*/ SELECT 1; COMMIT;']]) {
    assert.throws(() => composeTransactions(parts), /CANDIDATE_SQL_REFUSED/);
  }
});

test('only the six frozen drafts in dependency order form the actual candidate', async () => {
  assert.equal(typeof candidate.loadTopicNotificationCandidate, 'function');
  const result = await candidate.loadTopicNotificationCandidate();
  assert.deepEqual(result.inputs.map((input) => input.path), [
    'docs/proposals/2026-10-16-topic-notification-overrides.sql',
    'docs/proposals/2026-10-16-bound-push-delivery.sql',
    'docs/proposals/2026-10-16-topic-notification-delivery.sql',
    'docs/proposals/2026-10-17-bound-native-album-delivery.sql',
    'docs/proposals/2026-10-17-notification-feed-v2.sql',
    'docs/proposals/2026-10-17-notification-feed-v2-lifecycle.sql',
  ]);
  assert.equal(result.inputs.length, 6);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.sql.indexOf('CREATE TABLE public.topic_notification_preferences') < result.sql.indexOf('CREATE TABLE public.notification_feed_events_v2'));
  assert.equal(result.sql.startsWith('-- Prepared item77 candidate; not a production apply.\nBEGIN;\n'), true);
});

test('changed bytes and absent inputs refuse instead of silently updating pins', async () => {
  assert.equal(typeof candidate.loadTopicNotificationCandidate, 'function');
  await assert.rejects(candidate.loadTopicNotificationCandidate({
    read: async (url) => Buffer.concat([await readFile(url), Buffer.from('\n-- changed')]),
  }), /CANDIDATE_INPUT_DRIFT/);
  await assert.rejects(candidate.loadTopicNotificationCandidate({ read: async () => { throw Object.assign(Error('fixture'), { code: 'ENOENT' }); } }),
    /CANDIDATE_INPUT_MISSING/);
});

test('compiled pin, boundary, budget and role omissions are killed by independent assertions', async () => {
  const source = await readFile(moduleUrl, 'utf8');
  const checks = [
    ['parts.length <= 6', 'parts.length <= 7', (m) => assert.throws(() => m.composeTransactions(Array(7).fill('BEGIN; SELECT 1; COMMIT;')))],
    ['sql.length <= 6 * 1024 * 1024', 'sql.length <= 7 * 1024 * 1024', (m) => assert.throws(() => m.composeTransactions(['BEGIN; /*' + ' '.repeat(6 * 1024 * 1024) + '*/ SELECT 1; COMMIT;']))],
    ["sha(bytes) !== input.sha256", 'false', async (m) => assert.rejects(m.loadTopicNotificationCandidate({ read: async (url) => Buffer.concat([await readFile(url), Buffer.from('\n-- changed')]) }))],
    ['need(!statement.stmt.TransactionStmt);', 'need(true);', (m) => assert.throws(() => m.composeTransactions(['BEGIN; SELECT 1; COMMIT; SELECT 2; COMMIT;']))],
    ['SET LOCAL ROLE NONE;', '', async (m) => {
      const db = new PGlite();
      try {
        await db.exec('CREATE ROLE stage_owner; GRANT USAGE, CREATE ON SCHEMA public TO stage_owner;');
        await db.exec(m.composeTransactions(['BEGIN; SET LOCAL ROLE stage_owner; SELECT 1; COMMIT;', 'BEGIN; CREATE TABLE owned_after(id integer); COMMIT;']));
        assert.equal((await db.query("SELECT relowner=session_user::regrole AS owned FROM pg_class WHERE relname='owned_after'")).rows[0].owned, true);
      } finally { await db.close(); }
    }],
    ["current_user <> session_user", 'false', async (m) => {
      const db = new PGlite();
      try {
        await db.exec('CREATE ROLE bounded_caller; SET ROLE bounded_caller;');
        await assert.rejects(db.exec(m.composeTransactions(['BEGIN; SELECT 1; COMMIT;'])), /candidate_execution_context_refused/);
      } finally { await db.close(); }
    }],
    ["PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);", 'NULL;', async (m) => {
      const db = new PGlite();
      try {
        await db.exec('CREATE SCHEMA isolated_stage;');
        await db.exec(m.composeTransactions(['BEGIN; SET LOCAL search_path=isolated_stage; SELECT 1; COMMIT;',
          'BEGIN; CREATE TABLE baseline_table(id integer); COMMIT;']));
        assert.equal((await db.query("SELECT to_regclass('public.baseline_table')::text AS value")).rows[0].value, 'baseline_table');
      } finally { await db.close(); }
    }],
  ];
  for (const [before, after, check] of checks) {
    assert.equal(source.split(before).length, 2, 'one exact omission site');
    const altered = source.replace(before, after).replaceAll('import.meta.url', JSON.stringify(moduleUrl.href))
      .replace("from 'libpg-query'", `from ${JSON.stringify(import.meta.resolve('libpg-query'))}`);
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(altered).toString('base64')}`);
    await assert.rejects(async () => check(mutant), { name: 'AssertionError' });
  }
});
