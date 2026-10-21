import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { proposal } from './history-cache-page.fixture.mjs';

const receipt=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.equal(receipt.status,'NATIVE_PG17_MINIMAL_SCHEMA_METRICS_PASS');
assert.match(receipt.version,/^17\./);
assert.equal(receipt.productionMutations,false);
assert.equal(receipt.sqlSha256,createHash('sha256').update(await readFile(proposal)).digest('hex'));
const small=receipt.results.find(r=>r.rows===1000),large=receipt.results.find(r=>r.rows===100000);
assert.ok(small&&large);
// Same indexed private head/page100 over a100x larger corpus must not acquire
// near-linear relation/RLS work. This is not a device latency threshold.
for(const mode of ['fresh','match']) {
  assert.ok(large[mode].sharedHit<=small[mode].sharedHit*4,
    `${mode}: fixed page scanned growing history (${small[mode].sharedHit}->${large[mode].sharedHit} buffer hits)`);
}
assert.ok(large.matchBytes<large.freshBytes/10,'unchanged must omit bodies');
console.log('PASS_NATIVE_INDEXED_PAGE_COST_AND_BYTES');
