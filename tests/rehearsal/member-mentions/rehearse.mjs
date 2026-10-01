import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { functionMutations, guardMutations } from './mutations.mjs';

// Only a newly created, exactly verified network-none container is writable.
const token = randomUUID();
const name = `letscube-d331-${token}`;
const image = 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00';
const backupStamp = process.env.D331_REHEARSAL_BACKUP_STAMP ?? '20261001-175542';
assert.match(backupStamp, /^20\d{6}-\d{6}$/);
const backup = `/srv/letscube/backups/automated/${backupStamp}/db/supabase-postgres.custom`;
const expectedTables = Number(process.env.D331_REHEARSAL_EXPECTED_TABLES ?? 164);
assert.ok(Number.isSafeInteger(expectedTables) && expectedTables >= 163);
const root = new URL('../../../', import.meta.url);
const migrationURL = new URL('supabase/migrations/20261001180000_member_mentions.sql', root);
const rollbackURL = new URL('supabase/migrations/20261001180000_member_mentions.rollback.sql', root);
const red = process.argv.includes('--red');
const mutations = process.argv.includes('--mutations');
const payloadOnly = process.argv.includes('--payload-only');
const U = (n) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C = '20000000-0000-4000-8000-000000000001';
const B = '30000000-0000-4000-8000-000000000001';
const F = '30000000-0000-4000-8000-000000000002';
const M = '50000000-0000-4000-8000-000000000001';
const R = '60000000-0000-4000-8000-000000000001';
let id;
let checks=0;
let statements=0;
let mutantKills=0;
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const shellQuote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
function command(args, input, timeout=45000) {
  const child=spawn('ssh',['-i','C:/Users/maksi/.ssh/letscube_ed25519','-o','BatchMode=yes','-o','ConnectTimeout=10','root@ms.letscube.ru',args.map(shellQuote).join(' ')]);
  let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
  const timer=setTimeout(()=>child.kill(),timeout);
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout:stdout.trim(),stderr:stderr.trim()});});});
  if(input!==null)child.stdin.end(input);return {child,done};
}
async function docker(args,input) {const r=await command(['docker',...args],input).done;assert.equal(r.code,0,`owned Docker ${args[0]} failed`);return r.stdout;}
async function owned() {
  const [c]=JSON.parse(await docker(['inspect',id]));assert.equal(c.Id,id);assert.equal(c.Name,`/${name}`);assert.equal(c.Image,image);
  assert.equal(c.Config.Labels['letscube.d331.owner'],token);assert.equal(c.HostConfig.NetworkMode,'none');assert.equal(c.HostConfig.Privileged,false);
  assert.deepEqual(c.HostConfig.PortBindings,{});assert.ok(c.Mounts.every(m=>!['bind','volume'].includes(m.Type)));
}
function sql(text,db='mentions_qa') {assert.ok(id);statements++;return command(['docker','exec','-i',id,'psql','-X','-qAt','-h','/tmp','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],text).done;}
async function q(text,db) {const r=await sql(text,db);assert.equal(r.code,0,`isolated SQL failed: ${r.stderr}`);return r.stdout;}
const auth=(who,text)=>`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${who}"}'; ${text} RESET ROLE; SET LOCAL request.jwt.claims='{}';`;
const entity=(kind,target,offset,length,label)=>({kind,[kind==='user'?'user_id':'bot_id']:target,offset,length,label});
const envelope=(items,revision=R)=>JSON.stringify({version:1,revision,items});
const insert=(content='@User',data)=>`INSERT INTO public.messages(id,chat_id,user_id,content${data===undefined?'':',mention_entities'}) VALUES('${M}','${C}','${U(1)}',${quote(content)}${data===undefined?'':','+quote(data)+'::jsonb'});`;
async function tx(text) {return q(`BEGIN; ${text} ROLLBACK;`);}
async function bad(text,code='22023') {const r=await sql(`BEGIN; ${text} ROLLBACK;`);assert.notEqual(r.code,0);assert.ok(r.stderr.includes(code)||r.stderr.includes('invalid_message_mentions')||(code==='22023'&&r.stderr.includes('invalid_message_topic')),`unexpected refusal ${r.stderr}`);}
async function check(label,fn) {await fn();checks++;console.log(`PASS ${label}`);}

export function transactionCheck(source) {
  let i=0,s='',out=[];
  while(i<source.length) {
    if(source.startsWith('--',i)){const n=source.indexOf('\n',i);i=n<0?source.length:n+1;continue;}
    if(source.startsWith('/*',i)){let depth=1;i+=2;while(i<source.length&&depth){if(source.startsWith('/*',i)){depth++;i+=2;}else if(source.startsWith('*/',i)){depth--;i+=2;}else i++;}assert.equal(depth,0);continue;}
    const tag=source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if(tag){const n=source.indexOf(tag,i+tag.length);assert.ok(n>=0);s+=' BODY ';i=n+tag.length;continue;}
    if(source[i]==="'"||source[i]==='"'){const ch=source[i++];let closed=false;while(i<source.length){if(source[i++]===ch){if(source[i]===ch)i++;else{closed=true;break;}}}assert.ok(closed);s+=' QUOTE ';continue;}
    if(source[i]===';'){if(s.trim())out.push(s.trim().toLowerCase());s='';i++;}else s+=source[i++];
  }
  assert.equal(s.trim(),'');assert.equal(out[0],'begin');assert.equal(out.at(-1),'commit');
  assert.deepEqual(out.filter(x=>/^(begin|commit|rollback|abort|end|start|savepoint|release)\b/.test(x)),['begin','commit']);
}
async function catalog() {
  return JSON.parse(await q(`SELECT json_build_object('functions',(SELECT json_agg(json_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'owner',p.proowner,'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl,'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('private','public') AND p.proname IN ('enqueue_message_notifications','_notification_push_allowed','_notification_push_payload','push_outbox_delivery_recheck','native_push_outbox_delivery_recheck','album_push_recheck','bot_can_receive_message','enqueue_bot_message_updates_after_update','deleted_message_keeps_nothing','scrub_deleted_message_notifications')), 'triggers',(SELECT json_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid IN ('public.messages'::regclass,'public.notifications'::regclass) AND NOT t.tgisinternal), 'policies',(SELECT json_agg(json_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',p.polroles,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid='public.notifications'::regclass), 'index',(SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid='public.notifications_message_user_once_idx'::regclass));`));
}
async function create() {
  assert.equal(await docker(['ps','-a','--filter',`name=^/${name}$`,'--format','{{.ID}}']),'');
  assert.equal(await docker(['image','inspect',image,'--format','{{.Id}}']),image);
  id=await docker(['run','-d','--name',name,'--label',`letscube.d331.owner=${token}`,'--network','none','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/tmp:rw,size=256m,mode=1777','--user','postgres','--entrypoint','/bin/sleep',image,'infinity']);
  await owned();console.log(`TARGET ${name} PG17.6 network=none ports=0 mounts=0`);
  await docker(['exec',id,'initdb','-D','/tmp/d331','-U','supabase_admin','--auth=trust','--no-locale','--encoding=UTF8']);
  await docker(['exec','-d',id,'postgres','-D','/tmp/d331','-c','listen_addresses=','-c','unix_socket_directories=/tmp','-c','max_connections=40','-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements,supabase_vault','-c','cron.database_name=mentions_qa','-c','cron.launch_active_jobs=off','-c','pg_net.database_name=postgres']);
  for(let n=0;n<80;n++){if((await command(['docker','exec',id,'pg_isready','-h','/tmp']).done).code===0)break;await new Promise(r=>setTimeout(r,100));}
  await q('CREATE DATABASE mentions_qa;', 'postgres');
  const roles=['anon','authenticated','authenticator','dashboard_user','pgbouncer','postgres','service_role','supabase_auth_admin','supabase_etl_admin','supabase_functions_admin','supabase_privileged_role','supabase_read_only_user','supabase_realtime_admin','supabase_replication_admin','supabase_storage_admin'];
  const bypass=new Set(['postgres','service_role','supabase_etl_admin','supabase_read_only_user']);
  await q(roles.map(r=>`CREATE ROLE ${r} NOLOGIN ${bypass.has(r)?'BYPASSRLS':'NOBYPASSRLS'};`).join('\n'),'postgres');
  await owned();
  if (backupStamp === '20261001-175542') {
    const checksum=await command(['sha256sum',backup]).done;
    assert.equal(checksum.code,0);
    assert.equal(checksum.stdout.split(/\s+/)[0],'fbf1884423d5d37990bb8665debaa64fe881fad9cd544fc20ececd8855cd3b24','fresh approved full backup hash');
  }
  // The only host redirection is this exact previously authorized custom dump into this verified fresh container.
  const restore=spawn('ssh',['-i','C:/Users/maksi/.ssh/letscube_ed25519','-o','BatchMode=yes','-o','ConnectTimeout=10','root@ms.letscube.ru',`docker exec -i ${id} pg_restore --exit-on-error --single-transaction -h /tmp -U supabase_admin -d mentions_qa < ${backup}`]);
  restore.stdout.resume();restore.stderr.resume();const timer=setTimeout(()=>restore.kill(),120000);
  const code=await new Promise((resolve,reject)=>{restore.on('error',reject);restore.on('close',resolve);});clearTimeout(timer);assert.equal(code,0,'full restore failed; raw private diagnostics suppressed');
  assert.equal(await q("SELECT current_setting('cron.launch_active_jobs') || ':' || current_setting('pg_net.database_name');"),'off:postgres');
  assert.equal(await q("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%';"),String(expectedTables));
  await q('ALTER ROLE supabase_admin SET search_path TO public, auth, extensions;','postgres');
  const phoneInstalled = await q("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.privacy_preferences'::regclass AND attname='phone_findable_by' AND NOT attisdropped);");
  assert.ok(['t','f'].includes(phoneInstalled));
  if (phoneInstalled === 'f') await q(await readFile(new URL('supabase/migrations/20260930235000_phone_search_for_everybody.sql',root),'utf8'));
  assert.equal(await q("SET search_path=pg_catalog,pg_temp; SELECT encode(sha256(convert_to(pg_get_functiondef('public.search_profiles_by_phone(text,integer)'::regprocedure),'UTF8')),'hex');"),
    'b407086374d55fbe72954ff8da9256e6bc838c51e35fe7bf7a3e762900fdcc11','restored phone definition must match the released contract');
  console.log(`RESTORE full custom dump exit=0 tables=${expectedTables}; phone migration ${phoneInstalled==='t'?'already installed':'reapplied'}; cron=off pg_net=empty_postgres`);
  await q(await readFile(new URL('./fixture.sql',import.meta.url),'utf8'));
}

async function redCases() {
  assert.equal(await tx(`${auth(U(1),insert())} SELECT count(*) FROM public.notifications WHERE kind='message' AND payload->>'message_id'='${M}';`),'2','real authenticated positive control');
  let killed=0;
  try {assert.equal(await tx(`INSERT INTO public.user_blocks(blocker_id,blocked_id) VALUES('${U(2)}','${U(1)}'); ${auth(U(1),insert())} SELECT count(*) FROM public.notifications WHERE user_id='${U(2)}' AND kind='message' AND payload->>'message_id'='${M}';`),'0');}catch(e){assert.equal(e.code,'ERR_ASSERTION');killed++;console.log('EXPECTED RED real authenticated blocked-recipient fanout: actual=1 expected=0');}
  try {assert.equal(await q("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.messages'::regclass AND attname='mention_entities' AND NOT attisdropped);"),'t');}catch(e){assert.equal(e.code,'ERR_ASSERTION');killed++;console.log('EXPECTED RED identity metadata column absent');}
  assert.equal(killed,2);console.log('RED SUMMARY 2 regressions exposed; authenticated positive control passed');
}


async function validation() {
  await check('literal UTF16 boundaries, UUID/envelope/range limits',async()=>{
    const e=entity('user',U(2),3,5,'@User');
    assert.equal(await tx(`${auth(U(1),insert('\u{1f600} @User',envelope([e])))} SELECT mention_entities->'items'->0->>'offset' FROM public.messages WHERE id='${M}';`),'3');
    const invalid=[{...e,offset:1},{...e,offset:4},{...e,length:4},{...e,label:'@Wrong'},{...e,user_id:'not-uuid'},{...e,length:0},{...e,offset:-1},{...e,offset:0.5},{...e,extra:true}];
    for(const item of invalid)await bad(auth(U(1),insert('\u{1f600} @User',envelope([item]))));
    for(const raw of ['null','[]','{"version":2,"revision":null,"items":[]}','{"version":1,"revision":null,"items":[],"extra":1}',envelope([e],null)])await bad(auth(U(1),insert('\u{1f600} @User',raw)));
    const integral=envelope([entity('user',U(2),1,5,'@User')]).replace('"offset":1','"offset":1.0').replace('"length":5','"length":5.0');
    assert.equal(await tx(auth(U(1),insert(' @User',integral))+"SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='"+M+"';"),'1');
    const label='@'+'x'.repeat(127);assert.equal(await tx(`${auth(U(1),insert(label,envelope([entity('user',U(2),0,128,label)])))} SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='${M}';`),'1');
    await bad(auth(U(1),insert(label+'x',envelope([entity('user',U(2),0,129,label+'x')]))));
    await bad(auth(U(1),insert('@A\nB',envelope([entity('user',U(2),0,4,'@A\nB')]))));
    for(const label of ['@','@ ','@\u0301','@\u200b','@A\u200e','@A\u2067','@A\u00a0'])await bad(auth(U(1),insert(label,envelope([entity('user',U(2),0,label.length,label)]))));
    for(const label of ['@A\u0301','@\u{1f600}','@\u0410\u043d\u043d\u0430 \u0421\u043c\u0438\u0440\u043d\u043e\u0432\u0430'])assert.equal(await tx(`${auth(U(1),insert(label,envelope([entity('user',U(2),0,label.length,label)])))} SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='${M}';`),'1');
    const content=Array(32).fill('@U').join(' ');const items=Array.from({length:32},(_,i)=>entity('user',U(2),i*3,2,'@U'));
    assert.equal(await tx(`${auth(U(1),insert(content,envelope(items)))} SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='${M}';`),'32');
    await bad(auth(U(1),insert(content+' @U',envelope([...items,entity('user',U(2),96,2,'@U')]))));
    await bad(auth(U(1),insert('@User',envelope([entity('user',U(2),0,5,'@User'),entity('user',U(2),0,5,'@User')]))));
  });
}
async function behavior() {
  await validation();
  const data=envelope([entity('user',U(2),0,5,'@User')]);
  await check('canonicalization, masks, legacy/fresh/historical edits and forwarding',async()=>{
    assert.equal(await tx(`${auth(U(1),insert('@User',envelope([entity('user',U(5),0,5,'@User')])))} SELECT mention_entities->'items' FROM public.messages WHERE id='${M}';`),'[]');
    for(const [text,off,len,label] of [['`@User`',1,5,'@User'],['```\n@User\n```',4,5,'@User'],['https://example.invalid/@User',24,5,'@User'],['a@User.example',1,5,'@User'],['/go@User',3,5,'@User']])assert.equal(await tx(`${auth(U(1),insert(text,envelope([entity('user',U(2),off,len,label)])))} SELECT mention_entities->'items' FROM public.messages WHERE id='${M}';`),'[]');
    assert.equal(await tx(`${auth(U(1),insert('**@User**',envelope([entity('user',U(2),2,5,'@User')])))} SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='${M}';`),'1');
    for(const [text,active] of [['~~~\n@User\n~~~',0],['  ~~~~ info\n@User\n  ~~~~~',0],['~~~\n@User',0],['\\`@User',1],['\\\\`@User',0],['`unfinished\n@User',1],['`@User',0],['(* /go@User)',0],['x/go@User',1],['www.example/@User',0],['xwww.example/@User',1],['\u0430@User.\u0440\u0444',0],['_@User_',1],['\u00a0/go@User',0],['https://x\u00a0@User',1],['\ufeff/go@User',0],['https://x\ufeff@User',1]]) {
      const off=text.indexOf('@User');assert.equal(await tx(`${auth(U(1),insert(text,envelope([entity('user',U(2),off,5,'@User')])))} SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='${M}';`),String(active),text);
    }
    assert.equal(await tx(`${auth(U(1),insert('@User',data))} DELETE FROM public.chat_members WHERE chat_id='${C}' AND user_id='${U(2)}'; ${auth(U(1),`UPDATE public.messages SET pinned=true WHERE id='${M}';`)} SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='${M}';`),'1');
    const fresh=envelope([entity('user',U(2),2,5,'@User')],'60000000-0000-4000-8000-000000000002');
    assert.equal(await tx(`${auth(U(1),insert('@User',data))} DELETE FROM public.chat_members WHERE chat_id='${C}' AND user_id='${U(2)}'; ${auth(U(1),`UPDATE public.messages SET content='x @User',mention_entities=${quote(fresh)}::jsonb WHERE id='${M}';`)} SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='${M}';`),'1');
    assert.equal(await tx(`${auth(U(1),insert('@User',data)+`UPDATE public.messages SET content='plain' WHERE id='${M}';`)} SELECT mention_entities FROM public.messages WHERE id='${M}';`),'{"items": [], "version": 1, "revision": null}');
    await bad(auth(U(1),insert('@User',data)+`UPDATE public.messages SET mention_entities=${quote(envelope([entity('user',U(3),0,5,'@User')]))}::jsonb WHERE id='${M}';`));
    assert.equal(await tx(`${auth(U(1),insert('@User',data)+`INSERT INTO public.messages(chat_id,user_id,content,forwarded_from_id,mention_entities) VALUES('${C}','${U(1)}','@User','${M}',${quote(data)}::jsonb);`)} SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE forwarded_from_id='${M}';`),'0');
    assert.equal(await tx(`${auth(U(1),insert('@User',data))} ${auth(U(1),`SELECT jsonb_array_length((public.forward_message('${M}','20000000-0000-4000-8000-000000000002')).mention_entities->'items');`)}`),'0');
    await bad(auth(U(5),insert('@User',data)),'row-level security');
    await bad(`INSERT INTO public.topics(id,chat_id,name) VALUES('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','D331 synthetic'); ${auth(U(1),insert('@User',data)+`UPDATE public.messages SET topic_id='80000000-0000-4000-8000-000000000001' WHERE id='${M}';`)}`);
    assert.equal(await tx(`UPDATE public.bots SET state='paused' WHERE id='${B}'; ${auth(U(1),insert('@User',envelope([entity('bot',B,0,5,'@User')])))} SELECT mention_entities->'items' FROM public.messages WHERE id='${M}';`),'[]');
  });
  await check('recipient-local boolean, single ordinary row, edit no reping',async()=>{
    const twice=envelope([entity('user',U(2),0,2,'@U'),entity('user',U(2),3,2,'@U')]);
    assert.equal(await tx(`${auth(U(1),insert('@U @U',twice))} SELECT count(*)||':'||count(*) FILTER(WHERE user_id='${U(2)}' AND payload->>'mentioned'='true')||':'||count(*) FILTER(WHERE payload ? 'mention_entities' OR payload ? 'items') FROM public.notifications WHERE kind='message' AND payload->>'message_id'='${M}';`),'2:1:0');
    assert.equal(await tx(`${auth(U(1),insert('@User',data))} UPDATE public.notifications SET read_at=now() WHERE kind='message' AND payload->>'message_id'='${M}'; ${auth(U(1),`UPDATE public.messages SET content='plain' WHERE id='${M}';`)} SELECT count(*)||':'||count(*) FILTER(WHERE read_at IS NOT NULL)||':'||count(*) FILTER(WHERE payload->>'mentioned'='true') FROM public.notifications WHERE kind='message' AND payload->>'message_id'='${M}';`),'2:2:0');
    assert.equal(await tx(`${auth(U(1),insert('@User',envelope([entity('user',U(1),0,5,'@User')])))} SELECT count(*) FROM public.notifications WHERE user_id='${U(1)}' AND payload->>'message_id'='${M}';`),'0');
  });
  await check('directional block, ban, hidden/clear/message-hide, membership epoch and owner RLS',async()=>{
    assert.equal(await tx(`INSERT INTO public.user_blocks VALUES('${U(2)}','${U(1)}',now()); ${auth(U(1),insert('@User',data))} SELECT jsonb_array_length(mention_entities->'items')||':'||(SELECT count(*) FROM public.notifications WHERE user_id='${U(2)}' AND payload->>'message_id'='${M}') FROM public.messages WHERE id='${M}';`),'1:0');
    assert.equal(await tx(`INSERT INTO public.user_blocks VALUES('${U(1)}','${U(2)}',now()); ${auth(U(1),insert())} SELECT count(*) FROM public.notifications WHERE user_id='${U(2)}' AND payload->>'message_id'='${M}';`),'1');
    const deny=[`UPDATE public.chat_members SET hidden_at=now() WHERE chat_id='${C}' AND user_id='${U(2)}';`,`UPDATE public.chat_members SET cleared_at=clock_timestamp()+interval '1 second' WHERE chat_id='${C}' AND user_id='${U(2)}';`,`UPDATE public.chat_members SET joined_at=clock_timestamp()+interval '1 second' WHERE chat_id='${C}' AND user_id='${U(2)}';`,`INSERT INTO public.message_hidden_for_users(message_id,user_id) VALUES('${M}','${U(2)}');`,`INSERT INTO public.bans(user_id,reason) VALUES('${U(2)}','isolated D331');`,`DELETE FROM public.chat_members WHERE chat_id='${C}' AND user_id='${U(2)}';`];
    assert.equal(await tx(`${auth(U(1),insert())} ${auth(U(2),`SELECT count(*) FROM public.notifications WHERE payload->>'message_id'='${M}';`)}`),'1');
    assert.equal(await tx(`${auth(U(1),insert())} ${auth(U(5),`SELECT count(*) FROM public.notifications WHERE payload->>'message_id'='${M}';`)}`),'0');
    for(const action of deny)assert.equal(await tx(`${auth(U(1),insert())} ${action} ${auth(U(2),`SELECT count(*) FROM public.notifications WHERE payload->>'message_id'='${M}';`)}`),'0');
    await bad(`SET LOCAL ROLE anon; SELECT public.message_notification_visible('${M}');`,'permission denied');
    await bad(auth(U(2),`SELECT private.message_notification_visible_to('${M}','${U(3)}');`),'permission denied');
  });
  await delivery();
  await check('bot restricted entity-only addressing, full/legacy/reply branches and deletion failclosed',async()=>{
    const botData=envelope([entity('bot',B,0,5,'@User')]);
    assert.equal(await tx(`${auth(U(1),insert('ordinary'))} SELECT private.bot_can_receive_message('${B}','${M}')||':'||private.bot_can_receive_message('${F}','${M}');`),'false:true');
    assert.equal(await tx(`${auth(U(1),insert('@User',botData))} SELECT private.bot_can_receive_message('${B}','${M}');`),'t');
    assert.equal(await tx(`${auth(U(1),insert('@User'))} ${auth(U(1),`UPDATE public.messages SET mention_entities=${quote(botData)}::jsonb WHERE id='${M}';`)} SELECT count(*) FROM private.bot_updates WHERE bot_id='${B}' AND update_type='edited_message' AND payload#>>'{message,id}'='${M}';`),'1');
    for(const text of ['/go@d331_restricted','@d331_restricted'])assert.equal(await tx(`${auth(U(1),insert(text))} SELECT private.bot_can_receive_message('${B}','${M}');`),'t');
    assert.equal(await tx(`${auth(U(1),insert('@User',botData))} UPDATE public.messages SET deleted_at=now() WHERE id='${M}'; SELECT private.bot_update_still_visible('${F}','message',jsonb_build_object('message',jsonb_build_object('id','${M}','chat_id','${C}')))||':'||(SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='${M}');`),'false:0');
    for(const mode of ['full','private','own','reply']) {
      const setup=mode==='full'?`UPDATE public.chat_bot_members SET privacy_mode='full' WHERE bot_id='${B}' AND chat_id='${C}';`:mode==='private'?`INSERT INTO public.chats(id,type,name,created_by) VALUES('20000000-0000-4000-8000-000000000003','private','D331 bot private','${U(1)}'); INSERT INTO public.chat_bot_members(chat_id,bot_id,privacy_mode,joined_at) VALUES('20000000-0000-4000-8000-000000000003','${B}','restricted',clock_timestamp()-interval '1 hour');`:mode==='reply'?`INSERT INTO public.messages(id,chat_id,bot_id,content) VALUES('50000000-0000-4000-8000-000000000002','${C}','${B}','synthetic reply source');`:'';
      const message=mode==='own'?`INSERT INTO public.messages(id,chat_id,bot_id,content) VALUES('${M}','${C}','${B}','synthetic own');`:auth(U(1),(mode==='private'?`INSERT INTO public.messages(id,chat_id,user_id,content) VALUES('${M}','20000000-0000-4000-8000-000000000003','${U(1)}','ordinary');`:insert('ordinary'))+(mode==='reply'?`UPDATE public.messages SET reply_to_id='50000000-0000-4000-8000-000000000002' WHERE id='${M}';`:''));
      assert.equal(await tx(`${setup} ${message} SELECT private.bot_can_receive_message('${B}','${M}');`),'t',mode);
      assert.equal(await tx(`${setup} ${message} UPDATE public.messages SET deleted_at=now() WHERE id='${M}'; SELECT private.bot_can_receive_message('${B}','${M}');`),'f',mode+' deletion');
    }
    for(const action of [`UPDATE public.chat_bot_members SET removed_at=now() WHERE bot_id='${F}' AND chat_id='${C}';`,`UPDATE public.chat_bot_members SET joined_at=clock_timestamp()+interval '1 second' WHERE bot_id='${F}' AND chat_id='${C}';`])assert.equal(await tx(`${auth(U(1),insert('ordinary'))} ${action} SELECT private.bot_can_receive_message('${F}','${M}');`),'f');
  });
  await check('report-retained deleted metadata cannot resurrect; ordinary marker scrubbed',async()=>{
    const setup=`${auth(U(1),insert('@User',data))} INSERT INTO public.content_reports(reporter_id,kind,target_user_id,message_id,chat_id,reason) VALUES('${U(2)}','message','${U(1)}','${M}','${C}','other'); UPDATE public.messages SET deleted_at=now() WHERE id='${M}';`;
    assert.equal(await tx(`${setup} SELECT (content='@User')||':'||jsonb_array_length(mention_entities->'items')||':'||(SELECT count(*) FROM public.notifications WHERE payload->>'message_id'='${M}' AND payload->>'mentioned'='true') FROM public.messages WHERE id='${M}';`),'true:0:0');
    assert.equal(await tx(`${setup} UPDATE public.messages SET deleted_at=null,content='@User',mention_entities=${quote(data)}::jsonb WHERE id='${M}'; SELECT (deleted_at IS NOT NULL)||':'||jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='${M}';`),'true:0');
  });
  await botDispatch();
}

async function delivery() {
  await check('web/native predelivery rejects changed preferences/source; preview whitelist without entity export',async()=>{
    for(const fn of ['push_outbox_delivery_recheck','native_push_outbox_delivery_recheck']) {
      const table=fn.startsWith('native')?'notifications_native_push_outbox':'notifications_push_outbox';
      const claim='70000000-0000-4000-8000-000000000001';
      const actions=sourceActions();
      const setup=`${auth(U(1),insert())} UPDATE public.${table} SET claim_token='${claim}',claimed_until=clock_timestamp()+interval '5 minutes' WHERE user_id='${U(2)}' AND notification_id IN (SELECT id FROM public.notifications WHERE payload->>'message_id'='${M}');`;
      assert.equal(await tx(`${setup} SELECT public.${fn}(id,'${claim}') FROM public.${table} WHERE user_id='${U(2)}' AND notification_id IN(SELECT id FROM public.notifications WHERE payload->>'message_id'='${M}');`),'deliver');
      for(const action of actions)assert.equal(await tx(`${setup} ${action} SELECT public.${fn}(id,'${claim}') FROM public.${table} WHERE user_id='${U(2)}' AND notification_id IN(SELECT id FROM public.notifications WHERE payload->>'message_id'='${M}');`),'not_eligible');
      assert.equal(await tx(`${setup} SELECT set_config('d331.outbox',(SELECT id::text FROM public.${table} WHERE user_id='${U(2)}' AND notification_id IN(SELECT id FROM public.notifications WHERE payload->>'message_id'='${M}')),true) IS NOT NULL; SET LOCAL ROLE service_role; SELECT public.${fn}(current_setting('d331.outbox')::uuid,'${claim}'); RESET ROLE;`),'t\ndeliver');
      const target=fn.startsWith('native')?'user_push_devices':'push_subscriptions';
      assert.equal(await tx(`${setup} UPDATE public.${target} SET user_id='${U(3)}' WHERE user_id='${U(2)}'; SELECT public.${fn}(id,'${claim}') FROM public.${table} WHERE user_id='${U(2)}' AND notification_id IN(SELECT id FROM public.notifications WHERE payload->>'message_id'='${M}');`),fn.startsWith('native')?'device_inactive':'subscription_inactive');
      assert.equal(await tx(`${setup} UPDATE public.notifications SET read_at=now() WHERE payload->>'message_id'='${M}'; SELECT public.${fn}(id,'${claim}') FROM public.${table} WHERE user_id='${U(2)}' AND notification_id IN(SELECT id FROM public.notifications WHERE payload->>'message_id'='${M}');`),'read');
    }
    await payloadCompatibility();
  });
  await albumDelivery();
}

async function payloadCompatibility() {
  const input={chat_type:'group',chat_name:'Fixture group',chat_id:C,message_id:M,
    sender_kind:'user',sender_id:U(1),sender_name:'Fixture sender',
    sender_avatar_url:'https://app.letscube.ru/fixture-avatar.png',message_type:'text',preview:'Hello @User',
    mentioned:true,mention_entities:JSON.parse(envelope([entity('user',U(2),6,5,'@User')])),
    items:[{user_id:U(2)}],user_ids:[U(2)],recipient_ids:[U(2)]};
  for(const chat_type of ['group','private']) {
    const payload={...input,chat_type};
    const output=JSON.parse(await tx(`SELECT public._notification_push_payload('message',${quote(JSON.stringify(payload))}::jsonb);`));
    assert.equal(output.title,chat_type==='private'?'Fixture sender':'Fixture group','existing sender/chat title');
    assert.equal(output.body,chat_type==='private'?'Hello @User':'Fixture sender: Hello @User','existing message preview');
    assert.deepEqual(Object.keys(output).sort(),['title','body','url','tag','kind','chatId','messageId','chat_id','message_id','sender_kind','sender_id','bot_id','sender_name','sender_avatar_url','message_type','preview','route','group_tag'].sort(),'existing explicit payload whitelist');
    const route=`/?chat=${C}&message=${M}`;
    assert.deepEqual(output,{title:chat_type==='private'?'Fixture sender':'Fixture group',
      body:chat_type==='private'?'Hello @User':'Fixture sender: Hello @User',url:route,route,
      tag:`message:chat:${C}`,group_tag:`message:chat:${C}`,kind:'message',chatId:C,messageId:M,
      chat_id:C,message_id:M,sender_kind:'user',sender_id:U(1),bot_id:null,sender_name:'Fixture sender',
      sender_avatar_url:input.sender_avatar_url,message_type:'text',preview:'Hello @User'});
    assert.ok(!JSON.stringify(output).includes(U(2)),'target human UUID must never enter external metadata');
    assert.ok(Object.values(output).every(value=>!Array.isArray(value)),'no entity or recipient arrays');
  }
  assert.equal(await tx(`${auth(U(1),insert('@User',envelope([entity('user',U(2),0,5,'@User')])))} SELECT (payload->>'mentioned')||':'||(public._notification_push_payload(kind,payload) ?| ARRAY['mentioned','mention_entities','items','user_ids','recipient_ids']) FROM public.notifications WHERE user_id='${U(2)}' AND payload->>'message_id'='${M}';`),'true:false','actual recipient row marker remains internal');
  console.log('PAYLOAD private=Fixture sender/Hello @User; group=Fixture group/Fixture sender: Hello @User; exact 18-key whitelist; entity/recipient/mentioned export=0');
}

function sourceActions() {return [
  `INSERT INTO public.chat_notification_preferences(chat_id,user_id,push_enabled) VALUES('${C}','${U(2)}',false);`,
  `UPDATE public.notification_preferences SET push_enabled=false WHERE user_id='${U(2)}';`,
  `INSERT INTO public.user_blocks VALUES('${U(2)}','${U(1)}',now());`,
  `UPDATE public.chat_members SET joined_at=clock_timestamp()+interval '1 second' WHERE chat_id='${C}' AND user_id='${U(2)}';`,
  `UPDATE public.chat_members SET hidden_at=now() WHERE chat_id='${C}' AND user_id='${U(2)}';`,
  `UPDATE public.chat_members SET cleared_at=clock_timestamp()+interval '1 second' WHERE chat_id='${C}' AND user_id='${U(2)}';`,
  `INSERT INTO public.message_hidden_for_users(message_id,user_id) VALUES('${M}','${U(2)}');`,
  `INSERT INTO public.bans(user_id,reason) VALUES('${U(2)}','isolated D331');`,
  `DELETE FROM public.chat_members WHERE chat_id='${C}' AND user_id='${U(2)}';`
];}
async function albumDelivery() {
  await check('actual album web/device recheck current source/preferences and owner/read gates',async()=>{
    const claim='70000000-0000-4000-8000-000000000001';
    const setup=`UPDATE public.album_push_runtime SET enabled=true WHERE singleton; ${auth(U(1),`INSERT INTO public.messages(id,chat_id,user_id,type,content,media_url,media_metadata) VALUES('${M}','${C}','${U(1)}','image','synthetic caption','https://invalid.example/d331-image', '{"album_id":"d331-isolated-album","album_count":2,"album_index":0}');`)} UPDATE public.notifications_album_push_outbox SET claim_token='${claim}',claimed_until=clock_timestamp()+interval '5 minutes' WHERE group_id IN(SELECT id FROM public.album_push_groups WHERE chat_id='${C}' AND user_id='${U(2)}');`;
    const call=`SELECT r.status FROM public.notifications_album_push_outbox o CROSS JOIN LATERAL public.album_push_recheck(o.id,'${claim}') r WHERE o.group_id IN(SELECT id FROM public.album_push_groups WHERE chat_id='${C}' AND user_id='${U(2)}') ORDER BY o.id;`;
    assert.equal(await tx(setup+call),'deliver\ndeliver');
    for(const action of sourceActions())assert.equal(await tx(setup+action+call),'not_eligible\nnot_eligible');
    assert.equal(await tx(setup+`UPDATE public.push_subscriptions SET user_id='${U(3)}' WHERE user_id='${U(2)}'; UPDATE public.user_push_devices SET user_id='${U(3)}' WHERE user_id='${U(2)}';`+call),'target_inactive\ntarget_inactive');
    assert.equal(await tx(setup+`UPDATE public.notifications SET read_at=now() WHERE payload->>'message_id'='${M}';`+call),'read\nread');
    assert.equal(await tx(setup+`UPDATE public.messages SET deleted_at=now() WHERE id='${M}';`+call),'not_eligible\nnot_eligible');
  });
}
async function botDispatch() {
  await check('actual full bot polling and webhook prepare reject pending deleted source',async()=>{
    const marker='70000000-0000-4000-8000-000000000001';
    const poll=`SET LOCAL ROLE service_role; SELECT count(*) FROM public.bot_updates_poll_internal('${F}',0,100,ARRAY['message'],'${marker}') WHERE payload#>>'{message,id}'='${M}'; RESET ROLE;`;
    assert.equal(await tx(auth(U(1),insert('ordinary'))+poll),'1');
    assert.equal(await tx(auth(U(1),insert('ordinary'))+`UPDATE public.messages SET deleted_at=now() WHERE id='${M}';`+poll),'0');
    const webhook=`INSERT INTO private.bot_webhooks(bot_id,target_url,secret_ciphertext,secret_fingerprint) VALUES('${F}','https://invalid.example/d331-webhook','enc:v1:'||repeat('A',55),repeat('0',16)); ${auth(U(1),insert('ordinary'))} INSERT INTO private.bot_delivery_attempts(bot_id,update_id,status,claim_token,claimed_at,webhook_epoch) SELECT '${F}',update_id,'claimed','${marker}',now(),1 FROM private.bot_updates WHERE bot_id='${F}' AND update_type='message' AND payload#>>'{message,id}'='${M}' ON CONFLICT(bot_id,update_id) DO UPDATE SET status='claimed',claim_token='${marker}',claimed_at=now(),webhook_epoch=1; SELECT set_config('d331.attempt',(SELECT a.id::text FROM private.bot_delivery_attempts a JOIN private.bot_updates u ON u.bot_id=a.bot_id AND u.update_id=a.update_id WHERE a.bot_id='${F}' AND u.payload#>>'{message,id}'='${M}'),true) IS NOT NULL;`;
    const prepare=`SET LOCAL ROLE service_role; SELECT public.bot_delivery_prepare_internal(current_setting('d331.attempt')::bigint,'${marker}',1) IS NOT NULL; RESET ROLE;`;
    assert.equal(await tx(webhook+prepare),'t\nt');
    assert.equal(await tx(webhook+`UPDATE public.messages SET deleted_at=now() WHERE id='${M}';`+prepare),'t\nf');
  });
}

async function simultaneousAdmission() {
  await check('two real connections serialize member removal versus authenticated admission',async()=>{
    const writer=command(['docker','exec','-i',id,'psql','-X','-qAt','-h','/tmp','-U','supabase_admin','-d','mentions_qa','-v','ON_ERROR_STOP=1'],null,90000);
    const ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('membership lock barrier timeout')),15000);
      writer.child.stdout.on('data',c=>{if(String(c).includes('D331_LOCK_HELD')){clearTimeout(timer);resolve();}});
      writer.done.then(r=>{if(r.code!==0){clearTimeout(timer);reject(new Error('membership lock holder failed'));}});
    });
    let search;
    try {
      writer.child.stdin.write(`BEGIN; SET LOCAL application_name='${name}-remove'; DELETE FROM public.chat_members WHERE chat_id='${C}' AND user_id='${U(2)}';\n\\echo D331_LOCK_HELD\n`);
      await ready;
      search=sql(`BEGIN; SET LOCAL application_name='${name}-admit'; SET LOCAL lock_timeout='30s'; ${auth(U(1),insert('@User',envelope([entity('user',U(2),0,5,'@User')])))} SELECT jsonb_array_length(mention_entities->'items')||':'||(SELECT count(*) FROM public.notifications WHERE user_id='${U(2)}' AND payload->>'message_id'='${M}') FROM public.messages WHERE id='${M}'; ROLLBACK;`);
      let waiting=false;
      for(let attempt=0;attempt<15;attempt++) {
        if(await q(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='mentions_qa' AND application_name='${name}-admit' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0);`)==='t'){waiting=true;break;}
      }
      assert.ok(waiting,'actual admission backend must wait on the other transaction');
      writer.child.stdin.end('COMMIT;\n');
      assert.equal((await writer.done).code,0);
      const result=await search;assert.equal(result.code,0,result.stderr);assert.equal(result.stdout,'0:0');
      console.log('SIMULTANEOUS backend wait_event_type=Lock blocking_pids>0; removal committed; admitted items=0 notifications=0');
    } finally {
      if(!writer.child.stdin.destroyed)writer.child.stdin.end('ROLLBACK;\n');
      await writer.done;
      if(search)await search;
      await q(`INSERT INTO public.chat_members(chat_id,user_id,role,joined_at) VALUES('${C}','${U(2)}','member',clock_timestamp()-interval '1 hour') ON CONFLICT(chat_id,user_id) DO NOTHING;`);
    }
  });
}

try {
  assert.ok(process.argv.slice(2).every(a=>['--red','--mutations','--payload-only'].includes(a)));
  assert.ok(!(red&&mutations),'choose RED baseline or current migration mutations');
  assert.ok(!payloadOnly||(!red&&!mutations),'payload-only must run alone');
  for(const url of [migrationURL,rollbackURL]) {
    const source=await readFile(url);
    assert.deepEqual(source,await readFile(new URL('.migration-backup/'+url.href.slice(root.href.length),root)));
    transactionCheck(source.toString('utf8'));
    console.log('ARTIFACT '+fileURLToPath(url).split(/[\\/]/).at(-1)+' SHA256='+createHash('sha256').update(source).digest('hex'));
  }
  const unicode=spawn(process.execPath,['--test',fileURLToPath(new URL('./unicode.test.mjs',import.meta.url))],{stdio:'inherit'});
  assert.equal(await new Promise((resolve,reject)=>{unicode.on('error',reject);unicode.on('close',resolve);}),0);
  await create();
  const before=await catalog();
  if(red)await redCases();
  else {
    const migration=await readFile(migrationURL,'utf8'),rollback=await readFile(rollbackURL,'utf8');
    transactionCheck(migration);transactionCheck(rollback);
    assert.throws(()=>transactionCheck(migration+'\nROLLBACK;'));
    await q(migration);
    if(payloadOnly) {
      await payloadCompatibility();
      console.log('PASS payload-only compatibility');
    } else {
    await behavior();
    await simultaneousAdmission();
    if(mutations) {
      const api={q,sql,tx,bad,auth,insert,envelope,entity,quote,U,C,B,F,M,R,catalog,payloadCompatibility,kill:()=>mutantKills++};
      await functionMutations(api);await guardMutations(api,migration,rollback,before);
    }
    await q(rollback);assert.deepEqual(await catalog(),before,'rollback exact function/owner/ACL/trigger/policy/index parity');
    assert.equal(await q("SELECT attnotnull FROM pg_attribute WHERE attrelid='public.messages'::regclass AND attname='mention_entities' AND NOT attisdropped;"),'t');
    console.log('PASS rollback exact catalog parity; metadata column retained intentionally');
    await q(migration);console.log('PASS reapply after retention rollback');
    console.log(`PASS SUMMARY groups=${checks+2} behavioral/guard mutant kills=${mutantKills} SQL calls=${statements} skips=0`);
    }
  }
} catch(e) {console.error('FAIL '+e.message);process.exitCode=1;}
finally {if(id){await owned();await docker(['rm','-f',id]);console.log('CLEANUP exact owned container removed');}}
