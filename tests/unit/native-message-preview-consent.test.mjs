import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import test from 'node:test';
import {foregroundCompositionSourceNames,foregroundCompositionStubs,compositionPlatform} from '../android/message-preview-genuine-composition.fixture.mjs';
const root=resolve(import.meta.dirname,'../..'),java=join(root,'android/app/src/main/java/com/kub/messenger');
const prefix='letscube-preview-consent-',bin=n=>join('C:/Program Files/Android/Android Studio/jbr/bin',n+'.exe');
let classes;
function clean(path){const p=realpathSync(path);assert.equal(p,resolve(path));assert.equal(dirname(p),realpathSync(tmpdir()));
  assert.ok(basename(p).startsWith(prefix));rmSync(p,{recursive:true});}
function compile(path,subject=join(java,'MessagePreviewConsent.java')){
  // MainActivity's unused plugin registration only; native Session/authority/storage remain actual.
  const stubs={...foregroundCompositionStubs,'com/kub/messenger/MessagePreviewsPlugin.java':'package com.kub.messenger; public final class MessagePreviewsPlugin {}'};
  const files=Object.entries(stubs).map(([name,text])=>{const p=join(path,'stubs',name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);return p;});
  const platform=join(path,'MessagePreviewProducerPlatform.java');writeFileSync(platform,compositionPlatform);
  const sources=[...new Set([...foregroundCompositionSourceNames,'MessagePreviewSession','MessagePreviewChoiceStore'])]
    .filter(n=>n!=='MessagePreviewsPlugin'&&n!=='MessagePreviewConsent').map(n=>join(java,n+'.java')).filter(existsSync);
  const r=spawnSync(bin('javac'),['-encoding','UTF-8','-g:none','-d',path,...files,...sources,...(existsSync(subject)?[subject]:[]),platform,
    join(root,'tests/android/MessagePreviewSessionProbe.java'),join(root,'tests/android/MessagePreviewConsentProbe.java')],
    {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:262144});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
}
function run(scenario,path=classes){const files=mkdtempSync(join(tmpdir(),prefix+'files-'));
  try{const r=spawnSync(bin('java'),['-cp',path,'com.kub.messenger.MessagePreviewConsentProbe',scenario,files],
    {encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536});assert.equal(r.error,undefined);return r;}
  finally{clean(files);}}
function healthy(scenario,path=classes){const r=run(scenario,path);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'PASS '+scenario);}
test.before(()=>{classes=mkdtempSync(join(tmpdir(),prefix+'classes-'));compile(classes);});
test.after(()=>{if(classes)clean(classes);});
for(const scenario of ['refresh','none','sender','begin-confirm','confirm-none','floor','invalid','replay','mismatch','unknown',
  'refresh-after-begin','begin-during-refresh','new-begin-during-confirm','rollback','expired','deadline','head-change','owner-change','logout','callback','close',
  'double-confirm','store-failure','corrupt-choice','begin-write-failure','owner-session','owner-device','owner-epoch','binding-generation','binding-revision','close-confirmed','close-pending',
  'invalid-begin','replayed-begin','closed-begin','stale-head-choice','closed-worker-choice'])
  test('native consent: '+scenario,()=>healthy(scenario));

const mutants=[
  ['reject before deny','Work work = admission(kind, binding, revision, choice, completion);',
    'if (kind == BEGIN) session.blockContent(binding); Work work = admission(kind, binding, revision, choice, completion);','replayed-begin','REJECTED_BEGIN_PRESERVES_CONTENT'],
  ['native binding before write','() -> checkHead(op, vault, record)','() -> {}','stale-head-choice','STALE_WORKER_CANNOT_CLOBBER_CHOICE'],
  ['document is not logout','if (!confirmed || pending != null) session.blockContent(scope);','session.blockContent(scope);','close-confirmed','DOCUMENT_DETACH_IS_NOT_LOGOUT'],
  ['exact server choice','require(kind != CONFIRM || choice.equals(level));','','mismatch','SERVER_EXACT_CHOICE_REQUIRED'],
  ['durable revision floor','floor = Math.max(floor, choices.read(record).revision);','choices.read(record);','floor','MAX_DURABLE_REVISION'],
  ['synchronous deny','if (kind == BEGIN) session.blockContent(binding);','','begin-confirm','BEGIN_SYNCHRONOUS_DENY'],
  ['owner recipient','owner.recipient.equals(op.binding.recipient)','true','owner-change','CURRENT_HEAD_OWNER_CLOCK_REQUIRED'],
  ['owner session','owner.session.equals(op.binding.session)','true','owner-session','CURRENT_HEAD_OWNER_CLOCK_REQUIRED'],
  ['owner device','owner.device.equals(op.binding.device)','true','owner-device','CURRENT_HEAD_OWNER_CLOCK_REQUIRED'],
  ['owner account epoch','owner.accountEpoch == op.binding.accountEpoch','true','owner-epoch','CURRENT_HEAD_OWNER_CLOCK_REQUIRED'],
  ['binding generation','record.header.generation == binding.generation','true','binding-generation','CURRENT_HEAD_OWNER_CLOCK_REQUIRED'],
  ['binding revision','record.header.vaultRevision == binding.vaultRevision','true','binding-revision','CURRENT_HEAD_OWNER_CLOCK_REQUIRED'],
  ['durable choice before allow','save(this, vault, record, level);','','store-failure','DURABLE_CHOICE_REQUIRED'],
  ['head freshness','require(vault.isCurrent(record, now(op)));','now(op);','head-change','CURRENT_HEAD_OWNER_CLOCK_REQUIRED'],
  ['wall rollback','wallNow >= op.wallHigh','true','rollback','CURRENT_HEAD_OWNER_CLOCK_REQUIRED'],
  ['refresh after begin','if (begun) return null;','','refresh-after-begin','REFRESH_CANNOT_OVERRIDE_BEGIN',
    [['op.kind == REFRESH ? !begun : pending == op.pending','op.kind == REFRESH ? true : pending == op.pending']]],
];
for(const [name,before,after,scenario,oracle,also=[]]of mutants)test('compiled consent mutant: '+name,()=>{
  healthy(scenario);let text=readFileSync(join(java,'MessagePreviewConsent.java'),'utf8');
  for(const[from,to]of [[before,after],...also]){assert.equal(text.split(from).length,2,'EXACT_RULE_SITE');text=text.replace(from,to);}
  const path=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{const subject=join(path,'MessagePreviewConsent.java');writeFileSync(subject,text);compile(path,subject);
    const r=run(scenario,path);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr.trim(),'FAIL '+oracle);
  }finally{clean(path);}
});
