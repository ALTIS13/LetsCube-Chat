import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Schema metadata only; no rows, dumps, writes or production rehearsal.
const sql = `begin read only;
select jsonb_build_object('function','public.search_profiles_by_phone(text,integer)',
  'owner',pg_get_userbyid(proowner),
  'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex'),
  'source_sha256',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),
  'acl',proacl::text,'search_path',proconfig,'volatility',provolatile,'security_definer',prosecdef)
from pg_proc where oid='public.search_profiles_by_phone(text,integer)'::regprocedure;
commit;`;
const result = spawnSync('ssh', ['-i', 'C:/Users/maksi/.ssh/letscube_ed25519', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
  'root@ms.letscube.ru', 'docker exec -i supabase-db psql -X -qAt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres'],
{ input: sql, encoding: 'utf8', timeout: 15000 });
assert.equal(result.status, 0, result.stderr);
const live = JSON.parse(result.stdout.trim());
console.log(JSON.stringify(live));
assert.equal(live.owner, 'postgres', 'STOP: function owner drift');
assert.equal(live.definition_sha256, '53e17a81ab737d08e419aeaffbef8a16593c76ecd4e80c88afdb59b77006bbe6', 'STOP: exact RPC prestate drift');
assert.equal(live.acl, '{postgres=X/postgres,authenticated=X/postgres}', 'STOP: ACL drift');
assert.deepEqual(live.search_path, ['search_path=pg_catalog, public']);
assert.equal(live.volatility, 's');
assert.equal(live.security_definer, true);
console.log('PASS read-only exact production RPC prestate; no migration applied');
