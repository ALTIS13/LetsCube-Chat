const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, resolve } = require("node:path");

const kubRoot = resolve(__dirname,"../../artifacts/kub");
const sourceRoot = resolve(kubRoot, "src");
const requireKub = createRequire(resolve(kubRoot, "package.json"));
const { build } = createRequire(requireKub.resolve("vite"))("esbuild");
const ORIGIN = "https://task-detail.invalid";

// The detail, checklist, reminders, modal controls, React and account store are
// real. Only backend authority/I/O, media and unopened action forms are isolated.
const boundaries = new Map([
  ["lib/supabase/client.ts", `
    const client = {
      from(table) { return window.fixture.query(table); },
      rpc() { window.fixture.writes++; return Promise.reject(Error('fictional writes forbidden')); },
      channel(name) {
        const channel = {name, active:true, handlers:[],
          on(kind, filter, callback) {this.handlers.push({filter, callback}); return this;},
          subscribe(callback) {callback?.('SUBSCRIBED'); return this;}};
        window.fixture.channels.push(channel); return channel;
      },
      removeChannel(channel) {channel.active=false; return Promise.resolve();}
    };
    export const createClient = () => client;
    export const getRealtimeClient = () => client;
    export const isSupabaseConfigured = () => false;
  `],
  ["lib/outbox/appOutbox.ts", "export const appOutbox = {stop() {}};"],
  ["lib/dev/instrumentation.ts", "export function bumpFetch() {} export function registerChannel() {} export function unregisterChannel() {}"],
  ["hooks/useRole.ts", `
    export const useMatchesIsManagerOrAdmin = () => ({allowed:false});
    export function clearRoleAccessCache() {}
    export const useAnyLocationPermissionAccess = () => ({allowed:false});
    export const usePermissionAccess = () => ({hasPermission:key => key === 'tasks.delete',
      hasAnyPermission:keys => keys.includes('tasks.delete')});
  `],
  ["hooks/useLocationAdmin.ts", "export const useIsLocationAdmin = () => ({isLocationAdmin:false});"],
  ["hooks/useTaskSoftDelete.ts", "export const useTaskSoftDelete = () => ({softDeleteTask:() => {throw Error('writes forbidden');}});"],
  ["hooks/useRecurringTasks.ts", `
    export const useTaskRecurrence = () => ({recurrence:null,status:'ready',message:null,refetch:async()=>{}});
    export function pauseTaskRecurrence() {throw Error('writes forbidden');}
    export function resumeTaskRecurrence() {throw Error('writes forbidden');}
    export function stopTaskRecurrence() {throw Error('writes forbidden');}
  `],
  ["components/ui/ChatAvatar.tsx", "export const ChatAvatar = () => null; export const UserAvatar = () => null;"],
  ...["Assign", "Confirm", "Form", "Reject"].map(name => [
    `pages/tasks/Task${name}Modal.tsx`, `export const Task${name}Modal = () => null;`,
  ]),
]);

async function compileFixture({ change, styles = false } = {}) {
  let replacements = 0;
  const result = await build({
    write:false, bundle:true, platform:"browser", format:"iife", jsx:"automatic", metafile:true,
    alias:{"@":sourceRoot},
    define:{"process.env.NODE_ENV":'"development"', "import.meta.env":'{"DEV":false}'},
    plugins:[{name:"fictional-task-boundaries", setup(plugin) {
      plugin.onLoad({filter:/\.[tj]sx?$/}, args => {
        const relative = args.path.slice(sourceRoot.length + 1).replaceAll("\\", "/");
        if (boundaries.has(relative)) return {contents:boundaries.get(relative), loader:"tsx", resolveDir:dirname(args.path)};
        if (change?.file === relative) {
          const source = readFileSync(args.path,"utf8").replaceAll("\r\n", "\n");
          assert.equal(source.split(change.before).length - 1, 1, "compiled omission must match once");
          replacements++;
          return {contents:source.replace(change.before,change.after), loader:"tsx", resolveDir:dirname(args.path)};
        }
      });
    }}],
    stdin:{loader:"tsx", resolveDir:kubRoot, sourcefile:"fictional-task-detail.tsx", contents:`
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {useTask} from './src/hooks/useTask.ts';
      import {TaskDetailModal} from './src/pages/tasks/TaskDetailModal.tsx';
      import {useAppStore} from './src/store/app.store.ts';
      import {applyResolvedTheme} from './src/lib/themeRuntime.ts';
      const f=window.fixture;
      applyResolvedTheme(f.theme);
      const root=createRoot(document.getElementById('root'));
      function Hook({taskId}) {
        f.state=useTask(taskId);
        return <output data-testid="hook-state">{JSON.stringify(f.state)}</output>;
      }
      f.render = (taskId=f.taskId) => {
        f.taskId=taskId;
        flushSync(() => root.render(f.mode === 'hook' ? <Hook taskId={taskId}/> :
          <TaskDetailModal taskId={taskId} nowMs={Date.parse('2026-10-07T12:00:00Z')} onClose={()=>{}}/>));
      };
      f.owner = (id='owner-a', session='session-1') => flushSync(() => {
        useAppStore.getState().setAuthSessionIdentity(id ? {userId:id,sessionId:session} : null);
        if (id) useAppStore.getState().setCurrentUser(f.profile(id));
      });
      f.sameOwnerRoundTrip = () => {
        useAppStore.getState().setAuthSessionIdentity(null);
        useAppStore.getState().setAuthSessionIdentity({userId:'owner-a',sessionId:'session-2'});
        useAppStore.getState().setCurrentUser(f.profile('owner-a'));
      };
      f.store=useAppStore;
      f.refetch = () => {f.pending=f.state.refetch();};
      f.detach = () => flushSync(() => root.render(null));
      f.unmount = () => flushSync(() => root.unmount());
      f.owner(); f.render();
    `},
  });
  if (change) assert.equal(replacements,1,"the actual modified runtime must compile");
  let css = "";
  if (styles) {
    const tailwindRequire = createRequire(requireKub.resolve("@tailwindcss/vite"));
    const { compile } = tailwindRequire("@tailwindcss/node");
    const path = resolve(sourceRoot,"index.css");
    const compiler = await compile(readFileSync(path,"utf8"), {base:sourceRoot,onDependency(){}});
    const candidates = new Set();
    for (const file of Object.keys(result.metafile.inputs)) {
      const absolute = resolve(file);
      if (!absolute.startsWith(sourceRoot)) continue;
      for (const token of readFileSync(absolute,"utf8").match(/[^\s"'`]+/g) ?? []) candidates.add(token);
    }
    css = compiler.build([...candidates]);
  }
  return {js:result.outputFiles[0].text,css};
}

async function mountFixture(page, bundle, {mode="hook", initial={}, theme="dark"} = {}) {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS,"0","this fixture requires the read-only QA gate");
  const faults = [], network = [];
  page.on("pageerror", error => faults.push(error.message));
  page.on("console", message => {if (message.type() === "error") faults.push(message.text());});
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN && url.pathname === "/") return route.fulfill({status:200,contentType:"text/html",
      body:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fictional task recovery</title></head><body><div id="root"></div></body></html>'});
    if (url.origin === ORIGIN && /^\/fonts\/inter\/inter-(cyrillic|cyrillic-ext|latin|latin-ext)\.woff2$/.test(url.pathname)) {
      return route.fulfill({status:200,contentType:"font/woff2",body:readFileSync(resolve(kubRoot,"public"+url.pathname))});
    }
    network.push("unexpected network request"); return route.abort();
  });
  await page.goto(ORIGIN);
  await page.evaluate(({mode,initial,theme}) => {
    document.documentElement.classList.toggle("dark",theme === "dark");
    const AT='2026-10-07T12:00:00Z';
    const f=window.fixture={mode,theme,taskId:'task-a',plans:[initial],batches:[],channels:[],writes:0,reads:[],state:null};
    f.profile = id => ({id,full_name:'Fictional QA',username:null,avatar_url:null,bio:null,role:'user',
      is_test_account:true,profile_frame:null,profile_background:null,presence_status:null,
      online_at:null,created_at:AT,updated_at:AT});
    f.task = (id='task-a', title='Fictional task A') => {
      const owner=f.store?.getState().currentUser?.id ?? 'owner-a';
      return {id,title,description:'Fictional task recovery fixture',
      created_by:owner,assignee_id:owner,status:'in_progress',priority:'normal',visibility:'private',
      assignment_scope:'user',chat_id:null,location_id:null,target_role:null,route_admin_id:null,
      created_for_admin:false,starts_at:null,due_at:null,accepted_at:AT,started_at:AT,
      sent_for_confirmation_at:null,confirmed_at:null,rejected_at:null,cancelled_at:null,
      reject_reason:null,confirm_note:null,created_at:AT,updated_at:AT,deleted_at:null,
      deleted_by:null,delete_reason:null,recurrence_id:null,recurrence_template_task_id:null,
      recurrence_occurrence_at:null,assignee:f.profile(owner),creator:f.profile(owner),
      chat:null,coassignees:[]};
    };
    f.rows = (table, id) => {
      if (table === 'tasks') return f.task(id,id === 'task-a' ? 'Fictional task A' : 'Fictional task B');
      if (table === 'task_events') return [{id:'event-'+id,task_id:id,actor_id:'owner-a',kind:'comment',
        payload:{text:'Fictional retained history'},created_at:AT,actor:f.profile('owner-a')}];
      if (table === 'task_checklist_items') return [{id:'item-'+id,task_id:id,text:'Fictional checklist item',
        position:0,done:false,done_by:null,done_at:null,created_by:'owner-a',created_at:AT,updated_at:AT}];
      return [{id:'reminder-'+id,task_id:id,created_by:'owner-a',recipient_id:'owner-a',
        remind_at:'2026-10-08T12:00:00Z',note:'Fictional reminder',delivered_at:null,
        cancelled_at:null,created_at:AT,updated_at:AT}];
    };
    f.enqueue = plan => f.plans.push(plan);
    f.query = table => {
      if (!['tasks','task_events','task_checklist_items','task_reminders'].includes(table)) throw Error('unexpected read table');
      if (table === 'tasks') {
        const plan=f.plans.shift() ?? {};
        let release;
        const gate=new Promise(done=>release=done);
        const parts=new Map();
        for (const held of plan.holdTables ?? []) {
          let releasePart;
          const gatePart=new Promise(done=>releasePart=done);
          parts.set(held,{gate:gatePart,release:releasePart});
        }
        const batch={plan,gate,parts,completed:[],done:0,
          release(){release();for(const part of parts.values()) part.release();}};
        if (!plan.hold) release(); f.batches.push(batch); f.currentBatch=batch;
      }
      const batch=f.currentBatch;
      const query={id:null,select(){return this;},eq(column,id){
        if (column !== (table === 'tasks' ? 'id' : 'task_id')) throw Error('wrong task filter');
        this.id=id; return this;
      },order(){return this;},maybeSingle(){return this;},then(done,fail){
        f.reads.push({table,id:this.id});
        return batch.gate.then(()=>batch.parts.get(table)?.gate).then(()=>{
          batch.done++;
          batch.completed.push(table);
          const issue=batch.plan.errors?.[table];
          if (batch.plan.rejectEmpty?.includes(table)) throw undefined;
          if (batch.plan.reject?.includes(table)) throw {code:issue?.code ?? '57014',message:'FICTIONAL_BACKEND_SECRET'};
          return {data:issue ? null : table === 'tasks' && batch.plan.absent ? null :
            batch.plan.data?.[table] ?? f.rows(table,this.id),error:issue ?? null,
            status:batch.plan.status?.[table] ?? (issue ? 500 : 200)};
        }).then(done,fail);
      }};
      return query;
    };
    f.deliver = (table='tasks') => {
      for (const channel of f.channels.filter(channel=>channel.active)) for (const {filter,callback} of channel.handlers)
        if (filter.table === table && filter.filter.endsWith('eq.'+f.taskId)) callback({new:{id:f.taskId,task_id:f.taskId}});
    };
    f.release = index => f.batches[index].release();
    f.releaseTable = (index,table) => f.batches[index].parts.get(table)?.release();
  },{mode,initial,theme});
  if (bundle.css) await page.addStyleTag({content:bundle.css});
  await page.addScriptTag({content:bundle.js});
  await page.waitForFunction(() => window.fixture.batches.length > 0);
  return {
    page,
    async idle() {await page.evaluate(async()=>{for(let i=0;i<24;i++) await Promise.resolve();
      await new Promise(done=>setTimeout(done,0));});},
    async state() {return page.evaluate(()=>JSON.parse(document.querySelector('[data-testid="hook-state"]').textContent));},
    async refresh(plan={}) {await page.evaluate(plan=>{window.fixture.enqueue(plan);window.fixture.refetch();},plan);},
    async release(index) {await page.evaluate(index=>window.fixture.release(index),index);},
    async close() {
      await page.evaluate(async()=>{const f=window.fixture;f.unmount();for(const batch of f.batches) batch.release();
        for(let i=0;i<24;i++) await Promise.resolve();});
      assert.equal(await page.evaluate(()=>window.fixture.writes),0,"no backend mutation permitted");
      assert.deepEqual(network,[],"no external or unexpected requests permitted");
      assert.deepEqual(faults,[],"no rejected promises or runtime errors permitted");
    },
  };
}

exports.compileFixture = compileFixture;
exports.mountFixture = mountFixture;
exports.requireKub = requireKub;
