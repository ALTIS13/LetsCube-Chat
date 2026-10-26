import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, makeBundle, fixture, data, topic, CHAT, TOPIC, GENERAL, MESSAGE } from '../e2e/cold-media-open-fixture.mjs';

let browser, bundle;
test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, '0');
  bundle = await makeBundle(); browser = await chromium.launch({ headless: true });
});
test.after(async () => browser?.close());

async function defaultDisplayCase(kind, js, t) {
  const f = await fixture(browser, js, data(kind));
  try {
    await f.page.waitForFunction(() => window.snapshot?.().count === 1 && window.snapshot().scope === 'all');
    await f.page.waitForFunction(async chatId => (await window.readSaved({ chatId, topicId:undefined, generalTopicIds:[] }))?.messages.length === 1, CHAT);
    assert.equal(await f.page.evaluate(() => window.persistChats()), true);
    await f.page.evaluate(() => window.dispose());
    await f.mount(true); // fresh JS module state, same actual browser IndexedDB/session identity
    await f.page.waitForFunction(() => (window.snapshot && window.readCalls.some(c => c.table === 'topics' && c.offline)) || window.snapshot?.().offline);
    const exactSaved = await f.page.evaluate(chatId => window.readSaved({chatId,topicId:undefined,generalTopicIds:[]}), CHAT);
    assert.equal(exactSaved.messages.length, 1, 'warm all-scope record is still physically present');
    assert.equal(exactSaved.messages[0].media_url, null, 'ordinary offline projection strips transient URLs');
    assert.equal(exactSaved.messages[0].media_metadata.preview, undefined, 'ordinary offline projection omits nested preview metadata');
    // Wait for the actual hook/disk reads, not a timing-based absence assertion.
    await f.page.waitForFunction(() => window.diskReads.pending === 0 && window.diskReads.completed >= 2);
    await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = await f.page.evaluate(() => window.snapshot());
    t?.diagnostic(JSON.stringify({kind,coldCount:state.count,coldScope:state.scope,topicsAuthorityKnown:state.scopeKnown,storedAllRecordPresent:true}));
    assert.equal(state.count, 1, 'COLD_GROUP_DISPLAY_SCOPE_MUST_FIND_RECEIVED_HISTORY');
    assert.equal(state.offline, true);
    if(kind==='group')assert.equal(state.scopeKnown,false,'cached DISPLAY topology must not grant fresh topic authority');
    assert.equal(f.errors(), 0, 'no browser component runtime failures'); assert.equal(f.blocked(), 0);
  } finally { await f.close(); }
}
for (const kind of ['private','group']) test(`actual coupled ${kind}: ordinary received page remains readable after cold offline projection`, { timeout: 20000 }, t => defaultDisplayCase(kind,bundle,t));

test('actual coupled cold group: explicitly selected topic must not borrow the verified default snapshot', {timeout:20000}, async () => {
  const input=data('group'),f=await fixture(browser,bundle,input);
  try{
    await f.page.waitForFunction(()=>window.snapshot?.().count===1&&window.snapshot().scope==='all');
    await f.page.waitForFunction(async chatId=>(await window.readSaved({chatId,topicId:undefined,generalTopicIds:[]}))?.messages.length===1,CHAT);
    assert.equal(await f.page.evaluate(()=>window.persistChats()),true);
    await f.page.evaluate(()=>window.dispose()); input.selectedTopicId=TOPIC;
    await f.mount(true);
    await f.page.waitForFunction(()=>window.diskReads.completed>=1&&window.diskReads.pending===0&&window.readCalls.some(c=>c.table==='topics'&&c.offline));
    await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const exactSaved=await f.page.evaluate(chatId=>window.readSaved({chatId,topicId:undefined,generalTopicIds:[]}),CHAT);
    assert.equal(exactSaved.messages.length,1,'the default record must really exist for this refusal control');
    const state=await f.page.evaluate(()=>window.snapshot());
    assert.equal(state.count,0,'explicit channel cannot borrow default history');assert.equal(state.offline,false);
    assert.equal(state.scopeKnown,false);assert.equal(f.errors(),0);assert.equal(f.blocked(),0);
  }finally{await f.close()}
});

async function rootDoesNotAliasCase(js,t) {
  const input=data('group'); input.topics=[topic()];
  const f=await fixture(browser,js,input);
  try{
    await f.page.waitForFunction(()=>window.snapshot?.().count===1&&window.snapshot().scope==='root'&&window.snapshot().scopeKnown);
    await f.page.waitForFunction(async chatId=>(await window.readSaved({chatId,topicId:null,generalTopicIds:[]}))?.messages.length===1,CHAT);
    assert.equal(await f.page.evaluate(()=>window.persistChats()),true);
    await f.page.evaluate(()=>window.dispose());input.selectedTopicId=TOPIC;
    await f.mount(true);
    await f.page.waitForFunction(()=>window.diskReads.completed>=1&&window.diskReads.pending===0&&window.readCalls.some(c=>c.table==='topics'&&c.offline));
    await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const saved=await f.page.evaluate(chatId=>window.readSaved({chatId,topicId:null,generalTopicIds:[]}),CHAT);
    assert.equal(saved.messages.length,1,'an exact cached ROOT/null record must really exist');
    assert.equal(saved.messages[0].topic_id,null,'the refusal control is ROOT content, not explicit-channel content');
    const state=await f.page.evaluate(()=>window.snapshot());
    t?.diagnostic(JSON.stringify({rootRecordPresent:true,coldCount:state.count,scopeKnown:state.scopeKnown}));
    assert.equal(state.count,0,'EXPLICIT_TOPIC_MUST_NOT_ALIAS_CACHED_ROOT_DEFAULT');assert.equal(state.offline,false);
    assert.equal(state.scopeKnown,false);assert.equal(f.errors(),0);assert.equal(f.blocked(),0);
  }finally{await f.close()}
}
test('actual coupled cold group: explicit selection must not alias an actually cached ROOT default', {timeout:20000}, t => rootDoesNotAliasCase(bundle,t));

async function explicitRestoreCase(js,t) {
  const input=data('group');input.topics=[topic(GENERAL,true),topic()];input.selectedTopicId=TOPIC;input.row.topic_id=TOPIC;
  const f=await fixture(browser,js,input);
  try{
    await f.page.waitForFunction(()=>window.snapshot?.().count===1&&window.snapshot().scope==='topic'&&window.snapshot().generalCount===1&&window.snapshot().scopeKnown);
    await f.page.waitForFunction(async ({CHAT,TOPIC,GENERAL})=>(await window.readSaved({chatId:CHAT,topicId:TOPIC,generalTopicIds:[GENERAL]}))?.messages.length===1,{CHAT,TOPIC,GENERAL});
    assert.equal(await f.page.evaluate(()=>window.persistChats()),true);
    await f.page.evaluate(()=>window.dispose());
    await f.mount(true);
    await f.page.waitForFunction(()=>window.diskReads.completed>=1&&window.diskReads.pending===0&&window.readCalls.some(c=>c.table==='topics'&&c.offline));
    await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const saved=await f.page.evaluate(({CHAT,TOPIC,GENERAL})=>window.readSaved({chatId:CHAT,topicId:TOPIC,generalTopicIds:[GENERAL]}),{CHAT,TOPIC,GENERAL});
    assert.equal(saved.messages.length,1,'warm verified explicit-channel snapshot remains present');assert.equal(saved.messages[0].topic_id,TOPIC);
    const state=await f.page.evaluate(()=>window.snapshot());
    t?.diagnostic(JSON.stringify({explicitRecordPresent:true,coldCount:state.count,scopeKnown:state.scopeKnown,generalCount:state.generalCount}));
    assert.equal(state.count,1,'COLD_UNKNOWN_TOPOLOGY_MUST_RESTORE_ONLY_REQUESTED_EXPLICIT_TOPIC');assert.equal(state.offline,true);
    assert.deepEqual(await f.page.locator('[data-message-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-message-id'))),[MESSAGE]);
    assert.equal(state.scopeKnown,false);assert.equal(state.generalCount,0);assert.equal(f.errors(),0);assert.equal(f.blocked(),0);
  }finally{await f.close()}
}
test('actual coupled cold group: seen explicit channel restores with unknown general topology and no authority', {timeout:20000}, t => explicitRestoreCase(bundle,t));

for(const [name,mutation,contract,oracle] of [
  ['default display discovery omitted',
    {file:'hooks/useMessages.ts',from:'owner.readDefaultMessages(chatId)',to:'owner.readMessages({chatId,topicId,generalTopicIds})'},
    js=>defaultDisplayCase('group',js),'COLD_GROUP_DISPLAY_SCOPE_MUST_FIND_RECEIVED_HISTORY'],
  ['hook selected display override omitted',
    {file:'hooks/useMessages.ts',from:'const offlineTopicId = options.offlineRequestedTopicId ?? topicId;',to:'const offlineTopicId = topicId;'},
    rootDoesNotAliasCase,'EXPLICIT_TOPIC_MUST_NOT_ALIAS_CACHED_ROOT_DEFAULT'],
  ['actual window selected display binding omitted',
    {file:'components/chat/ChatWindow.tsx',from:'offlineRequestedTopicId: topicScopeUnknown && selectedTopicId !== null ? selectedTopicId : undefined,',to:'offlineRequestedTopicId: undefined,'},
    rootDoesNotAliasCase,'EXPLICIT_TOPIC_MUST_NOT_ALIAS_CACHED_ROOT_DEFAULT'],
  ['explicit topic key normalization omitted',
    {file:'lib/historyCache/offline.ts',from:'typeof scope.topicId === "string" && !legacy ? [] : ',to:''},
    explicitRestoreCase,'COLD_UNKNOWN_TOPOLOGY_MUST_RESTORE_ONLY_REQUESTED_EXPLICIT_TOPIC'],
])test(`compiled literal mutation killed: ${name}`,{timeout:20000},async()=>{
  const mutated=await makeBundle(mutation);
  await assert.rejects(()=>contract(mutated),error=>{
    assert.equal(error.code,'ERR_ASSERTION','setup/timeout failures do not kill a mutation');
    assert.ok(error.message.includes(oracle),'the same literal behavior oracle must reject the mutated source');return true;
  });
});
