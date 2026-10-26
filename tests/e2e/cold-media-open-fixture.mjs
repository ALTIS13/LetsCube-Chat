import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const SOURCE = fileURLToPath(new URL('../../', import.meta.url));
const src = path.join(SOURCE, 'artifacts/kub/src');
const req = createRequire(new URL('../../artifacts/kub/package.json', import.meta.url));
export const { chromium } = req('@playwright/test');
const { build } = createRequire(req.resolve('vite/package.json'))('esbuild');
const ts = req('typescript');
export const ORIGIN = 'http://127.0.0.1:19926';
export const UID = '86000000-0000-4000-8000-000000000001', SID = '86000000-0000-4000-8000-000000000002';
export const CHAT = '86000000-0000-4000-8000-000000000003', MESSAGE = '86000000-0000-4000-8000-000000000004';
export const TOPIC = '86000000-0000-4000-8000-000000000006';
export const GENERAL = '86000000-0000-4000-8000-000000000007';
const PEER = '86000000-0000-4000-8000-000000000005';

// Exact current ChatWindow statements, not a mirrored hand-written scope rule.
// Child panels/Auth/transport are outside this minimal composition boundary.
export function scopeSource(text = readFileSync(path.join(src, 'components/chat/ChatWindow.tsx'), 'utf8')) {
  const ast = ts.createSourceFile('ChatWindow.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ChatWindow');
  assert.ok(fn?.body);
  const names = ['isForum', 'topicsEnabled', null, 'generalTopicKey', 'generalTopicIds', 'topicScopeUnknown', 'messageScoped', 'messageTopicId', 'messageGeneralTopicIds'];
  return names.map(name => {
    const nodes = fn.body.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d =>
      name === null ? ts.isCallExpression(d.initializer) && d.initializer.expression.getText(ast) === 'useTopics' : d.name.getText(ast) === name));
    assert.equal(nodes.length, 1, 'ACTUAL_SCOPE_SOURCE_MOVED'); return nodes[0].getText(ast);
  }).join('\n');
}
function actualMessageCall(text) {
  const ast = ts.createSourceFile('ChatWindow.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const fn = ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ChatWindow');
  const calls=fn.body.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations])
    .map(d=>d.initializer).filter(n=>n&&ts.isCallExpression(n)&&n.expression.getText(ast)==='useMessages');
  assert.equal(calls.length,1,'ACTUAL_MESSAGE_CALL_MOVED');return calls[0].getText(ast);
}

const clientPort = `
  const state=window.input;const calls=[];
  const deny=()=>{throw Error('MUTATION_NOT_ADMITTED')};
  const client={from(table){const filters=[];let single=false;const q={
    select(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},
    order(){return q},limit(){return q},in(){return q},gt(){return q},gte(){return q},lt(){return q},or(){return q},
    maybeSingle(){single=true;return q},single(){single=true;return q},insert:deny,update:deny,delete:deny,upsert:deny,
    then(ok,bad){calls.push({table,offline:state.offline});let value;
      if(state.offline)value={data:null,error:{code:'SYNTHETIC_OFFLINE'},status:503};
      else if(table==='topics')value={data:state.topics,error:null,status:200};
      else if(table==='chat_members')value={data:single?{cleared_at:null}:[],error:null,status:200};
      else if(table==='messages')value={data:[state.row].filter(row=>filters.every(([k,v])=>
        !['chat_id','topic_id','pinned','deleted_at'].includes(k)||(row[k]??null)===v)),error:null,status:200};
      else if(table==='message_hidden_for_users')value={data:[],error:null,status:200};
      else throw Error('UNEXPECTED_TABLE');
      return Promise.resolve(value).then(ok,bad);
    }};return q},rpc:deny,auth:new Proxy({},{get(){throw Error('AUTH_NOT_ADMITTED')}}),
    storage:{from(bucket){return{getPublicUrl(p){return{data:{publicUrl:'${ORIGIN}/storage/v1/object/public/'+bucket+'/'+p}}}}}}};
  const rt={channel(){const ch={on(){return ch},subscribe(){return ch},send:deny,unsubscribe(){}};return ch},removeChannel(){}};
  export const createClient=()=>client,getRealtimeClient=()=>rt;
  window.readCalls=calls;
`;

export async function makeBundle(mutation) {
  const allowed = ['components/chat/ChatWindow.tsx','hooks/useMessages.ts','lib/historyCache/offline.ts'];
  if(mutation)assert.ok(allowed.includes(mutation.file)&&typeof mutation.from==='string'&&mutation.from.length>0&&typeof mutation.to==='string','MUTATION_SCOPE_REFUSED');
  const sourceText = file => {
    const text=readFileSync(path.join(src,file),'utf8').replaceAll('\r\n','\n');
    if(mutation?.file!==file)return text;
    assert.equal(text.split(mutation.from).length,2,'EXACT_MUTATION_ANCHOR_REQUIRED');return text.replace(mutation.from,mutation.to);
  };
  const windowSource=sourceText('components/chat/ChatWindow.tsx');
  const no = '()=>{}';
  const ports = new Map([
    ['@/lib/supabase/client', clientPort],
    ['@/lib/outbox/appOutbox', `export const appOutbox={stop(){},enqueue(){throw Error('OUTBOX_NOT_ADMITTED')},discard(){throw Error('OUTBOX_NOT_ADMITTED')}};`],
    ['@/lib/deliveryReceipts', `export const scheduleMarkChatDelivered=${no},scheduleMarkChatRead=${no};`],
    ['@/lib/monitoring', `export const reportError=${no};`],
    ['@/lib/dev/instrumentation', `export const bumpFetch=${no},registerChannel=${no},unregisterChannel=${no};`],
    ['@/lib/platform/webMessagePreviews', `export const observeWebMessagePreviewIdentity=${no},retireWebMessagePreviews=async()=>true;`],
  ]);
  const result = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': src }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({ DEV: false, VITE_SUPABASE_URL: ORIGIN }) },
    logLevel: 'silent', plugins: [{ name: 'fictional-read-only-boundary', setup(p) {
      p.onResolve({ filter: /.*/ }, a => ports.has(a.path) ? { path: a.path, namespace: 'qa-ports' } : undefined);
      p.onLoad({ filter: /.*/, namespace: 'qa-ports' }, a => ({ contents: ports.get(a.path), loader: 'ts', resolveDir: src }));
      if(mutation&&mutation.file!=='components/chat/ChatWindow.tsx')p.onLoad({filter:/\.(ts|tsx)$/},a=>{
        if(path.resolve(a.path)!==path.resolve(src,mutation.file))return;
        return{contents:sourceText(mutation.file),loader:'ts',resolveDir:path.dirname(a.path)};
      });
    } }], stdin: { resolveDir: src, loader: 'tsx', contents: `
      import React,{useMemo}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
      import{useTopics}from'./hooks/useTopics';import{useMessages}from'./hooks/useMessages';
      import{useAppStore}from'./store/app.store';import{offlineHistory}from'./lib/historyCache/appOfflineHistory';
      const EMPTY_GENERAL_TOPIC_IDS=[];const chatId='${CHAT}',userId='${UID}';let root;
      useAppStore.setState({currentUser:window.input.profile,accountEpoch:1,authSessionSource:window.input.offline?'cache':'sdk',
        selectedTopicId:window.input.selectedTopicId??null,chats:[window.input.chat],messages:{}});
      offlineHistory.setIdentity({userId:'${UID}',sessionId:'${SID}'});
      // Emit-only completion counters. Every value is returned unchanged from
      // the REAL service; no history/cache or hook output is replaced.
      window.diskReads={pending:0,completed:0};const capture=offlineHistory.capture;
      offlineHistory.capture=(...args)=>{const owner=capture(...args);if(!owner)return owner;
        return new Proxy(owner,{get(target,key){const value=target[key];if(!['readMessages','readDefaultMessages'].includes(key)||typeof value!=='function')return value;
          return(...input)=>{window.diskReads.pending++;return value(...input).finally(()=>{window.diskReads.pending--;window.diskReads.completed++})};}})};
      function App(){
        const chat=useAppStore(s=>s.chats.find(c=>c.id===chatId)),selectedTopicId=useAppStore(s=>s.selectedTopicId),accountEpoch=1;
        ${scopeSource(windowSource)}
        const view=${actualMessageCall(windowSource)};
        window.snapshot=()=>({count:view.messages.length,offline:view.showingOfflineHistory,scope:messageTopicId===undefined?'all':messageTopicId===null?'root':'topic',
          scopeKnown:topicScopeKnown,generalCount:messageGeneralTopicIds.length,historyError:!!view.historyError});
        return <main data-count={view.messages.length}>{view.messages.map(m=><div data-message-id={m.id} key={m.id}>Synthetic received media</div>)}</main>;
      }
      window.start=()=>{root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<App/>))};
      window.readSaved=scope=>offlineHistory.capture().readMessages(scope);
      window.readDisk=async()=>{const db=await new Promise((yes,no)=>{const r=indexedDB.open('kub-history-cache');r.onsuccess=()=>yes(r.result);r.onerror=()=>no(Error('IDB_UNAVAILABLE'))});
        try{return await new Promise(yes=>{const tx=db.transaction('records'),r=tx.objectStore('records').getAll();r.onsuccess=()=>yes(r.result.map(x=>({scope:x.scope,payload:x.payload})))})}finally{db.close()}};
      window.restoreChats=async()=>{const o=offlineHistory.capture();const saved=await o.readChats();if(saved)useAppStore.setState({chats:saved});return !!saved};
      window.persistChats=()=>offlineHistory.capture().writeChats([window.input.chat]);
      window.dispose=()=>root&&flushSync(()=>root.unmount());
    ` } });
  return result.outputFiles[0].text;
}

export function data(kind = 'group', offline = false) {
  const at = '2026-10-25T00:00:00Z';
  const profile = { id: UID, username: 'synthetic', full_name: 'Synthetic QA', role: 'user', created_at: at, updated_at: at };
  return { offline, profile, topics: [], chat: { id: CHAT, type: kind, name: 'Synthetic', is_forum: false, created_at: at, updated_at: at, members: [], unread_count: 0 },
    row: { id: MESSAGE, chat_id: CHAT, topic_id: null, user_id: PEER, bot_id: null, type: 'image', content: 'Synthetic', created_at: at, deleted_at: null,
      media_bucket: 'media', media_path: 'synthetic/original.png', media_url: ORIGIN + '/storage/v1/object/public/media/synthetic/original.png',
      media_metadata: { size_bytes: 3608655, mime_type: 'image/png', width: 1024, height: 1024, uncompressed: true,
        preview: { path: 'synthetic/original.preview.webp', mime_type: 'image/webp', width: 1024, height: 1024 } },
      sender: { id: PEER, full_name: 'Synthetic peer', username: 'peer', created_at: at, updated_at: at }, reactions: [], reply_to_id: null } };
}
export function topic(id = TOPIC, isGeneral = false) {
  return { id, chat_id: CHAT, name: 'Synthetic topic', is_general: isGeneral, archived: false, position: isGeneral ? 0 : 1,
    created_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00Z' };
}

export async function fixture(browser, bundle, input) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); let blocked = 0, errors = 0;
  page.on('pageerror', () => errors++);
  await context.route('**/*', route => {
    if (route.request().url() === ORIGIN + '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic cold media</title><div id="root"></div>' });
    blocked++; return route.abort('blockedbyclient');
  });
  const mount = async offline => {
    input.offline = offline;
    await page.goto(ORIGIN);
    await page.evaluate(value => { window.input = value; Object.defineProperty(navigator,'onLine',{configurable:true,value:!value.offline}); }, input);
    await page.addScriptTag({ content: bundle });
    if (offline) assert.equal(await page.evaluate(() => window.restoreChats()), true, 'actual chat projection positive control');
    await page.evaluate(() => window.start());
  };
  await mount(input.offline);
  return { page, context, mount, blocked: () => blocked, errors: () => errors, async close() { try { await page.evaluate(() => window.dispose()); } finally { await context.close(); } } };
}
