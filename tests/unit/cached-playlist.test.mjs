import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../../artifacts/kub/src/components/chat/ChatWindow.tsx',import.meta.url),'utf8');
const tree = ts.createSourceFile('ChatWindow.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names = ['createMediaPlaybackItem','getMessageMediaMetadataNumber','parseMessageDurationMs'];
const text = names.map(name => {
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `actual mounted helper ${name}`); return node.getText(tree);
}).join('\n');
const code = ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const deps = {
  messageMediaUrl: message => message.media_url ?? null,
  messageMediaObjectRef: message => message.media_bucket && message.media_path ? {bucket:message.media_bucket,path:message.media_path} : null,
  isRoundVideoMessageContent: () => false, isVoiceMessageContent: () => true,
  resolveMessageActor: () => ({kind:'user',id:'peer'}), messageActorDisplayName: () => 'Synthetic peer',
  selectVideoPlaybackUrl: input => input.originalUrl,
};
const build = new Function(...Object.keys(deps),code+';return createMediaPlaybackItem;')(...Object.values(deps));
test('the actual conversation playlist retains path-only offline voice rows and their lazy cache identity', () => {
  const row = {id:'voice',type:'audio',chat_id:'chat',user_id:'peer',media_url:null,media_bucket:'media',media_path:'voice.wav',created_at:'2026-10-25T00:00:00Z'};
  const item = build(row,'chat','me');
  assert.ok(item,'offline voice vanished from the actual playlist');
  assert.equal(item.id,'voice'); assert.equal(item.kind,'voice');
  assert.deepEqual(item.media,{chat_id:'chat',media_bucket:'media',media_path:'voice.wav',media_url:null});
  assert.equal(build({...row,deleted_at:row.created_at},'chat','me'),null);
  assert.equal(build({...row,media_bucket:null,media_path:null},'chat','me'),null);
});
