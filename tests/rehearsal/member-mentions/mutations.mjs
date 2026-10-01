import assert from 'node:assert/strict';

function replaceOnce(source,old,value) {
  assert.equal(source.split(old).length,2,'mutation anchor must be unique');
  return source.replace(old,value);
}

export async function functionMutations(api) {
  const {q,tx,bad,auth,insert,envelope,entity,quote,U,C,B,F,M,R}=api;
  const data=envelope([entity('user',U(2),0,5,'@User')]);
  const scalar=" SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='"+M+"';";
  const eligible=(who=U(2))=>" SELECT private.message_notification_visible_to('"+M+"','"+who+"');";
  const notes=" FROM public.notifications WHERE user_id='"+U(2)+"' AND payload->>'message_id'='"+M+"';";
  const update="UPDATE public.messages SET content='plain' WHERE id='"+M+"';";
  const simple=(sig,old,value,probe)=>({changes:[[sig,old,value]],probe});
  const items=Array.from({length:33},(_,i)=>entity('user',U(2),i*3,2,'@U'));
  const cases=[
    ['32 entities',simple('private.validate_message_mentions(text,jsonb)',"jsonb_array_length(p_data->'items') > 32","jsonb_array_length(p_data->'items') > 33",()=>bad(auth(U(1),insert(Array(33).fill('@U').join(' '),envelope(items)))))],
    ['128 label units',{changes:[['private.validate_message_mentions(text,jsonb)',"(item->>'length')::numeric > 128","(item->>'length')::numeric > 129"],['private.mention_label_valid(text)','private.mention_utf16_length(p_label)>128','private.mention_utf16_length(p_label)>129']],probe:()=>{const label='@'+'x'.repeat(128);return bad(auth(U(1),insert(label,envelope([entity('user',U(2),0,129,label)]))));}}],
    ['UTF16 scalar boundaries',simple('private.mention_utf16_slice(text,integer,integer)','THEN 2 ELSE 1','THEN 1 ELSE 1',async()=>assert.equal(await tx(auth(U(1),insert('\u{1f600} @User',envelope([entity('user',U(2),3,5,'@User')])))),'') )],
    ['visible label',simple('private.mention_label_valid(text)','RETURN visible;','RETURN true;',()=>bad(auth(U(1),insert('@',envelope([entity('user',U(2),0,1,'@')])))))],
    ['tilde mask',simple('private.mention_context_masked(text,integer,integer)','('+String.fromCharCode(96)+'{3,}|~{3,})','('+String.fromCharCode(96)+'{3,})',async()=>assert.equal(await tx(auth(U(1),insert('~~~\n@User\n~~~',envelope([entity('user',U(2),4,5,'@User')])))+scalar),'0'))],
    ['legacy edit',simple('private.normalize_message_mentions()','IF new.content IS DISTINCT FROM old.content AND','IF false AND',async()=>assert.equal(await tx(auth(U(1),insert('@User',data)+update)+scalar),'0'))],
    ['historical entity',simple('private.normalize_message_mentions()','WHERE private.mention_historical_item(old.content,new.content,previous,item)','WHERE false',async()=>{
      const fresh=envelope([entity('user',U(2),0,5,'@User')],'60000000-0000-4000-8000-000000000002');
      assert.equal(await tx(auth(U(1),insert('@User',data))+"DELETE FROM public.chat_members WHERE chat_id='"+C+"' AND user_id='"+U(2)+"';"+auth(U(1),"UPDATE public.messages SET content='@User suffix',mention_entities="+quote(fresh)+"::jsonb WHERE id='"+M+"';")+scalar),'1');
    })],
    ['forward identity drop',simple('private.normalize_message_mentions()','IF new.deleted_at IS NOT NULL OR new.forwarded_from_id IS NOT NULL THEN','IF new.deleted_at IS NOT NULL THEN',async()=>{
      const write="INSERT INTO public.messages(chat_id,user_id,content,forwarded_from_id,mention_entities) VALUES('"+C+"','"+U(1)+"','@User','"+M+"',"+quote(data)+"::jsonb);";
      assert.equal(await tx(auth(U(1),insert('@User',data)+write)+"SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE forwarded_from_id='"+M+"';"),'0');
    })],
    ['recipient block',simple('private.message_notification_visible_to(uuid,uuid)','AND NOT EXISTS(SELECT 1 FROM public.user_blocks b WHERE b.blocker_id=p_recipient_id AND b.blocked_id=m.user_id)','AND true',async()=>{
      assert.equal(await tx("INSERT INTO public.user_blocks VALUES('"+U(2)+"','"+U(1)+"',now());"+auth(U(1),insert())+"SELECT count(*)"+notes),'0');
    })],
    ['membership epoch',simple('private.message_notification_visible_to(uuid,uuid)','m.created_at >= cm.joined_at','true',async()=>assert.equal(await tx(auth(U(1),insert())+"UPDATE public.chat_members SET joined_at=clock_timestamp()+interval '1 second' WHERE chat_id='"+C+"' AND user_id='"+U(2)+"';"+eligible()),'f'))],
    ['ban',simple('private.message_notification_visible_to(uuid,uuid)','NOT public.is_banned(p_recipient_id)','true',async()=>assert.equal(await tx(auth(U(1),insert())+"INSERT INTO public.bans(user_id,reason) VALUES('"+U(2)+"','isolated D331');"+eligible()),'f'))],
    ['self exclusion',simple('private.message_notification_visible_to(uuid,uuid)','m.user_id IS DISTINCT FROM p_recipient_id','true',async()=>assert.equal(await tx(auth(U(1),insert())+eligible(U(1))),'f'))],
    ['recipient-only marker',simple('public.enqueue_message_notifications()',"private.message_mentions_targeted(new.mention_entities, 'user', member_row.user_id)",'true',async()=>assert.equal(await tx(auth(U(1),insert('@User',data))+"SELECT count(*) FROM public.notifications WHERE payload->>'message_id'='"+M+"' AND payload->>'mentioned'='true';"),'1'))],
    ['edit read preservation',simple('private.update_message_mention_notification()','SET payload=n.payload','SET read_at=NULL,payload=n.payload',async()=>assert.equal(await tx(auth(U(1),insert('@User',data))+"UPDATE public.notifications SET read_at=now() WHERE payload->>'message_id'='"+M+"';"+auth(U(1),update)+"SELECT count(*) FROM public.notifications WHERE payload->>'message_id'='"+M+"' AND read_at IS NOT NULL;"),'2'))],
    ['push preferences',simple('public._notification_push_allowed(uuid,text,jsonb)','if coalesce(v_prefs.push_enabled, false) is not true then','if false then',async()=>assert.equal(await tx(auth(U(1),insert())+"UPDATE public.notification_preferences SET push_enabled=false WHERE user_id='"+U(2)+"'; SELECT public._notification_push_allowed(user_id,kind,payload)"+notes),'f'))],
    ['current push source',simple('public._notification_push_allowed(uuid,text,jsonb)',"not private.message_notification_visible_to((p_payload->>'message_id')::uuid, p_user_id)",'false',async()=>assert.equal(await tx(auth(U(1),insert())+"INSERT INTO public.user_blocks VALUES('"+U(2)+"','"+U(1)+"',now());SELECT public._notification_push_allowed(user_id,kind,payload)"+notes),'f'))],
    ['full bot independent',simple('private.bot_can_receive_message(uuid,uuid)',"or member_row.privacy_mode = 'full'",'or false',async()=>assert.equal(await tx(auth(U(1),insert('ordinary'))+"SELECT private.bot_can_receive_message('"+F+"','"+M+"');"),'t'))],
    ['pending bot source deletion',simple('private.bot_can_receive_message(uuid,uuid)','and message_row.deleted_at is null','and true',async()=>assert.equal(await tx(auth(U(1),insert('ordinary'))+"UPDATE public.messages SET deleted_at=now() WHERE id='"+M+"';SELECT count(*) FROM public.bot_updates_poll_internal('"+F+"',0,100,ARRAY['message'],'70000000-0000-4000-8000-000000000001') WHERE payload#>>'{message,id}'='"+M+"';"),'0'))],
    ['push entity array whitelist',simple('public._notification_push_payload(text,jsonb)','return pg_catalog.jsonb_build_object(', 'return p_payload || pg_catalog.jsonb_build_object(',api.payloadCompatibility)],
    ['push recipient marker whitelist',simple('public._notification_push_payload(text,jsonb)',"'group_tag', v_tag", "'mentioned', p_payload->'mentioned', 'group_tag', v_tag",api.payloadCompatibility)]
  ];
  for(const [label,mutation] of cases) {
    const original=[];
    try {
      for(const [sig,old,value] of mutation.changes) {
        const ddl=await q("SELECT pg_get_functiondef('"+sig+"'::regprocedure);");
        original.push(ddl);await q(replaceOnce(ddl,old,value));
      }
      let killed=false;try{await mutation.probe();}catch(e){assert.equal(e.code,'ERR_ASSERTION');killed=true;}
      assert.ok(killed,'surviving behavioral mutation: '+label);api.kill();console.log('KILLED behavior '+label);
    } finally {for(const ddl of original)await q(ddl);}
  }
}

export async function guardMutations(api,migration,rollback,before) {
  const {q,sql,catalog}=api;
  const applied=await catalog();
  const reversals=[
    ['restored security',"ALTER FUNCTION public._notification_push_allowed(uuid,text,jsonb) SECURITY DEFINER;"],
    ['restored body',"DO $m$ BEGIN EXECUTE replace(pg_get_functiondef('public._notification_push_payload(text,jsonb)'::regprocedure),'begin','begin'||chr(10)||'-- mutant'); END $m$;"],
    ['helper absence',"CREATE FUNCTION private.mention_label_valid(text) RETURNS boolean LANGUAGE sql AS 'SELECT true';"]
  ];
  for(const [label,change] of reversals) {
    const result=await sql(rollback.replace('DO $rollback_check$',change+'\nDO $rollback_check$'));
    assert.notEqual(result.code,0);assert.match(result.stderr,/mentions_prestate_drift|mentions_rollback_incomplete/);
    assert.deepEqual(await catalog(),applied);api.kill();console.log('KILLED rollback '+label+'; transaction rolled back');
  }
  await q(rollback);assert.deepEqual(await catalog(),before);
  const changes=[
    ['column NOT NULL',"ALTER TABLE public.messages ALTER COLUMN mention_entities DROP NOT NULL;"],
    ['helper security',"ALTER FUNCTION private.validate_message_mentions(text,jsonb) SECURITY DEFINER;"],
    ['helper path',"ALTER FUNCTION private.validate_message_mentions(text,jsonb) SET search_path=public;"],
    ['helper PUBLIC grant',"GRANT EXECUTE ON FUNCTION private.validate_message_mentions(text,jsonb) TO PUBLIC;"],
    ['helper owner',"ALTER FUNCTION private.validate_message_mentions(text,jsonb) OWNER TO supabase_admin;"],
    ['helper volatility',"ALTER FUNCTION private.validate_message_mentions(text,jsonb) VOLATILE;"],
    ['trigger active',"ALTER TABLE public.messages DISABLE TRIGGER trg_member_mentions_validate;"],
    ['restrictive policy', 'DROP POLICY "message notification source remains readable" ON public.notifications; CREATE POLICY "message notification source remains readable" ON public.notifications FOR SELECT TO authenticated USING(public.message_notification_visible((payload->>\'message_id\')::uuid));'],
    ['unique row',"DROP INDEX public.notifications_message_user_once_idx;"]
  ];
  for(const [label,change] of changes) {
    const result=await sql(migration.replace('DO $poststate$',change+'\nDO $poststate$'));
    assert.notEqual(result.code,0);assert.match(result.stderr,/mentions_.*incomplete/);
    assert.deepEqual(await catalog(),before);assert.equal(await q("SELECT to_regprocedure('private.normalize_message_mentions()') IS NULL;"),'t');
    api.kill();console.log('KILLED selfcheck '+label+'; transaction rolled back');
  }
  await q(migration);
}
