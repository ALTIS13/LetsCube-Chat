import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('SQL category ranges match built-in Unicode engine for every scalar',async()=>{
  const source=await readFile(new URL('../../../supabase/migrations/20261001180000_member_mentions.sql',import.meta.url),'utf8');
  for(const [name,pattern] of [['nonvisible',/[\p{Z}\p{M}\p{Cf}]/u],['letter_number',/[\p{L}\p{N}]/u]]) {
    const literal=source.match(new RegExp("WHEN '"+name+"' THEN p_code <@ '\\{([^}]+)\\}'"))?.[1];
    assert.ok(literal);
    const ranges=[...literal.matchAll(/\[(\d+),(\d+)\)/g)].map(m=>[Number(m[1]),Number(m[2])]);
    let range=0;
    for(let cp=0;cp<0x110000;cp++) {
      while(range<ranges.length&&cp>=ranges[range][1])range++;
      const actual=range<ranges.length&&cp>=ranges[range][0];
      assert.equal(actual,pattern.test(String.fromCodePoint(cp)),name+' scalar '+cp);
    }
  }
});
