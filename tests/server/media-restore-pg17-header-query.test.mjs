import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {assertPg17Header} from './media-restore-pg17-header.contract.mjs';
import {pg17HeaderQuerySql} from './media-restore-pg17-header-query.mjs';

// Independent literal REL_17_6 oracle, never imported from the producer or fixture.
const columns = {
  pg_type: [1247, 'oid:oid typname:name typnamespace:oid typowner:oid typlen:int2 typbyval:bool typtype:char typcategory:char typispreferred:bool typisdefined:bool typdelim:char typrelid:oid typsubscript:regproc typelem:oid typarray:oid typinput:regproc typoutput:regproc typreceive:regproc typsend:regproc typmodin:regproc typmodout:regproc typanalyze:regproc typalign:char typstorage:char typnotnull:bool typbasetype:oid typtypmod:int4 typndims:int4 typcollation:oid typdefaultbin:pg_node_tree typdefault:text typacl:_aclitem'],
  pg_enum: [3501, 'oid:oid enumtypid:oid enumsortorder:float4 enumlabel:name'],
  pg_range: [3541, 'rngtypid:oid rngsubtype:oid rngmultitypid:oid rngcollation:oid rngsubopc:oid rngcanonical:regproc rngsubdiff:regproc'],
  pg_constraint: [2606, 'oid:oid conname:name connamespace:oid contype:char condeferrable:bool condeferred:bool convalidated:bool conrelid:oid contypid:oid conindid:oid conparentid:oid confrelid:oid confupdtype:char confdeltype:char confmatchtype:char conislocal:bool coninhcount:int2 connoinherit:bool conkey:_int2 confkey:_int2 conpfeqop:_oid conppeqop:_oid conffeqop:_oid confdelsetcols:_int2 conexclop:_oid conbin:pg_node_tree'],
};
const functions = [
  {oid: 3954, name: 'pg_get_object_address', kind: 'f', volatility: 's', returnsSet: false, variadicTypeOid: 0,
    inputs: ['pg_catalog.text', 'pg_catalog._text', 'pg_catalog._text'], output: 'pg_catalog.record',
    allTypes: ['pg_catalog.text', 'pg_catalog._text', 'pg_catalog._text', 'pg_catalog.oid', 'pg_catalog.oid', 'pg_catalog.int4'],
    modes: ['i', 'i', 'i', 'o', 'o', 'o'], names: ['type', 'object_names', 'object_args', 'classid', 'objid', 'objsubid']},
  {oid: 3382, name: 'pg_identify_object_as_address', kind: 'f', volatility: 's', returnsSet: false, variadicTypeOid: 0,
    inputs: ['pg_catalog.oid', 'pg_catalog.oid', 'pg_catalog.int4'], output: 'pg_catalog.record',
    allTypes: ['pg_catalog.oid', 'pg_catalog.oid', 'pg_catalog.int4', 'pg_catalog.text', 'pg_catalog._text', 'pg_catalog._text'],
    modes: ['i', 'i', 'i', 'o', 'o', 'o'], names: ['classid', 'objid', 'objsubid', 'type', 'object_names', 'object_args']},
];
const expected = () => ({profileId: 'pg17.6-prerequisite', header: {serverVersionNum: 170006, catalogVersion: 202406281,
  catalogs: Object.fromEntries(Object.entries(columns).map(([name, [oid, manifest]]) => [name, {oid,
    attributes: manifest.split(' ').map(field => { const [name, type] = field.split(':'); return {name, type: 'pg_catalog.' + type}; }),
  }])), functions: structuredClone(functions)}});
const receipt = {scope: 'pg17-header/v1', evidence: 'supplied-header-only', fullRestoreApproved: false,
  pg17Accepted: false, runtimeApproved: false, productionApproved: false};
const refused = (payload, reason) => assert.throws(() => assertPg17Header(payload),
  error => error.code === 'pg17_header_refused' && error.reason === reason);
let db;

// Only test relation/control sources are redirected; SQL projection and native types stay intact.
function fictionalSql(sql) {
  for (const name of ['pg_class', 'pg_attribute', 'pg_type', 'pg_namespace', 'pg_proc', 'current_setting', 'pg_control_system']) {
    sql = sql.replaceAll('pg_catalog.' + name, 'header_query_fixture.' + name);
  }
  return sql;
}
async function capture(sql = pg17HeaderQuerySql, fictional = true) {
  const result = await db.query(fictional ? fictionalSql(sql) : sql);
  assert.equal(result.rows.length, 1); assert.deepEqual(result.fields.map(field => field.name), ['payload']);
  return result.rows[0].payload;
}
async function changed(sql, oracle, query = pg17HeaderQuerySql) {
  await db.exec('BEGIN');
  try { await db.exec(sql); await oracle(await capture(query)); }
  finally { await db.exec('ROLLBACK'); }
}
before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA header_query_fixture;
    CREATE TABLE header_query_fixture.control (server_version_num int4, catalog_version_no int4);
    INSERT INTO header_query_fixture.control VALUES (170006, 202406281);
    CREATE FUNCTION header_query_fixture.current_setting(setting text) RETURNS text LANGUAGE sql STABLE AS
      'SELECT CASE WHEN setting = ''server_version_num'' THEN server_version_num::text END FROM header_query_fixture.control';
    CREATE FUNCTION header_query_fixture.pg_control_system() RETURNS TABLE(catalog_version_no int4) LANGUAGE sql STABLE AS
      'SELECT catalog_version_no FROM header_query_fixture.control';
    CREATE TABLE header_query_fixture.pg_namespace (oid oid PRIMARY KEY, nspname name);
    INSERT INTO header_query_fixture.pg_namespace VALUES (11, 'pg_catalog'), (2200, 'public');
    CREATE TABLE header_query_fixture.pg_type (oid oid PRIMARY KEY, typname name, typnamespace oid);
    INSERT INTO header_query_fixture.pg_type VALUES
      (16, 'bool', 11), (18, 'char', 11), (19, 'name', 11), (21, 'int2', 11), (23, 'int4', 11),
      (24, 'regproc', 11), (25, 'text', 11), (26, 'oid', 11), (194, 'pg_node_tree', 11), (700, 'float4', 11),
      (1005, '_int2', 11), (1009, '_text', 11), (1028, '_oid', 11), (1034, '_aclitem', 11), (2249, 'record', 11);
    CREATE TABLE header_query_fixture.pg_class (oid oid PRIMARY KEY, relname name, relnamespace oid);
    CREATE TABLE header_query_fixture.pg_attribute
      (attrelid oid, attname name, atttypid oid, attnum int2, attisdropped bool DEFAULT false);
    CREATE TABLE header_query_fixture.pg_proc
      (oid oid PRIMARY KEY, proname name, pronamespace oid, prokind "char", provolatile "char", proretset bool,
       provariadic oid, proargtypes oidvector, prorettype oid, proallargtypes oid[], proargmodes "char"[], proargnames text[]);
    INSERT INTO header_query_fixture.pg_proc VALUES
      (3382, 'pg_identify_object_as_address', 11, 'f', 's', false, 0, '26 26 23', 2249,
        '{26,26,23,25,1009,1009}', '{i,i,i,o,o,o}', '{classid,objid,objsubid,type,object_names,object_args}'),
      (3954, 'pg_get_object_address', 11, 'f', 's', false, 0, '25 1009 1009', 2249,
        '{25,1009,1009,26,26,23}', '{i,i,i,o,o,o}', '{type,object_names,object_args,classid,objid,objsubid}');
  `);
  const types = new Map((await db.query('SELECT oid, typname FROM header_query_fixture.pg_type')).rows.map(row => [row.typname, row.oid]));
  // Insertion order deliberately opposes native attribute order.
  for (const [name, [oid, manifest]] of Object.entries(columns).reverse()) {
    await db.query('INSERT INTO header_query_fixture.pg_class VALUES ($1, $2, 11)', [oid, name]);
    const attributes = manifest.split(' ').map((field, i) => { const [name, type] = field.split(':'); return [oid, name, types.get(type), i + 1]; });
    for (const row of attributes.reverse()) await db.query('INSERT INTO header_query_fixture.pg_attribute (attrelid, attname, atttypid, attnum) VALUES ($1,$2,$3,$4)', row);
  }
});
after(async () => { if (db) await db.close(); });

test('fictional catalog SQL returns exact literal PG17 payload and diagnostic-only receipt', async () => {
  const payload = await capture(); assert.deepEqual(payload, expected()); assert.deepEqual(assertPg17Header(payload), receipt);
});

test('fixed query executes in a read-only transaction without writes', async () => {
  await db.exec('BEGIN READ ONLY');
  try {
    assert.equal((await db.query("SELECT current_setting('transaction_read_only') AS mode")).rows[0].mode, 'on');
    assert.deepEqual(await capture(), expected());
  } finally { await db.exec('ROLLBACK'); }
});
test('unadapted SQL reads installed PGlite native header and refuses it as non-PG17', async () => {
  const payload = await capture(pg17HeaderQuerySql, false);
  assert.equal(payload.header.serverVersionNum, 180003); assert.equal(payload.header.catalogVersion, 202506291);
  assert.equal(payload.header.catalogs.pg_constraint.attributes.length, 28);
  refused(payload, 'version');
});
test('native control values are observed, not replaced with the allowed literals', async () => {
  await changed('UPDATE header_query_fixture.control SET server_version_num=170011, catalog_version_no=202406282', payload => {
    assert.equal(payload.header.serverVersionNum, 170011); assert.equal(payload.header.catalogVersion, 202406282); refused(payload, 'version');
  });
});
for (const catalog of ['pg_type', 'pg_enum', 'pg_range', 'pg_constraint']) test(`missing ${catalog} is visible and refused`, async () => {
  await changed(`DELETE FROM header_query_fixture.pg_class WHERE relname='${catalog}'`, payload => {
    const literal = expected(); delete literal.header.catalogs[catalog]; assert.deepEqual(payload, literal); refused(payload, 'catalog-shape');
  });
});
test('empty selected catalog sources do not fabricate known shapes', async () => {
  await changed('DELETE FROM header_query_fixture.pg_class', payload => {
    assert.deepEqual(payload.header.catalogs, {}); refused(payload, 'catalog-shape');
  });
});
test('empty positive attribute source remains an empty array and refuses', async () => {
  await changed('DELETE FROM header_query_fixture.pg_attribute WHERE attrelid=3501', payload => {
    assert.deepEqual(payload.header.catalogs.pg_enum, {oid: 3501, attributes: []}); refused(payload, 'catalog-shape');
  });
});
const extraAttribute = "INSERT INTO header_query_fixture.pg_attribute VALUES (2606, 'conperiod', 16, 27, false)";
const extraOracle = payload => {
  assert.equal(payload.header.catalogs.pg_constraint.attributes.length, 27);
  assert.deepEqual(payload.header.catalogs.pg_constraint.attributes[26], {name: 'conperiod', type: 'pg_catalog.bool'});
  refused(payload, 'catalog-shape');
};
test('extra positive PG18-style field is retained rather than filtered to a PG17 shape', async () => {
  await changed(extraAttribute, extraOracle);
});
test('missing positive attribute is retained as loss rather than filled from the fixture', async () => {
  await changed("DELETE FROM header_query_fixture.pg_attribute WHERE attrelid=1247 AND attname='typacl'", payload => {
    assert.equal(payload.header.catalogs.pg_type.attributes.length, 31);
    assert.deepEqual(payload.header.catalogs.pg_type.attributes[30], {name: 'typdefault', type: 'pg_catalog.text'}); refused(payload, 'catalog-shape');
  });
});
test('only selected system relations and positive attribute numbers are captured', async () => {
  await changed(`INSERT INTO header_query_fixture.pg_attribute VALUES (1247,'negative_system',26,-1,false),(1247,'zero',26,0,false);
    INSERT INTO header_query_fixture.pg_class VALUES (91000,'pg_type',2200),(91001,'pg_attribute',11);
    INSERT INTO header_query_fixture.pg_attribute VALUES (91000,'shadow',26,1,false),(91001,'not_in_scope',26,1,false)`, payload => {
    assert.deepEqual(payload, expected()); assert.deepEqual(assertPg17Header(payload), receipt);
  });
});
const unknownAttribute = "INSERT INTO header_query_fixture.pg_attribute VALUES (2606, 'dropped_positive', 0, 27, true)";
const unknownAttributeOracle = payload => {
  assert.equal(payload.header.catalogs.pg_constraint.attributes.length, 27);
  assert.deepEqual(payload.header.catalogs.pg_constraint.attributes[26], {name: 'dropped_positive', type: null}); refused(payload, 'catalog-shape');
};
test('positive dropped or unresolved type rows stay visible instead of vanishing through a join', async () => {
  await changed(unknownAttribute, unknownAttributeOracle);
});
test('attribute types use their actual namespace rather than a forged pg_catalog prefix', async () => {
  await changed("UPDATE header_query_fixture.pg_type SET typnamespace=2200 WHERE oid=19", payload => {
    assert.deepEqual(payload.header.catalogs.pg_enum.attributes[3], {name: 'enumlabel', type: 'public.name'}); refused(payload, 'catalog-shape');
  });
});
test('missing type lookup retains all attribute slots with null types', async () => {
  await changed('DELETE FROM header_query_fixture.pg_type WHERE oid=19', payload => {
    assert.equal(payload.header.catalogs.pg_enum.attributes.length, 4);
    assert.deepEqual(payload.header.catalogs.pg_enum.attributes[3], {name: 'enumlabel', type: null}); refused(payload, 'catalog-shape');
  });
});
for (const oid of [3954, 3382]) test(`missing function ${oid} is visible and refused`, async () => {
  await changed(`DELETE FROM header_query_fixture.pg_proc WHERE oid=${oid}`, payload => {
    assert.deepEqual(payload.header.functions, functions.filter(row => row.oid !== oid)); refused(payload, 'function-shape');
  });
});
test('empty function capture stays empty and refuses', async () => {
  await changed('DELETE FROM header_query_fixture.pg_proc', payload => {
    assert.deepEqual(payload.header.functions, []); refused(payload, 'function-shape');
  });
});
const overload = `INSERT INTO header_query_fixture.pg_proc SELECT 90000,proname,pronamespace,prokind,provolatile,proretset,
  provariadic,'23'::oidvector,prorettype,proallargtypes,proargmodes,proargnames FROM header_query_fixture.pg_proc WHERE oid=3954`;
const overloadOracle = payload => {
  assert.deepEqual(payload.header.functions.map(row => row.oid), [3954, 90000, 3382]);
  assert.deepEqual(payload.header.functions[1].inputs, ['pg_catalog.int4']); refused(payload, 'function-shape');
};
test('unexpected overload and input signature are retained', async () => { await changed(overload, overloadOracle); });
const twoOverloads = overload + `;
  INSERT INTO header_query_fixture.pg_proc SELECT 1954,proname,pronamespace,prokind,provolatile,proretset,provariadic,
    proargtypes,prorettype,proallargtypes,proargmodes,proargnames FROM header_query_fixture.pg_proc WHERE oid=3954`;
const orderOracle = payload => {
  assert.deepEqual(payload.header.functions.map(row => row.oid), [1954, 3954, 90000, 3382]); refused(payload, 'function-shape');
};
test('overloads have deterministic C-name then numeric-OID ordering', async () => { await changed(twoOverloads, orderOracle); });
test('same proname outside pg_catalog and unrelated system functions are not the selected endpoints', async () => {
  await changed(`INSERT INTO header_query_fixture.pg_proc SELECT 90000,proname,2200,prokind,provolatile,proretset,
    provariadic,proargtypes,prorettype,proallargtypes,proargmodes,proargnames FROM header_query_fixture.pg_proc WHERE oid=3954;
    INSERT INTO header_query_fixture.pg_proc SELECT 90001,'not_selected',11,prokind,provolatile,proretset,
    provariadic,proargtypes,prorettype,proallargtypes,proargmodes,proargnames FROM header_query_fixture.pg_proc WHERE oid=3954`, payload => {
    assert.deepEqual(payload, expected()); assert.deepEqual(assertPg17Header(payload), receipt);
  });
});
for (const [field, column, literal, value] of [
  ['kind', 'prokind', "'p'", 'p'], ['volatility', 'provolatile', "'v'", 'v'],
  ['returnsSet', 'proretset', 'true', true], ['variadicTypeOid', 'provariadic', '25', 25],
  ['output', 'prorettype', '25', 'pg_catalog.text'],
]) test(`function ${field} is observed even when it violates the allowed signature`, async () => {
  await changed(`UPDATE header_query_fixture.pg_proc SET ${column}=${literal} WHERE oid=3954`, payload => {
    assert.equal(payload.header.functions[0][field], value); refused(payload, 'function-shape');
  });
});
test('unsigned OID values remain accurate JSON numbers, never int4 overflow or strings', async () => {
  await changed('UPDATE header_query_fixture.pg_proc SET oid=4294967295,provariadic=4294967295 WHERE oid=3954', payload => {
    assert.equal(payload.header.functions[0].oid, 4294967295); assert.equal(payload.header.functions[0].variadicTypeOid, 4294967295);
    refused(payload, 'function-shape');
  });
});
test('oidvector zero-based source preserves the first input and declared order', async () => {
  assert.equal((await db.query('SELECT array_lower(proargtypes,1) AS lower FROM header_query_fixture.pg_proc WHERE oid=3382')).rows[0].lower, 0);
  const payload = await capture(); assert.deepEqual(payload.header.functions[1].inputs, ['pg_catalog.oid', 'pg_catalog.oid', 'pg_catalog.int4']);
});
const unknownInput = "UPDATE header_query_fixture.pg_proc SET proargtypes='25 77777 1009' WHERE oid=3954";
const unknownInputOracle = payload => {
  assert.deepEqual(payload.header.functions[0].inputs, ['pg_catalog.text', null, 'pg_catalog._text']); refused(payload, 'function-shape');
};
test('unresolved IN argument type preserves its slot', async () => { await changed(unknownInput, unknownInputOracle); });
test('unresolved OUT argument type preserves its slot', async () => {
  await changed("UPDATE header_query_fixture.pg_proc SET proallargtypes='{25,1009,1009,26,26,77777}' WHERE oid=3954", payload => {
    assert.deepEqual(payload.header.functions[0].allTypes, ['pg_catalog.text', 'pg_catalog._text', 'pg_catalog._text', 'pg_catalog.oid', 'pg_catalog.oid', null]);
    refused(payload, 'function-shape');
  });
});
test('return type namespace and missing return type are not masked', async () => {
  await changed("INSERT INTO header_query_fixture.pg_type VALUES (99000,'record',2200); UPDATE header_query_fixture.pg_proc SET prorettype=99000 WHERE oid=3954", payload => {
    assert.equal(payload.header.functions[0].output, 'public.record'); refused(payload, 'function-shape');
  });
  await changed('UPDATE header_query_fixture.pg_proc SET prorettype=99001 WHERE oid=3954', payload => {
    assert.equal(payload.header.functions[0].output, null); refused(payload, 'function-shape');
  });
});
const modesChange = "UPDATE header_query_fixture.pg_proc SET proargmodes='{i,i,i,o,o,b}' WHERE oid=3954";
const modesOracle = payload => {
  assert.deepEqual(payload.header.functions[0].modes, ['i', 'i', 'i', 'o', 'o', 'b']); refused(payload, 'function-shape');
};
test('actual INOUT mode drift is captured and refused', async () => { await changed(modesChange, modesOracle); });
test('actual argument names including empty names are retained', async () => {
  await changed("UPDATE header_query_fixture.pg_proc SET proargnames='{type,object_args,object_names,classid,objid,\"\"}' WHERE oid=3954", payload => {
    assert.deepEqual(payload.header.functions[0].names, ['type', 'object_args', 'object_names', 'classid', 'objid', '']); refused(payload, 'function-shape');
  });
});
for (const [column, field] of [['proallargtypes', 'allTypes'], ['proargmodes', 'modes'], ['proargnames', 'names'], ['proargtypes', 'inputs']]) {
  test(`null ${column} stays null rather than becoming a known array`, async () => {
    await changed(`UPDATE header_query_fixture.pg_proc SET ${column}=NULL WHERE oid=3954`, payload => {
      assert.equal(payload.header.functions[0][field], null); refused(payload, 'function-shape');
    });
  });
}
test('empty argument arrays stay empty rather than becoming known signatures', async () => {
  await changed("UPDATE header_query_fixture.pg_proc SET proargtypes='',proallargtypes='{}',proargmodes='{}',proargnames='{}' WHERE oid=3954", payload => {
    for (const field of ['inputs', 'allTypes', 'modes', 'names']) assert.deepEqual(payload.header.functions[0][field], []);
    refused(payload, 'function-shape');
  });
});

async function compiled(before, after, count = 1) {
  const source = await readFile(new URL('./media-restore-pg17-header-query.mjs', import.meta.url), 'utf8');
  assert.equal(source.split(before).length - 1, count);
  return (await import('data:text/javascript;base64,' + Buffer.from(source.replaceAll(before, after)).toString('base64'))).pg17HeaderQuerySql;
}
const exactOracle = payload => assert.deepEqual(payload, expected());
for (const [name, before, after, edit, oracle, count = 1] of [
  ['extra attribute filtering', 'a.attnum > 0', "a.attnum > 0 AND a.attname <> 'conperiod'", extraAttribute, extraOracle],
  ['missing attribute capture', 'a.attnum > 0', "a.attnum > 0 AND a.attname <> 'typacl'", 'SELECT 1', exactOracle],
  ['overload filtering', "p.proname IN ('pg_get_object_address', 'pg_identify_object_as_address')",
    "p.proname IN ('pg_get_object_address', 'pg_identify_object_as_address') AND p.oid IN (3954,3382)", overload, overloadOracle],
  ['missing address function', "'pg_get_object_address', 'pg_identify_object_as_address'", "'pg_get_object_address'", 'SELECT 1', exactOracle],
  ['attribute namespace omission', "'type', tn.nspname::pg_catalog.text || '.' || t.typname::pg_catalog.text",
    "'type', t.typname::pg_catalog.text", 'SELECT 1', exactOracle],
  ['argument namespace omission', "SELECT tn.nspname::pg_catalog.text || '.' || t.typname::pg_catalog.text",
    'SELECT t.typname::pg_catalog.text', 'SELECT 1', exactOracle, 2],
  ['OUT types replaced by IN types', 'pg_catalog.unnest(p.proallargtypes)', 'pg_catalog.unnest(p.proargtypes::pg_catalog.oid[])', 'SELECT 1', exactOracle],
  ['mode normalization', "'modes', p.proargmodes", "'modes', ARRAY['i','i','i','o','o','o']::pg_catalog.text[]", modesChange, modesOracle],
  ['null argument names normalization', "'names', p.proargnames", "'names', COALESCE(p.proargnames, '{}'::pg_catalog.text[])",
    'UPDATE header_query_fixture.pg_proc SET proargnames=NULL WHERE oid=3954', payload => assert.equal(payload.header.functions[0].names, null)],
  ['attribute order', 'ORDER BY a.attnum', 'ORDER BY a.attnum DESC', 'SELECT 1', exactOracle],
  ['argument order', 'ORDER BY arg.position', 'ORDER BY arg.type_oid', 'SELECT 1', exactOracle, 2],
  ['function order', 'ORDER BY proname::pg_catalog.text COLLATE pg_catalog."C", oid',
    'ORDER BY proname::pg_catalog.text COLLATE pg_catalog."C" DESC, oid', 'SELECT 1', exactOracle],
  ['overload OID order', 'ORDER BY proname::pg_catalog.text COLLATE pg_catalog."C", oid',
    'ORDER BY proname::pg_catalog.text COLLATE pg_catalog."C", oid DESC', twoOverloads, orderOracle],
  ['unresolved attribute discarded', 'LEFT JOIN pg_catalog.pg_type AS t ON t.oid = a.atttypid',
    'JOIN pg_catalog.pg_type AS t ON t.oid = a.atttypid', unknownAttribute, unknownAttributeOracle],
  ['unresolved IN slot discarded', 'LEFT JOIN pg_catalog.pg_type AS t ON t.oid = arg.type_oid',
    'JOIN pg_catalog.pg_type AS t ON t.oid = arg.type_oid', unknownInput, unknownInputOracle, 2],
  ['server version forged', "pg_catalog.current_setting('server_version_num')::pg_catalog.int4", '170006',
    'UPDATE header_query_fixture.control SET server_version_num=170011', payload => assert.equal(payload.header.serverVersionNum, 170011)],
  ['catalog version forged', '(SELECT catalog_version_no FROM pg_catalog.pg_control_system())', '202406281',
    'UPDATE header_query_fixture.control SET catalog_version_no=202406282', payload => assert.equal(payload.header.catalogVersion, 202406282)],
  ['function OID JSON string', "'oid', p.oid::pg_catalog.int8", "'oid', p.oid", 'SELECT 1', exactOracle],
  ['variadic OID JSON string', "'variadicTypeOid', p.provariadic::pg_catalog.int8", "'variadicTypeOid', p.provariadic", 'SELECT 1', exactOracle],
]) test(`compiled SQL mutant ${name} fails an independent literal result oracle`, async () => {
  await changed(edit, oracle);
  const mutant = await compiled(before, after, count);
  await changed(edit, payload => assert.throws(() => oracle(payload), error => error.code === 'ERR_ASSERTION'), mutant);
});

test('all fixture mutation schedules roll back to the exact original header', async () => {
  assert.deepEqual(await capture(), expected());
});
