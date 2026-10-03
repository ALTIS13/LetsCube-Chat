-- D-338 DISPOSABLE observation prototype, NOT a production migration/repair.
-- Rollback: media-avatar-source-epochs-candidate.rollback.sql, same owned copy.
-- No Storage, I/O intent, physical version, queue/admission/publication, cleanup
-- or quota authority. Bootstrap is logical observation, never retroactive I/O.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE p record;
BEGIN
  IF to_regclass('private.media_avatar_source_current') IS NOT NULL
    OR to_regclass('private.media_avatar_source_history') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname='private' AND f.proname IN
        ('media_avatar_source_observe','media_avatar_source_event','media_avatar_source_reconcile','media_avatar_source_truncate'))
  THEN RAISE EXCEPTION 'avatar_epoch_candidate_prestate_conflict'; END IF;
  -- Exact selected live trigger definitions and captured/archived function
  -- bodies. Do NOT pin old D-339 finish/retry bodies: they are already repaired.
  FOR p IN SELECT * FROM (VALUES
    ('bots','trg_bot_viewer_bot_state_revoke','f13d8515ca45abb9d0108658981327d6','private.bot_viewer_revoke_on_change()','aac6b9bb29335340ee421d415dce91fa'),
    ('chats','trg_add_chat_creator_as_owner','69711b02e7063f6f25f4161884ec1006','public.add_chat_creator_as_owner()','686821f5c5518a16907b592e33516cca'),
    ('chats','trg_chats_identity_is_fixed','01b7a4f5d9037bf3a630aa2fa4432722','private.chats_identity_is_fixed()','2837120889821a6078527d4323672cea'),
    ('chats','trg_enqueue_media_variant_job_for_chat','42b3ea6e08cd963bbc4ba5b48671cc83','private.enqueue_media_variant_job_for_chat()','12fd5f41d023f215ea08d40972b5a231'),
    ('chats','trg_mark_chat_delete_cascade','f5e14aa48363bcce819e936772b579b8','public.mark_chat_delete_cascade()','7a0f003b730c530073dba002ea9ebc10'),
    ('chats','trg_voice_ring_push_chat_changed','02ef97f99663735c7c24f1501eb52671','private.voice_ring_push_chat_changed()','7bb9c819b059113d4cf64d510e87a016'),
    ('profiles','profiles_guard_test_flag','bb986c8e11c7074478f05b70e1711d20','public.profiles_guard_test_flag()','a8536fe9ea814ff23104b86a78c56604'),
    ('profiles','profiles_reserved_username_guard','df2e70c11ba93ad17bc6d28a19b06a3b','public.profiles_reserved_username_guard()','5430664f6add9f3a5adee79452397c54'),
    ('profiles','profiles_validate_cosmetics','e2023453e464fc9872cafb3f48221c6d','public.profiles_validate_cosmetics()','4f133dd3f6a16b6145df04a2fee57776'),
    ('profiles','trg_audit_profile_role','75bfef79071a7ac412a9153342db944f','public._audit_profile_role_after_update()','250affb1d0047150bfa2f9071bd223c9'),
    ('profiles','trg_bootstrap_first_admin','b650e6242044de0052f240bbff182359','public.bootstrap_first_admin()','49484238ef7554bd8f8093de84eeec19'),
    ('profiles','trg_enforce_role_change_matrix','933f6db5b0f50d315e3de6bae025349a','public.enforce_role_change_matrix()','833fdb1586d7e2bd6b2df78d2f2a9226'),
    ('profiles','trg_enqueue_media_variant_job_for_profile','6d986f60a3216459fca7d2616cc4803d','private.enqueue_media_variant_job_for_profile()','18ff4630a938ba683fb958633785497d'),
    ('profiles','trg_ensure_profile_contacts','29ec431122325e22aa0bad171f8e7e1c','public._ensure_profile_contacts()','84d691c913fb7dd3740bc16ff33d86d1'),
    ('profiles','trg_prevent_demoting_last_admin','816e6e77c474b8e3fa91e297bdcd384d','public.prevent_demoting_last_admin()','383d8c65ef7cb7494cd205e4390143e6'),
    ('profiles','trg_profiles_default_user_global_role','abb500d236cc133ab6abfb76f1b92ae8','public.assign_default_user_global_role()','dfce427f7fed9cc3c7653dfc5292bb7b'),
    ('profiles','trg_profiles_mark_message_tombstones','2021d6f7e476a169d72e67a870e703c2','private.mark_profile_delete_message_tombstones()','5e1cc10ed26b4ffca3c7b60658f2f397'),
    ('profiles','trg_registration_invite_apply_from_profile','0cf392dd15cd5738f66eefdccfb569b9','public.registration_invite_apply_from_profile()','d9ba55beb22609e41885fcbaf85c910c')
  ) pins(owner_table,trigger_name,trigger_md5,signature,body_md5)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid=t.tgfoid
      WHERE t.tgrelid=('public.'||p.owner_table)::regclass
        AND t.tgname=p.trigger_name AND t.tgenabled='O'
        AND md5(pg_get_triggerdef(t.oid))=p.trigger_md5
        AND f.oid=to_regprocedure(p.signature) AND md5(f.prosrc)=p.body_md5
    ) THEN RAISE EXCEPTION 'avatar_epoch_baseline_pin_mismatch: %',p.trigger_name; END IF;
  END LOOP;
END
$preflight$;

CREATE TEMP TABLE avatar_epoch_catalog_prestate ON COMMIT DROP AS
SELECT 'function'::text AS kind,p.oid AS id,to_jsonb(p) AS value FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')
UNION ALL SELECT 'trigger',t.oid,to_jsonb(t) FROM pg_trigger t
  WHERE t.tgrelid IN ('public.profiles'::regclass,'public.chats'::regclass,'public.bots'::regclass)
UNION ALL SELECT 'policy',p.oid,to_jsonb(p) FROM pg_policy p
  WHERE p.polrelid IN ('public.profiles'::regclass,'public.chats'::regclass,'public.bots'::regclass)
UNION ALL SELECT 'owner_table',c.oid,to_jsonb(c) FROM pg_class c
  WHERE c.oid IN ('public.profiles'::regclass,'public.chats'::regclass,'public.bots'::regclass)
UNION ALL SELECT 'owner_column',a.attrelid,to_jsonb(a) FROM pg_attribute a
  WHERE a.attrelid IN ('public.profiles'::regclass,'public.chats'::regclass,'public.bots'::regclass);

CREATE TABLE private.media_avatar_source_history (
  source_epoch uuid PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('profile','chat','bot')),
  owner_id uuid NOT NULL,
  avatar_url text,
  tombstone boolean NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('insert','assignment','bootstrap','reconcile','delete','id_replace','truncate')),
  observed_at timestamptz NOT NULL,
  CHECK (NOT tombstone OR avatar_url IS NULL)
);
CREATE INDEX media_avatar_source_history_owner_idx
  ON private.media_avatar_source_history(scope,owner_id,observed_at,source_epoch);
CREATE TABLE private.media_avatar_source_current (
  scope text NOT NULL CHECK (scope IN ('profile','chat','bot')),
  owner_id uuid NOT NULL,
  source_epoch uuid NOT NULL UNIQUE,
  avatar_url text,
  tombstone boolean NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (scope,owner_id),
  CHECK (NOT tombstone OR avatar_url IS NULL)
);
-- Deliberately no owner FK and no cascading history lifetime.
ALTER TABLE private.media_avatar_source_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.media_avatar_source_current ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.media_avatar_source_history,private.media_avatar_source_current
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE private.media_avatar_source_history IS 'D-338 disposable logical epoch observation v1; retained, unmanaged; not physical/I-O authority';
COMMENT ON TABLE private.media_avatar_source_current IS 'D-338 disposable logical epoch observation v1; current/tombstone; not physical/I-O authority';

CREATE FUNCTION private.media_avatar_source_observe(
  p_scope text,p_owner_id uuid,p_force boolean,p_event_kind text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '2s' SET statement_timeout = '4s'
AS $function$
DECLARE
  v_table text;
  v_url text;
  v_found boolean;
  v_count bigint;
  v_current private.media_avatar_source_current%rowtype;
  v_epoch uuid;
  v_at timestamptz;
BEGIN
  IF p_scope IS NULL OR p_owner_id IS NULL OR p_force IS NULL
    OR p_scope NOT IN ('profile','chat','bot') OR p_event_kind IS NULL
    OR p_event_kind NOT IN ('insert','assignment','bootstrap','reconcile','delete','id_replace','truncate')
  THEN RAISE EXCEPTION 'avatar_epoch_input_invalid' USING ERRCODE='22023'; END IF;
  v_table := CASE p_scope WHEN 'profile' THEN 'profiles' WHEN 'chat' THEN 'chats' ELSE 'bots' END;
  -- Owner first; no caller-supplied epoch or URL. Reread final row, never NEW.
  EXECUTE pg_catalog.format('select avatar_url from public.%I where id=$1 for update',v_table)
    INTO v_url USING p_owner_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_found := v_count=1;
  SELECT * INTO v_current FROM private.media_avatar_source_current
    WHERE scope=p_scope AND owner_id=p_owner_id FOR UPDATE;
  IF FOUND AND NOT p_force AND v_current.avatar_url IS NOT DISTINCT FROM v_url
    AND v_current.tombstone = NOT v_found
  THEN RETURN v_current.source_epoch; END IF;
  v_epoch := pg_catalog.gen_random_uuid();
  v_at := pg_catalog.clock_timestamp();
  -- Current -> history, including first-row insert. The owner row serializes
  -- simultaneous setters; DELETE/TRUNCATE retain its logical history.
  INSERT INTO private.media_avatar_source_current(scope,owner_id,source_epoch,avatar_url,tombstone,observed_at)
    VALUES(p_scope,p_owner_id,v_epoch,v_url,NOT v_found,v_at)
    ON CONFLICT(scope,owner_id) DO UPDATE SET source_epoch=EXCLUDED.source_epoch,
      avatar_url=EXCLUDED.avatar_url,tombstone=EXCLUDED.tombstone,observed_at=EXCLUDED.observed_at;
  INSERT INTO private.media_avatar_source_history(source_epoch,scope,owner_id,avatar_url,tombstone,event_kind,observed_at)
    VALUES(v_epoch,p_scope,p_owner_id,v_url,NOT v_found,p_event_kind,v_at);
  RETURN v_epoch;
END
$function$;

CREATE FUNCTION private.media_avatar_source_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_scope text := tg_argv[0];
BEGIN
  IF tg_op='DELETE' THEN
    PERFORM private.media_avatar_source_observe(v_scope,old.id,true,'delete');
  ELSE
    IF tg_op='UPDATE' AND old.id IS DISTINCT FROM new.id THEN
      PERFORM private.media_avatar_source_observe(v_scope,old.id,false,'id_replace');
    END IF;
    PERFORM private.media_avatar_source_observe(v_scope,new.id,
      tg_argv[1]='explicit',CASE WHEN tg_op='INSERT' THEN 'insert'
        WHEN tg_argv[1]='explicit' THEN 'assignment' ELSE 'reconcile' END);
  END IF;
  RETURN NULL;
END
$function$;

CREATE FUNCTION private.media_avatar_source_reconcile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_id uuid; v_scope text := tg_argv[0];
BEGIN
  -- Transition IDs are only a candidate set. The observer always locks/rereads
  -- actual owners after nested events, not the outer transition avatar values.
  IF tg_op='INSERT' THEN
    FOR v_id IN SELECT id FROM epoch_new ORDER BY id LOOP
      PERFORM private.media_avatar_source_observe(v_scope,v_id,false,'reconcile');
    END LOOP;
  ELSIF tg_op='DELETE' THEN
    FOR v_id IN SELECT id FROM epoch_old ORDER BY id LOOP
      PERFORM private.media_avatar_source_observe(v_scope,v_id,false,'delete');
    END LOOP;
  ELSE
    FOR v_id IN SELECT id FROM epoch_old UNION SELECT id FROM epoch_new ORDER BY id LOOP
      PERFORM private.media_avatar_source_observe(v_scope,v_id,false,'reconcile');
    END LOOP;
  END IF;
  RETURN NULL;
END
$function$;

CREATE FUNCTION private.media_avatar_source_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_id uuid; v_scope text := tg_argv[0];
BEGIN
  FOR v_id IN SELECT owner_id FROM private.media_avatar_source_current WHERE scope=v_scope ORDER BY owner_id LOOP
    PERFORM private.media_avatar_source_observe(v_scope,v_id,false,'truncate');
  END LOOP;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION private.media_avatar_source_observe(text,uuid,boolean,text),
  private.media_avatar_source_event(),private.media_avatar_source_reconcile(),private.media_avatar_source_truncate()
  FROM PUBLIC,anon,authenticated,service_role;

DO $hooks$
DECLARE p record;
BEGIN
  FOR p IN SELECT * FROM (VALUES ('profile','profiles'),('chat','chats'),('bot','bots')) s(scope,owner_table)
  LOOP
    EXECUTE format('create trigger a00_avatar_epoch_explicit after insert or update of avatar_url on public.%I for each row execute function private.media_avatar_source_event(%L,%L)',p.owner_table,p.scope,'explicit');
    EXECUTE format('create trigger a01_avatar_epoch_update_fallback after update on public.%I for each row execute function private.media_avatar_source_event(%L,%L)',p.owner_table,p.scope,'fallback');
    EXECUTE format('create trigger a00_avatar_epoch_delete after delete on public.%I for each row execute function private.media_avatar_source_event(%L)',p.owner_table,p.scope);
    EXECUTE format('create trigger z99_avatar_epoch_insert_final after insert on public.%I referencing new table as epoch_new for each statement execute function private.media_avatar_source_reconcile(%L)',p.owner_table,p.scope);
    EXECUTE format('create trigger z99_avatar_epoch_update_final after update on public.%I referencing old table as epoch_old new table as epoch_new for each statement execute function private.media_avatar_source_reconcile(%L)',p.owner_table,p.scope);
    EXECUTE format('create trigger z99_avatar_epoch_delete_final after delete on public.%I referencing old table as epoch_old for each statement execute function private.media_avatar_source_reconcile(%L)',p.owner_table,p.scope);
    EXECUTE format('create trigger z99_avatar_epoch_truncate after truncate on public.%I for each statement execute function private.media_avatar_source_truncate(%L)',p.owner_table,p.scope);
  END LOOP;
END
$hooks$;

DO $bootstrap$
DECLARE p record;
BEGIN
  FOR p IN SELECT 'profile'::text AS scope,id AS owner_id FROM public.profiles
    UNION ALL SELECT 'chat',id FROM public.chats UNION ALL SELECT 'bot',id FROM public.bots
    ORDER BY scope,owner_id
  LOOP
    PERFORM private.media_avatar_source_observe(p.scope,p.owner_id,false,'bootstrap');
  END LOOP;
END
$bootstrap$;

DO $selfcheck$
DECLARE p record; v_role text;
BEGIN
  FOR p IN SELECT * FROM avatar_epoch_catalog_prestate LOOP
    IF p.kind='function' AND NOT EXISTS(SELECT 1 FROM pg_proc x WHERE x.oid=p.id AND to_jsonb(x)=p.value)
      OR p.kind='trigger' AND NOT EXISTS(SELECT 1 FROM pg_trigger x WHERE x.oid=p.id AND to_jsonb(x)=p.value)
      OR p.kind='policy' AND NOT EXISTS(SELECT 1 FROM pg_policy x WHERE x.oid=p.id AND to_jsonb(x)=p.value)
      -- Adding triggers changes relhastriggers, but each captured owner already has hooks.
      OR p.kind='owner_table' AND NOT EXISTS(SELECT 1 FROM pg_class x WHERE x.oid=p.id AND to_jsonb(x)=p.value)
      OR p.kind='owner_column' AND NOT EXISTS(SELECT 1 FROM pg_attribute x WHERE x.attrelid=p.id AND to_jsonb(x)=p.value)
    THEN RAISE EXCEPTION 'avatar_epoch_original_catalog_changed'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN
    ('a00_avatar_epoch_explicit','a01_avatar_epoch_update_fallback','a00_avatar_epoch_delete',
      'z99_avatar_epoch_insert_final','z99_avatar_epoch_update_final','z99_avatar_epoch_delete_final','z99_avatar_epoch_truncate')
    AND tgrelid IN ('public.profiles'::regclass,'public.chats'::regclass,'public.bots'::regclass) AND tgenabled='O') <> 21
  THEN RAISE EXCEPTION 'avatar_epoch_hook_count_invalid'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('private.media_avatar_source_current'::regclass,
    'private.media_avatar_source_history'::regclass) AND NOT relrowsecurity)
    OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid IN ('private.media_avatar_source_current'::regclass,
      'private.media_avatar_source_history'::regclass) AND contype='f')
  THEN RAISE EXCEPTION 'avatar_epoch_table_boundary_invalid'; END IF;
  FOR v_role IN SELECT unnest(ARRAY['anon','authenticated','service_role']) LOOP
    IF has_table_privilege(v_role,'private.media_avatar_source_current','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege(v_role,'private.media_avatar_source_history','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(v_role,'private.media_avatar_source_current','SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege(v_role,'private.media_avatar_source_history','SELECT,INSERT,UPDATE,REFERENCES')
      OR EXISTS (SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
        WHERE n.nspname='private' AND f.proname IN ('media_avatar_source_observe','media_avatar_source_event',
          'media_avatar_source_reconcile','media_avatar_source_truncate') AND has_function_privilege(v_role,f.oid,'EXECUTE'))
    THEN RAISE EXCEPTION 'avatar_epoch_private_authority_leak'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN
    ('private.media_avatar_source_observe(text,uuid,boolean,text)'::regprocedure,'private.media_avatar_source_event()'::regprocedure,
      'private.media_avatar_source_reconcile()'::regprocedure,'private.media_avatar_source_truncate()'::regprocedure)
    AND (NOT prosecdef OR NOT ('search_path=""'=ANY(proconfig))))
  THEN RAISE EXCEPTION 'avatar_epoch_function_boundary_invalid'; END IF;
  IF EXISTS (SELECT 1 FROM private.media_avatar_source_current c LEFT JOIN private.media_avatar_source_history h
    ON h.source_epoch=c.source_epoch WHERE h.source_epoch IS NULL OR
    (h.scope,h.owner_id,h.avatar_url,h.tombstone,h.observed_at) IS DISTINCT FROM
    (c.scope,c.owner_id,c.avatar_url,c.tombstone,c.observed_at))
  THEN RAISE EXCEPTION 'avatar_epoch_current_history_mismatch'; END IF;
END
$selfcheck$;
COMMIT;
