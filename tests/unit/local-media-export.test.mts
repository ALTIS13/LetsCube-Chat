import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { exportLocalMedia, LocalMediaUnavailableError, type LocalMediaBridge } from "../../artifacts/kub/src/lib/platform/localMediaExport.ts";

const id = "11111111-1111-4111-8111-111111111111";
function fixture(overrides: Partial<LocalMediaBridge> = {}) {
  const calls: string[] = [], chunks: { offset: number; bytes: Buffer }[] = [];
  let declared: unknown;
  const bridge: LocalMediaBridge = {
    async localCapabilities() { calls.push("caps"); return {version:1,maxBytes:33554432,chunkBytes:262144}; },
    async beginLocal(input) { calls.push("begin"); declared = input; return {id}; },
    async appendLocal(input) { calls.push("append"); assert.equal(input.id, id); const bytes = Buffer.from(input.data, "base64"); chunks.push({offset:input.offset,bytes}); return {written:input.offset+bytes.length}; },
    async finishLocal(input) { calls.push("finish"); assert.equal(input.id,id); return {saved:true,location:"Pictures/LETSCUBE"}; },
    async abortLocal(input) { calls.push("abort"); assert.equal(input.id,id); },
    ...overrides,
  };
  return {bridge,calls,chunks,declared:()=>declared};
}

test("local original is chunked, byte exact, SHA-bound and never sent as a URL", async () => {
  const f=fixture(), bytes=Buffer.alloc(524305,27); bytes[262143]=123; bytes[524304]=42;
  const result=await exportLocalMedia(f.bridge,{blob:new Blob([bytes],{type:"image/png"}),fileName:"original.jpg",isCurrent:()=>true});
  assert.deepEqual(result,{saved:true,location:"Pictures/LETSCUBE"});
  assert.deepEqual(f.calls,["caps","begin","append","append","append","finish"]);
  assert.deepEqual(f.chunks.map(c=>[c.offset,c.bytes.length]),[[0,262144],[262144,262144],[524288,17]]);
  assert.deepEqual(Buffer.concat(f.chunks.map(c=>c.bytes)),bytes);
  assert.deepEqual(f.declared(),{fileName:"original.png",mimeType:"image/png",size:524305,sha256:createHash("sha256").update(bytes).digest("hex")});
});

test("local metadata and literal 32MiB ceiling refuse before invoking native code", async () => {
  for (const input of [
    {blob:new Blob([],{type:"image/png"}),fileName:"a.png"},
    {blob:new Blob([new Uint8Array(33554433)],{type:"image/png"}),fileName:"a.png"},
    {blob:new Blob(["svg"],{type:"image/svg+xml"}),fileName:"a.svg"},
    {blob:new Blob(["html"],{type:"text/html"}),fileName:"a.png"},
    {blob:new Blob(["image"],{type:"image/png"}),fileName:"../a.png"},
  ]) {
    const f=fixture();
    await assert.rejects(exportLocalMedia(f.bridge,{...input,isCurrent:()=>true})); assert.deepEqual(f.calls,[]);
  }
});

test("missing local capability is distinguishable; an arbitrary bridge failure is not", async () => {
  const options={blob:new Blob(["original"],{type:"image/jpeg"}),fileName:"a.jpeg",isCurrent:()=>true};
  const unsupported=fixture({async localCapabilities(){return {version:0,maxBytes:0,chunkBytes:0};}});
  await assert.rejects(exportLocalMedia(unsupported.bridge,options),LocalMediaUnavailableError);
  for(const code of ["UNIMPLEMENTED","UNAVAILABLE"]) {
    const f=fixture({async localCapabilities(){throw Object.assign(new Error("synthetic"),{code});}});
    await assert.rejects(exportLocalMedia(f.bridge,options),LocalMediaUnavailableError);
  }
  const failed=fixture({async localCapabilities(){throw Error("synthetic transport failure");}});
  await assert.rejects(exportLocalMedia(failed.bridge,options),/synthetic transport failure/);
});

test("legacy binary Content-Type keeps its known image extension without re-encoding", async()=>{
  const f=fixture();
  await exportLocalMedia(f.bridge,{blob:new Blob(["synthetic original"],{type:"application/octet-stream"}),fileName:"original.webp",isCurrent:()=>true});
  assert.equal((f.declared() as {mimeType:string}).mimeType,"image/webp");
  assert.equal(Buffer.concat(f.chunks.map(c=>c.bytes)).toString(),"synthetic original");
});
test("known original MIME disambiguates a binary Blob while actual MIME takes precedence",async()=>{
  for(const [type,hint,expected] of [["application/octet-stream","image/webp","image/webp"],["image/png","image/webp","image/png"]]){
    const f=fixture();
    await exportLocalMedia(f.bridge,{blob:new Blob(["synthetic original"],{type}),fileName:"original.jpg",mimeType:hint,isCurrent:()=>true});
    const declared=f.declared() as {mimeType:string;fileName:string};
    assert.equal(declared.mimeType,expected);assert.equal(declared.fileName,expected==="image/webp"?"original.webp":"original.png");
  }
});

test("privacy retirement at each bridge await refuses late continuation and aborts only an admitted session", async () => {
  for(const boundary of ["initial","caps","begin","append"] as const) {
    let current=boundary!=="initial";
    const f=fixture(), original={...f.bridge};
    f.bridge.localCapabilities=async()=>{const value=await original.localCapabilities();if(boundary==="caps")current=false;return value;};
    f.bridge.beginLocal=async input=>{const value=await original.beginLocal(input);if(boundary==="begin")current=false;return value;};
    f.bridge.appendLocal=async input=>{const value=await original.appendLocal(input);if(boundary==="append")current=false;return value;};
    await assert.rejects(exportLocalMedia(f.bridge,{blob:new Blob(["original"],{type:"image/png"}),fileName:"a.png",isCurrent:()=>current}),/retired/);
    assert.ok(!f.calls.includes("finish"));
    assert.equal(f.calls.includes("abort"),boundary==="begin"||boundary==="append");
  }
});

test("retirement while preparing the digest never starts a session", async () => {
  let current=true; const f=fixture(),blob=new Blob(["original"],{type:"image/png"});
  const read=blob.arrayBuffer.bind(blob);
  blob.arrayBuffer=async()=>{const value=await read();current=false;return value;};
  await assert.rejects(exportLocalMedia(f.bridge,{blob,fileName:"a.png",isCurrent:()=>current}),/retired/);
  assert.deepEqual(f.calls,["caps"]);
});

test("wrong acknowledged offset and transfer failure abort without publishing", async () => {
  for(const failure of ["offset","append","finish"] as const) {
    const f=fixture(),original={...f.bridge};
    f.bridge.appendLocal=async input=>{
      if(failure==="append")throw Error("synthetic append failure");
      const value=await original.appendLocal(input);return failure==="offset"?{written:value.written+1}:value;
    };
    f.bridge.finishLocal=async input=>{if(failure==="finish")throw Error("synthetic finish failure");return original.finishLocal(input);};
    await assert.rejects(exportLocalMedia(f.bridge,{blob:new Blob(["original"],{type:"video/mp4"}),fileName:"clip.mp4",isCurrent:()=>true}));
    assert.equal(f.calls.at(-1),"abort");assert.ok(!f.calls.includes("finish"));
  }
});
