import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = kubRequire("@playwright/test");
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");
const sourceRoot = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const ORIGIN = "https://roles-ordering.invalid";
const ROLE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const REFUSED = {code:"42501", message:"synthetic permission refusal"};
const MISSING = {code:"42P01", message:'relation "roles" does not exist'};
const REFUSAL_TEXT = "\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u043f\u0440\u0430\u0432 \u0434\u043b\u044f \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u0440\u043e\u043b\u044f\u043c\u0438.";
let browser: any;
let bundle: string;

async function until(check: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(20);
  }
  assert.equal(await check(), true, message);
}

test.before(async () => {
  let mutations = 0;
  const result = await build({
    write:false, bundle:true, platform:"browser", format:"iife", jsx:"automatic",
    alias:{"@":sourceRoot},
    define:{"process.env.NODE_ENV":'"development"', "import.meta.env":JSON.stringify({
      DEV:true, VITE_SUPABASE_URL:ORIGIN, VITE_SUPABASE_ANON_KEY:"synthetic-anon-fixture",
      VITE_MEDIA_SIGNED_URLS:"signed-only",
    })},
    plugins:[{name:"read-only-provider-boundary", setup(plugin: any) {
      plugin.onLoad({filter:/lib[\\/]supabase[\\/]client\.ts$/}, () => ({loader:"ts", contents:`
        import {createClient as sdkClient} from '@supabase/supabase-js';
        const client = sdkClient('${ORIGIN}', 'synthetic-anon-fixture', {
          auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}
        });
        client.channel = (name) => {
          const channel = {name, active:true, handlers:[],
            on(_kind, filter, callback) {this.handlers.push({filter, callback}); return this;},
            subscribe(callback) {callback('SUBSCRIBED'); return this;}
          };
          window.channels.push(channel); return channel;
        };
        client.removeChannel = async channel => {channel.active = false;};
        export const createClient = () => client;
        export const getRealtimeClient = () => client;
      `}));
      plugin.onLoad({filter:/hooks[\\/]useDynamicRoles\.ts$/}, (args: any) => {
        if (!process.env.DYNAMIC_ROLES_MUTANT) return undefined;
        let contents = readFileSync(args.path,"utf8").replace(/\r\n/g,"\n");
        const changes: Record<string,[string,string]> = {
          "omit-result-guard":["if (generation !== loadGenerationRef.current) return;", ""],
          "omit-load-generation":["const generation = ++loadGenerationRef.current;", "const generation = loadGenerationRef.current;"],
          "omit-cleanup":["return () => { loadGenerationRef.current += 1; };", ""],
          "shared-generation":["const loadGenerationRef = useRef(0);", "const loadGenerationRef = sharedLoadGeneration;"],
        };
        const change = changes[process.env.DYNAMIC_ROLES_MUTANT!];
        assert.ok(change, "known omission selection");
        assert.equal(contents.split(change[0]).length - 1, 1, "omission matches exactly once");
        contents = contents.replace(change[0],change[1]);
        if (process.env.DYNAMIC_ROLES_MUTANT === "shared-generation") contents += "\nconst sharedLoadGeneration = {current:0};\n";
        mutations++;
        return {contents,loader:"ts"};
      });
    }}],
    stdin:{resolveDir:sourceRoot, sourcefile:"mounted-role-ordering.tsx", loader:"tsx", contents:`
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {useDynamicRoles} from './hooks/useDynamicRoles';
      import {getRolesPermissionsEnabled, setRolesPermissionsEnabled,
        ROLES_PERMISSIONS_STORAGE_EVENT} from './lib/rolePermissions';
      const roots = [createRoot(document.getElementById('root')), createRoot(document.getElementById('second'))];
      window.states = [];
      window.preferenceEvents = 0;
      window.addEventListener(ROLES_PERMISSIONS_STORAGE_EVENT, () => window.preferenceEvents++);
      window.featureEnabled = getRolesPermissionsEnabled;
      setRolesPermissionsEnabled(true);
      window.preferenceEvents = 0;
      function Consumer({options,index}) {
        const state = useDynamicRoles(options);
        window.states[index] = state;
        const view = {available:state.available, checked:state.checked, loading:state.loading, error:state.error,
          roles:state.roles.map(role => role.name), permissions:state.permissions.map(permission => permission.key),
          rolePermissions:state.rolePermissions.map(permission => permission.permission_key),
          assignments:state.userGlobalRoles.map(assignment => assignment.user_id)};
        return <section><output id={'state-'+index} data-state={JSON.stringify(view)} />
          {state.loading && <span role="status">Loading roles</span>}
          {state.error && <p role="alert">{state.error}</p>}
          <ul id={'roles-'+index}>{state.roles.map(role => <li key={role.id}>{role.name}</li>)}</ul></section>;
      }
      window.renderConsumer = (options,index=0) => flushSync(() => roots[index].render(<Consumer options={options} index={index} />));
      window.unmountConsumer = (index=0) => flushSync(() => roots[index].render(null));
      window.renderConsumer({enabled:true,includeAssignments:window.initialAssignments});
    `},
  });
  if (process.env.DYNAMIC_ROLES_MUTANT) assert.equal(mutations,1,"one in-memory production omission applied");
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({headless:true, env:{...process.env,KUB_QA_ALLOW_MUTATIONS:"0"}});
});
test.after(async () => {await browser?.close();});

type Plan = {
  label:string; assignments:boolean; error:typeof REFUSED | null;
  requests:string[]; done:number; gate:Promise<void>; release:() => void;
};

function plan(label: string, options: {held?:boolean; assignments?:boolean; error?:typeof REFUSED} = {}): Plan {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  if (!options.held) release();
  return {label, assignments:options.assignments ?? true, error:options.error ?? null,
    requests:[], done:0, gate, release};
}

function rows(table: string, label: string) {
  const permission = `roles.${label.toLowerCase()}`;
  if (table === "roles") return [{id:ROLE_ID,key:"synthetic_role",name:label,description:"Synthetic read fixture",
    scope:"global",is_system:false,is_active:true,priority:1,colour:null,created_at:"2026-10-02T00:00:00Z"}];
  if (table === "permissions") return [{key:permission,name:label,description:null,category:"roles",created_at:"2026-10-02T00:00:00Z"}];
  if (table === "role_permissions") return [{role_id:ROLE_ID,permission_key:permission}];
  return [{user_id:USER_ID,role_id:ROLE_ID,assigned_by:null,assigned_at:"2026-10-02T00:00:00Z"}];
}

async function fixture(initial: Plan) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const queues = new Map<string,Plan[]>();
  const plans: Plan[] = [];
  const writes: string[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  function enqueue(p: Plan) {
    plans.push(p);
    for (const table of ["roles","permissions","role_permissions",...(p.assignments ? ["user_global_roles"] : [])]) {
      const queue = queues.get(table) ?? [];
      queue.push(p); queues.set(table,queue);
    }
  }
  enqueue(initial);
  page.on("pageerror",(error: Error) => errors.push(error.message));
  await page.route("**/*",async (route: any) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === ORIGIN && url.pathname === "/") return route.fulfill({status:200,contentType:"text/html",body:'<div id="root"></div><div id="second"></div>'});
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({status:403,contentType:"application/json",body:'{"message":"readonly"}'});
    }
    const table = url.pathname.replace("/rest/v1/","");
    const p = url.origin === ORIGIN ? queues.get(table)?.shift() : undefined;
    if (!p) {
      unexpected.push(url.pathname);
      return route.fulfill({status:404,body:"unexpected provider request"});
    }
    p.requests.push(table);
    await p.gate;
    const failure = table === "roles" ? p.error : null;
    await route.fulfill({status:failure ? (failure.code === "42P01" ? 404 : 403) : 200,
      contentType:"application/json",body:JSON.stringify(failure ?? rows(table,p.label))});
    p.done++;
  });
  await page.clock.install({time:1_700_000_000_000});
  await page.clock.pauseAt(1_700_000_001_000);
  await page.goto(ORIGIN);
  await page.evaluate((assignments: boolean) => {(window as any).channels = []; (window as any).initialAssignments = assignments;},initial.assignments);
  await page.addScriptTag({content:bundle});
  async function started(p: Plan) {
    const tables = ["permissions","role_permissions","roles",...(p.assignments ? ["user_global_roles"] : [])].sort();
    await until(async () => p.requests.length === tables.length, "actual SDK requests must reach the held provider batch");
    assert.deepEqual([...p.requests].sort(),tables,"each real table is read exactly once per load");
  }
  await started(initial);
  return {
    page, enqueue, started,
    async complete(p: Plan) {
      p.release();
      await until(async () => p.done === p.requests.length,"provider batch completes");
      await delay(40);
    },
    async view(index = 0) {return JSON.parse(await page.locator(`#state-${index}`).getAttribute("data-state") ?? "null");},
    async refetch(p: Plan, index = 0) {
      enqueue(p);
      await page.evaluate((index: number) => {void (window as any).states[index].refetch();},index);
      await started(p);
    },
    async options(p: Plan | null, options: {enabled:boolean;includeAssignments:boolean}, index = 0) {
      if (p) enqueue(p);
      await page.evaluate(({options,index}: any) => (window as any).renderConsumer(options,index),{options,index});
      if (p) await started(p);
    },
    async background(p: Plan) {
      enqueue(p);
      await page.evaluate(() => {
        const ch = (window as any).channels.find((ch: any) => ch.active && ch.handlers.some((h: any) => h.filter.table === "roles"));
        const binding = ch.handlers.find((h: any) => h.filter.table === "roles");
        binding.callback({new:{}});
      });
      await page.clock.runFor(250);
      await started(p);
    },
    async close() {
      for (const p of plans) p.release();
      await page.evaluate(() => {(window as any).unmountConsumer(0); (window as any).unmountConsumer(1);});
      await context.close();
      assert.deepEqual(writes,[],"no policy/grant/backend mutations");
      assert.deepEqual(unexpected,[],"all provider requests accounted for");
      assert.deepEqual(errors,[],"no page errors");
    },
  };
}

const EMPTY = {available:false,checked:true,loading:false,error:null,roles:[],permissions:[],rolePermissions:[],assignments:[]};
const CURRENT = {available:true,checked:true,loading:false,error:null,roles:["Current"],
  permissions:["roles.current"],rolePermissions:["roles.current"],assignments:[USER_ID]};

test("mounted newest success renders before late old success and cannot be overwritten", async () => {
  const old = plan("Old",{held:true}), current = plan("Current");
  const f = await fixture(old);
  try {
    await f.refetch(current); await f.complete(current);
    assert.equal(await f.page.locator("#roles-0 li").textContent(),"Current","newest provider control really renders");
    assert.deepEqual(await f.view(),CURRENT);
    await f.complete(old);
    assert.deepEqual(await f.view(),CURRENT,"late old success cannot overwrite any current role data");
  } finally {await f.close();}
});

for (const staleError of [null,MISSING]) {
  test(`newest refusal remains rendered after stale ${staleError ? "error" : "success"}`, async () => {
    const old = plan("Old",{held:true,...(staleError ? {error:staleError} : {})});
    const latest = plan("Current",{error:REFUSED});
    const f = await fixture(old);
    try {
      await f.refetch(latest); await f.complete(latest);
      assert.equal(await f.page.getByRole("alert").textContent(),REFUSAL_TEXT,"newest real SDK refusal is visible");
      const refused = {...EMPTY,error:REFUSAL_TEXT};
      assert.deepEqual(await f.view(),refused);
      await f.complete(old);
      assert.deepEqual(await f.view(),refused,"older success/error cannot erase or replace the newest refusal");
      assert.equal(await f.page.evaluate(() => (window as any).featureEnabled()),true,"stale missing-table error cannot disable the feature");
    } finally {await f.close();}
  });
}

test("newest success is not cleared by a stale missing-table error", async () => {
  const old = plan("Old",{held:true,error:MISSING}), current = plan("Current");
  const f = await fixture(old);
  try {
    await f.refetch(current); await f.complete(current);
    assert.deepEqual(await f.view(),CURRENT);
    await f.complete(old);
    assert.deepEqual(await f.view(),CURRENT,"stale error cannot clear rendered role data");
    assert.equal(await f.page.evaluate(() => (window as any).featureEnabled()),true);
    assert.equal(await f.page.evaluate(() => (window as any).preferenceEvents),0,"no stale feature toggle event");
  } finally {await f.close();}
});

test("older completion cannot end the newest pending load's spinner", async () => {
  const old = plan("Old",{held:true}), current = plan("Current",{held:true});
  const f = await fixture(old);
  try {
    await f.refetch(current); await f.complete(old);
    assert.equal((await f.view()).loading,true,"only the pending newest read owns loading");
    assert.equal(await f.page.getByText("Loading roles",{exact:true}).textContent(),"Loading roles");
    assert.deepEqual((await f.view()).roles,[],"stale initial rows do not flash while newest read is pending");
    await f.complete(current);
    assert.deepEqual(await f.view(),CURRENT);
  } finally {await f.close();}
});

test("disabling a mounted consumer invalidates its outstanding read", async () => {
  const old = plan("Old",{held:true});
  const f = await fixture(old);
  try {
    await f.options(null,{enabled:false,includeAssignments:true});
    assert.deepEqual(await f.view(),EMPTY,"disabled control clears data without a provider read");
    await f.complete(old);
    assert.deepEqual(await f.view(),EMPTY,"late response cannot re-enable a disabled consumer");
  } finally {await f.close();}
});

for (const initialAssignments of [true,false]) {
  test(`includeAssignments ${initialAssignments} to ${!initialAssignments} invalidates the old query shape`, async () => {
    const old = plan("Old",{held:true,assignments:initialAssignments});
    const current = plan("Current",{assignments:!initialAssignments});
    const f = await fixture(old);
    try {
      await f.options(current,{enabled:true,includeAssignments:!initialAssignments});
      await f.complete(current);
      const expected = {...CURRENT,assignments:initialAssignments ? [] : [USER_ID]};
      assert.deepEqual(await f.view(),expected,"new option's real query shape renders");
      await f.complete(old);
      assert.deepEqual(await f.view(),expected,"old assignments query cannot repopulate or clear the new shape");
    } finally {await f.close();}
  });
}

test("unmounted late error cannot disable preferences, while a live missing-table control can", async () => {
  const old = plan("Old",{held:true,error:MISSING});
  const f = await fixture(old);
  try {
    await f.page.evaluate(() => (window as any).unmountConsumer());
    assert.equal(await f.page.locator("#state-0").count(),0,"actual consumer unmounted");
    await f.complete(old);
    assert.equal(await f.page.evaluate(() => (window as any).featureEnabled()),true,"unmounted read cannot disable roles preference");
    assert.equal(await f.page.evaluate(() => (window as any).preferenceEvents),0,"no post-unmount preference event");
    const live = plan("Live",{error:MISSING});
    await f.options(live,{enabled:true,includeAssignments:true}); await f.complete(live);
    assert.equal(await f.page.evaluate(() => (window as any).featureEnabled()),false,"live missing-table positive control still disables preference");
    assert.equal(await f.page.evaluate(() => (window as any).preferenceEvents),1);
    assert.equal((await f.view()).available,false);
    assert.equal(await f.page.getByRole("alert").count(),1);
  } finally {await f.close();}
});

test("newest background refusal retains the existing view and resists older success", async () => {
  const base = plan("Base"), old = plan("Old",{held:true}), latest = plan("Current",{error:REFUSED});
  const f = await fixture(base);
  try {
    await f.complete(base);
    assert.deepEqual((await f.view()).roles,["Base"],"base view actually loaded");
    await f.background(old);
    await f.background(latest); await f.complete(latest);
    const expected = {available:true,checked:true,loading:false,error:REFUSAL_TEXT,roles:["Base"],
      permissions:["roles.base"],rolePermissions:["roles.base"],assignments:[USER_ID]};
    assert.deepEqual(await f.view(),expected,"background error preserves the previous real view");
    await f.complete(old);
    assert.deepEqual(await f.view(),expected,"older background success does not erase the latest error");
  } finally {await f.close();}
});

test("request generations belong to each mounted consumer, not a shared module counter", async () => {
  const first = plan("First",{held:true}), second = plan("Second");
  const f = await fixture(first);
  try {
    await f.options(second,{enabled:true,includeAssignments:true},1); await f.complete(second);
    assert.deepEqual((await f.view(1)).roles,["Second"],"second mounted consumer loads independently");
    await f.complete(first);
    assert.deepEqual((await f.view(0)).roles,["First"],"another consumer's load cannot invalidate this hook's newest read");
    assert.deepEqual((await f.view(1)).roles,["Second"]);
  } finally {await f.close();}
});
