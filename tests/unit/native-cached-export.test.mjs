import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../../",import.meta.url));
const require=createRequire(new URL("../../artifacts/kub/package.json",import.meta.url));
const {build}=createRequire(require.resolve("vite/package.json"))("esbuild");
const built=await build({entryPoints:[root+"artifacts/kub/src/lib/platform/nativeMediaExport.ts"],bundle:true,write:false,format:"esm",platform:"browser",plugins:[{
  name:"synthetic-native-boundaries",setup(build){
    build.onResolve({filter:/^@capacitor\/core$|^\.\/capabilities$|mediaCache\/objectUrls$/},args=>({path:args.path,namespace:"qa"}));
    build.onLoad({filter:/.*/,namespace:"qa"},args=>({loader:"js",contents:args.path.includes("capacitor")
      ?"export const registerPlugin=()=>new Proxy({},{get:(_,key)=>(...args)=>globalThis.__localExportFixture.bridge[key](...args)});"
      :args.path.includes("objectUrls")?"export const mediaObjectUrls={acquire:(url)=>globalThis.__localExportFixture.acquire(url)};"
      :"export const isNativeAndroid=()=>true;export const supportsCapacitorPlugin=()=>true;"}));
  }
}]});
const {saveNativeMedia}=await import("data:text/javascript;base64,"+Buffer.from(built.outputFiles[0].text).toString("base64"));
const id="11111111-1111-4111-8111-111111111111";
const url="https://core.letscube.ru/storage/v1/object/public/chat-media/qa/original.png";

function fixture({unsupported=false,known=true,failure=false,current=()=>true}={}){
  const calls=[];let releases=0;
  globalThis.__localExportFixture={
    acquire(value){assert.equal(value,"blob:managed");return known?{blob:new Blob(["synthetic"],{type:"image/png"}),current,release(){releases++;}}:null;},
    bridge:{
      async save(input){calls.push(["https",input]);return {saved:true};},
      async localCapabilities(){calls.push(["caps"]);return {version:unsupported?0:1,maxBytes:33554432,chunkBytes:262144};},
      async beginLocal(input){calls.push(["begin",input]);return {id};},
      async appendLocal(input){calls.push(["append"]);if(failure)throw Error("synthetic transfer failure");return {written:input.offset+Buffer.from(input.data,"base64").length};},
      async finishLocal(){calls.push(["finish"]);return {saved:true,location:"Pictures/LETSCUBE"};},
      async abortLocal(){calls.push(["abort"]);},
    },
  };
  return {calls,releases:()=>releases};
}

test("cached native save uses owned local bytes rather than the original network address",async()=>{
  const f=fixture();const result=await saveNativeMedia(url,"original.png",{localUrl:"blob:managed"});
  assert.equal(result.location,"Pictures/LETSCUBE");assert.deepEqual(f.calls.map(c=>c[0]),["caps","begin","append","finish"]);assert.equal(f.releases(),1);
});
test("unsupported local bridge lazily resolves the same original and fences retirement after resolution",async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(navigator,"onLine");
  Object.defineProperty(navigator,"onLine",{configurable:true,value:true});
  try{
    const fresh="https://core.letscube.ru/storage/v1/object/sign/chat-media/qa/original.png?token=synthetic-fresh";
    for(const address of [url,"blob:managed"]){
      let resolved=0;const f=fixture({unsupported:true});
      await saveNativeMedia(address,"original.png",{localUrl:"blob:managed",resolveSourceUrl:async()=>{resolved++;return fresh;}});
      assert.equal(resolved,1);assert.deepEqual(f.calls.at(-1),["https",{url:fresh,fileName:"original.png"}]);
    }
    let current=true;const f=fixture({unsupported:true,current:()=>current});
    await assert.rejects(saveNativeMedia(url,"original.png",{localUrl:"blob:managed",resolveSourceUrl:async()=>{current=false;return fresh;}}));
    assert.deepEqual(f.calls.map(c=>c[0]),["caps"]);assert.equal(f.releases(),1);
    const supported=fixture();let resolved=0;
    await saveNativeMedia(url,"original.png",{localUrl:"blob:managed",resolveSourceUrl:async()=>{resolved++;return fresh;}});
    assert.equal(resolved,0);assert.ok(supported.calls.some(c=>c[0]==="finish"));
  }finally{if(descriptor)Object.defineProperty(navigator,"onLine",descriptor);else delete navigator.onLine;}
});
test("retired or unknown blob is refused, never retried as a network download",async()=>{
  const f=fixture({known:false});await assert.rejects(saveNativeMedia(url,"original.png",{localUrl:"blob:managed"}));assert.deepEqual(f.calls,[]);
});
test("failed local transfer aborts and does not silently switch source",async()=>{
  const f=fixture({failure:true});await assert.rejects(saveNativeMedia(url,"original.png",{localUrl:"blob:managed"}));assert.deepEqual(f.calls.map(c=>c[0]),["caps","begin","append","abort"]);assert.equal(f.releases(),1);
});
test("ordinary online remote media keeps the old native path",async()=>{
  const f=fixture();await saveNativeMedia(url,"original.png");assert.deepEqual(f.calls,[["https",{url,fileName:"original.png"}]]);
});
test("old native local capability falls back only for an online first-party original",async()=>{
  const original=Object.getOwnPropertyDescriptor(navigator,"onLine");
  try{
    for(const online of [true,false]){
      Object.defineProperty(navigator,"onLine",{configurable:true,value:online});
      const f=fixture({unsupported:true});
      if(online){await saveNativeMedia(url,"original.png",{localUrl:"blob:managed"});assert.deepEqual(f.calls.map(c=>c[0]),["caps","https"]);}
      else{await assert.rejects(saveNativeMedia(url,"original.png",{localUrl:"blob:managed"}));assert.deepEqual(f.calls.map(c=>c[0]),["caps"]);}
      assert.equal(f.releases(),1);
    }
    Object.defineProperty(navigator,"onLine",{configurable:true,value:true});
    const f=fixture({unsupported:true});
    await assert.rejects(saveNativeMedia("https://outside.invalid/photo.png","original.png",{localUrl:"blob:managed"}));
    assert.deepEqual(f.calls.map(c=>c[0]),["caps"]);
  }finally{if(original)Object.defineProperty(navigator,"onLine",original);else delete navigator.onLine;}
});
