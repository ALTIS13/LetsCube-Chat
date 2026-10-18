-- Retained-data rollback: same CAS with true -> false; no preference/fence/terminal writes.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SET LOCAL ROLE postgres;
LOCK TABLE private.topic_notification_runtime,private.web_message_preview_runtime,public.album_push_runtime IN SHARE ROW EXCLUSIVE MODE;
DO $activation$
DECLARE before jsonb; after jsonb; affected integer;
BEGIN
 before := jsonb_build_object('target',jsonb_build_object('cluster',(SELECT system_identifier::text FROM pg_control_system()),
 'database',current_database(),'database_oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
 'version',current_setting('server_version'),'started',pg_postmaster_start_time(),
 'port',current_setting('port'),'socket',current_setting('unix_socket_directories'),'unix',inet_server_addr() IS NULL),'schema',encode(sha256(convert_to((jsonb_build_object(
 'namespaces',(SELECT jsonb_agg(jsonb_build_array(oid,nspname,nspowner,nspacl::text) ORDER BY oid) FROM pg_namespace n WHERE n.nspname IN ('public','private')),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relkind,c.relnamespace,c.relpersistence,c.relreplident) ORDER BY c.oid)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a
   JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND a.attnum>0),
 'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_attrdef d
   JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_constraint k
   JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname IN ('public','private')),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(i.indexrelid,pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid)
   FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private'))))::text,'UTF8')),'hex'),'catalog',encode(sha256(convert_to((jsonb_build_object(
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text) ORDER BY c.oid)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p
   JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t
   JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl::text,pg_get_functiondef(p.oid)) ORDER BY p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p')),
 'publications',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_publication p),
 'publicationRelations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_publication_rel p),
 'roles',(SELECT jsonb_agg(jsonb_build_array(oid,rolname,rolsuper,rolinherit,rolcanlogin,rolbypassrls,rolconfig) ORDER BY oid)
   FROM pg_roles WHERE rolname IN ('postgres','supabase_admin','service_role','authenticator','anon','authenticated')),
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor) FROM pg_auth_members m)))::text,'UTF8')),'hex'),
 'topic',(SELECT jsonb_agg(to_jsonb(r) ORDER BY singleton) FROM private.topic_notification_runtime r),
 'web',(SELECT jsonb_agg(to_jsonb(r) ORDER BY singleton) FROM private.web_message_preview_runtime r),
 'album',(SELECT jsonb_agg(to_jsonb(r) ORDER BY singleton) FROM public.album_push_runtime r),
 'rlsMissing',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity),
 'privateRlsMissing',(SELECT count(*) FROM pg_class WHERE oid IN ('private.topic_notification_runtime'::regclass,
   'private.notification_feed_fences_v2'::regclass,'private.web_message_preview_runtime'::regclass,
   'private.web_message_preview_install_admissions'::regclass,'private.web_message_preview_grants'::regclass) AND NOT relrowsecurity),
 'protocol',(SELECT atttypid='int2'::regtype AND attnotnull FROM pg_attribute
   WHERE attrelid='public.push_subscriptions'::regclass AND attname='web_push_protocol' AND NOT attisdropped));
 IF before->'target' IS DISTINCT FROM '{"port":"5432","unix":true,"socket":"/var/run/postgresql","cluster":"7652726644035760163","started":"2026-08-20T14:16:20.607503+00:00","version":"17.6","database":"postgres","database_oid":"5"}'::jsonb
   OR before->>'schema' IS DISTINCT FROM '445bf97971d05b9c9286b5d9e4704c2decf8236ed48eed6114ca8f376f9ed530'
   OR before->>'catalog' IS DISTINCT FROM 'f5933dfc63473744e1a3ec2af363e064af62511411c54468f1ae22b2ab94fef2'
   OR before->'topic' IS DISTINCT FROM '[{"singleton":true,"enabled":true}]'::jsonb
   OR before->'web' IS DISTINCT FROM '[{"enabled":true,"singleton":true}]'::jsonb
   OR before->'album' IS DISTINCT FROM '[{"enabled":true,"singleton":true,"activated_at":"2026-09-26T09:47:41.193265+00:00","legacy_wns_enabled":false}]'::jsonb
   OR before->>'rlsMissing' IS DISTINCT FROM '0' OR before->>'privateRlsMissing' IS DISTINCT FROM '0'
   OR before->>'protocol' IS DISTINCT FROM 'true'
   OR extract(epoch FROM clock_timestamp()) < 1792349776
   OR extract(epoch FROM clock_timestamp()) - 1792349776 >= 900
 THEN RAISE EXCEPTION 'topic_activation_prestate_or_backup_drift'; END IF;
 UPDATE private.topic_notification_runtime SET enabled=false
 WHERE singleton IS TRUE AND enabled IS true;
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'topic_activation_cas_refused'; END IF;
 after := jsonb_build_object('target',jsonb_build_object('cluster',(SELECT system_identifier::text FROM pg_control_system()),
 'database',current_database(),'database_oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
 'version',current_setting('server_version'),'started',pg_postmaster_start_time(),
 'port',current_setting('port'),'socket',current_setting('unix_socket_directories'),'unix',inet_server_addr() IS NULL),'schema',encode(sha256(convert_to((jsonb_build_object(
 'namespaces',(SELECT jsonb_agg(jsonb_build_array(oid,nspname,nspowner,nspacl::text) ORDER BY oid) FROM pg_namespace n WHERE n.nspname IN ('public','private')),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relkind,c.relnamespace,c.relpersistence,c.relreplident) ORDER BY c.oid)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a
   JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND a.attnum>0),
 'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_attrdef d
   JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_constraint k
   JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname IN ('public','private')),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(i.indexrelid,pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid)
   FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private'))))::text,'UTF8')),'hex'),'catalog',encode(sha256(convert_to((jsonb_build_object(
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text) ORDER BY c.oid)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p
   JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t
   JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl::text,pg_get_functiondef(p.oid)) ORDER BY p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p')),
 'publications',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_publication p),
 'publicationRelations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_publication_rel p),
 'roles',(SELECT jsonb_agg(jsonb_build_array(oid,rolname,rolsuper,rolinherit,rolcanlogin,rolbypassrls,rolconfig) ORDER BY oid)
   FROM pg_roles WHERE rolname IN ('postgres','supabase_admin','service_role','authenticator','anon','authenticated')),
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor) FROM pg_auth_members m)))::text,'UTF8')),'hex'),
 'topic',(SELECT jsonb_agg(to_jsonb(r) ORDER BY singleton) FROM private.topic_notification_runtime r),
 'web',(SELECT jsonb_agg(to_jsonb(r) ORDER BY singleton) FROM private.web_message_preview_runtime r),
 'album',(SELECT jsonb_agg(to_jsonb(r) ORDER BY singleton) FROM public.album_push_runtime r),
 'rlsMissing',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity),
 'privateRlsMissing',(SELECT count(*) FROM pg_class WHERE oid IN ('private.topic_notification_runtime'::regclass,
   'private.notification_feed_fences_v2'::regclass,'private.web_message_preview_runtime'::regclass,
   'private.web_message_preview_install_admissions'::regclass,'private.web_message_preview_grants'::regclass) AND NOT relrowsecurity),
 'protocol',(SELECT atttypid='int2'::regtype AND attnotnull FROM pg_attribute
   WHERE attrelid='public.push_subscriptions'::regclass AND attname='web_push_protocol' AND NOT attisdropped));
 IF (after-'topic') IS DISTINCT FROM (before-'topic')
   OR after->'topic' IS DISTINCT FROM '[{"singleton":true,"enabled":false}]'::jsonb
 THEN RAISE EXCEPTION 'topic_activation_poststate_drift'; END IF;
END $activation$;
COMMIT;
