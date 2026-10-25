import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";

const sourceUrl=new URL("../../artifacts/kub/src/lib/platform/localMediaExport.ts",import.meta.url);
const target=new URL("./local-media-export.test.mts",import.meta.url);
const source=readFileSync(sourceUrl,"utf8");
for(const [name,from,to] of [
  ["maximum-bytes","const MAX_BYTES = 32 * 1024 * 1024;","const MAX_BYTES = 64 * 1024 * 1024;"],
  ["chunk-size","const CHUNK_BYTES = 256 * 1024;","const CHUNK_BYTES = 128 * 1024;"],
  ["retirement","if (!input.isCurrent()) throw Error(\"local_media_export_retired\");","if (false) throw Error(\"local_media_export_retired\");"],
  ["abort","await bridge.abortLocal({ id }).catch(() => {});","await Promise.resolve();"],
])test(`local export mutation ${name} is rejected by behavioral assertions`,()=>{
  assert.equal(source.split(from).length,2);
  const mutated=source.replace(from,to);
  const harness=`import {registerHooks,stripTypeScriptTypes} from 'node:module';registerHooks({load(url,context,next){if(url===${JSON.stringify(sourceUrl.href)})return {format:'module',shortCircuit:true,source:stripTypeScriptTypes(${JSON.stringify(mutated)})};return next(url,context);}});await import(${JSON.stringify(target.href)});`;
  const result=spawnSync(process.execPath,["--input-type=module","-e",harness],{encoding:"utf8",windowsHide:true,timeout:20000,maxBuffer:1024*1024});
  assert.ok(!result.error&&!result.signal,"mutation runner completed");
  assert.equal(result.status,1,"behavioral suite must fail when its rule is omitted");
  assert.match(result.stdout+result.stderr,/AssertionError|Missing expected rejection|deep-equal/);
});
