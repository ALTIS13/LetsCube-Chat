import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadModule, parseSync } from 'libpg-query';

await loadModule();

const inputs = Object.freeze([
  ['2026-10-16-topic-notification-overrides.sql', '83b7108d0c4044c6d2e602f01fb6648d557265c6a32773a20d6d5dfa9ecb22ec'],
  ['2026-10-16-bound-push-delivery.sql', '3079c80c0132e95139ac841107676c96e42298b6a05b52b8178df61c1e47ce68'],
  ['2026-10-16-topic-notification-delivery.sql', 'e2d7c687152eceebe1954e1ec291d50f9af8d610d2bc2cd28fdaeb734edc5c7b'],
  ['2026-10-17-bound-native-album-delivery.sql', 'd9c2d8bc5831c025626db5b194240ec7ddcfb99ca4ae454630dd0fd142238bd4'],
  ['2026-10-17-notification-feed-v2.sql', '50133c513fb8e86d15e3dfd45066cc4e20c550e37ef85de84845b5ce9b001c89'],
  ['2026-10-17-notification-feed-v2-lifecycle.sql', '01e98d7e3af133c04b800e5ea65400dfbb26203dc06c300a56d17be47164dbf0'],
].map(([name, sha256]) => Object.freeze({ path: `docs/proposals/${name}`, sha256 })));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const need = (condition) => { if (!condition) throw Error('CANDIDATE_SQL_REFUSED'); };

// PG17's real grammar owns lexical boundaries, including byte offsets for UTF-8.
// Catalog and execution semantics still require the isolated full-schema run.
function statements(sql) {
  need(typeof sql === 'string' && sql.length > 0 && sql.length <= 6 * 1024 * 1024 && !sql.includes('\0'));
  let parsed;
  try { parsed = parseSync(sql); }
  catch { throw Error('CANDIDATE_SQL_REFUSED'); }
  need(parsed.version >= 170000 && parsed.version < 180000 && Array.isArray(parsed.stmts));
  return parsed.stmts;
}

const context = `DO $candidate_context$
BEGIN
  IF current_user <> session_user OR current_setting('standard_conforming_strings') <> 'on' THEN
    RAISE EXCEPTION 'candidate_execution_context_refused';
  END IF;
  PERFORM set_config('letscube.item77_search_path', current_setting('search_path'), true);
  PERFORM set_config('letscube.item77_lock_timeout', current_setting('lock_timeout'), true);
  PERFORM set_config('letscube.item77_statement_timeout', current_setting('statement_timeout'), true);
END $candidate_context$;`;
const resetContext = `SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;`;

export function composeTransactions(parts) {
  need(Array.isArray(parts) && parts.length >= 1 && parts.length <= 6);
  const bodies = parts.map((sql) => {
    const parsed = statements(sql);
    const first = parsed[0], last = parsed.at(-1), bytes = Buffer.from(sql);
    need(parsed.length >= 3 && first.stmt.TransactionStmt?.kind === 'TRANS_STMT_BEGIN'
      && last.stmt.TransactionStmt?.kind === 'TRANS_STMT_COMMIT'
      && !first.stmt.TransactionStmt.options && !last.stmt.TransactionStmt.chain
      && first.stmt_len > 0 && last.stmt_len > 0
      && bytes[(first.stmt_location ?? 0) + first.stmt_len] === 59
      && bytes[(last.stmt_location ?? 0) + last.stmt_len] === 59);
    for (const statement of parsed.slice(1, -1)) {
      need(!statement.stmt.TransactionStmt);
      const setting = statement.stmt.VariableSetStmt;
      need(!setting || setting.is_local === true && setting.kind === 'VAR_SET_VALUE'
        && ['role', 'search_path', 'lock_timeout', 'statement_timeout'].includes(setting.name));
    }
    const body = bytes.subarray((first.stmt_location ?? 0) + first.stmt_len + 1, last.stmt_location ?? 0).toString('utf8').trim();
    return `${resetContext}\n${body}`;
  });
  const sql = `-- Prepared item77 candidate; not a production apply.\nBEGIN;\n${context}\n${bodies.join('\n\n')}\nCOMMIT;\n`;
  const framed = statements(sql);
  need(framed[0].stmt.TransactionStmt?.kind === 'TRANS_STMT_BEGIN'
    && framed.at(-1).stmt.TransactionStmt?.kind === 'TRANS_STMT_COMMIT');
  return sql;
}

export async function loadTopicNotificationCandidate({ read = readFile } = {}) {
  const parts = [];
  for (const input of inputs) {
    let bytes;
    try { bytes = await read(new URL(`../${input.path}`, import.meta.url)); }
    catch { throw Error('CANDIDATE_INPUT_MISSING'); }
    if (!(bytes instanceof Uint8Array) || sha(bytes) !== input.sha256) throw Error('CANDIDATE_INPUT_DRIFT');
    parts.push(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  const sql = composeTransactions(parts);
  return { sql, sha256: sha(sql), inputs };
}
