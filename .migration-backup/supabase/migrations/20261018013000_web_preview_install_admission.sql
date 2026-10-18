-- Per-install preview admission. Does not enable web_message_preview_runtime.
-- Not applied to production by this commit. Apply only after a fresh verified backup,
-- in one raising transaction.
-- Narrow rollback: coordinator's exact captured-prestate runbook restores prior
-- context/enroll/content/subscription_retire bodies and their metadata, then drops
-- public.web_message_preview_install_set(uuid,timestamptz,boolean),
-- private.web_message_preview_install_open(uuid,uuid), and the admission table.
-- Full feature disable (before/after sidecar):
-- docs/proposals/2026-10-17-web-message-preview.rollback.sql.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $prestate$
DECLARE prior boolean;
BEGIN
  IF to_regclass('private.web_message_preview_runtime') IS NULL
    OR to_regclass('private.web_message_preview_grants') IS NULL
    OR to_regclass('private.web_message_preview_install_admissions') IS NOT NULL
    OR to_regprocedure('public.web_message_preview_install_set(uuid,timestamptz,boolean)') IS NOT NULL
  THEN RAISE EXCEPTION 'web_preview_install_admission_prestate_drift'; END IF;
  SELECT enabled INTO prior FROM private.web_message_preview_runtime WHERE singleton;
  PERFORM set_config('letscube.web_preview_runtime_prior', prior::text, true);
END $prestate$;
SET LOCAL ROLE postgres;
CREATE TABLE private.web_message_preview_install_admissions (
  subscription_id uuid PRIMARY KEY REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
ALTER TABLE private.web_message_preview_install_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.web_message_preview_install_admissions FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.web_message_preview_install_open(p_subscription uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
  SELECT EXISTS(
    SELECT 1 FROM private.web_message_preview_install_admissions a
    JOIN public.push_subscriptions s ON s.id=a.subscription_id
    WHERE a.subscription_id=p_subscription AND a.recipient_id=p_user AND s.user_id=p_user AND s.is_active
      AND a.revoked_at IS NULL AND a.expires_at>clock_timestamp());
$fn$;

-- Trusted backend only. Recipient is the subscription owner, never a caller argument.

CREATE OR REPLACE FUNCTION public.web_message_preview_install_set(p_subscription uuid,p_expires_at timestamptz,p_revoke boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE owner_id uuid;
BEGIN
  IF p_subscription IS NULL OR p_revoke IS NULL THEN
    RAISE EXCEPTION 'web_preview_input_refused' USING ERRCODE='22023'; END IF;
  -- SHARE/UPDATE, not KEY SHARE: descriptor updates must serialize with admission.
  SELECT user_id INTO owner_id FROM public.push_subscriptions WHERE id=p_subscription AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'web_preview_subscription_refused'; END IF;
  IF p_revoke THEN
    UPDATE private.web_message_preview_install_admissions
      SET revoked_at=clock_timestamp()
      WHERE subscription_id=p_subscription AND revoked_at IS NULL;
    RETURN;
  END IF;
  IF p_expires_at IS NULL THEN RAISE EXCEPTION 'web_preview_input_refused' USING ERRCODE='22023'; END IF;
  INSERT INTO private.web_message_preview_install_admissions(subscription_id,recipient_id,expires_at,revoked_at)
    VALUES(p_subscription,owner_id,p_expires_at,NULL)
    ON CONFLICT (subscription_id) DO UPDATE SET recipient_id=EXCLUDED.recipient_id,
      expires_at=EXCLUDED.expires_at,revoked_at=NULL;
END $fn$;


CREATE OR REPLACE FUNCTION private.web_message_preview_subscription_retire()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF ROW(NEW.user_id,NEW.endpoint,NEW.p256dh,NEW.auth,NEW.is_active)
    IS DISTINCT FROM ROW(OLD.user_id,OLD.endpoint,OLD.p256dh,OLD.auth,OLD.is_active) THEN
    UPDATE private.web_message_preview_install_admissions SET revoked_at=clock_timestamp()
      WHERE subscription_id=OLD.id AND revoked_at IS NULL;
    UPDATE private.web_message_preview_grants SET grant_hash=NULL,installation_consent=false,
      preview_level='none',expires_at=NULL,revision=least(revision+1,9007199254740991)
      WHERE subscription_id=OLD.id;
  END IF;
  RETURN NULL;
END $fn$;

CREATE OR REPLACE FUNCTION public.web_message_preview_context(p_subscription_id uuid)
RETURNS TABLE(preview_v smallint,recipient_id uuid,session_id uuid,subscription_id uuid,
  subscription_fingerprint text,revision bigint,preview_level text,installation_consent boolean,
  observed_at_epoch_ms bigint,expires_at_epoch_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE u uuid; sid uuid; ts timestamptz:=clock_timestamp();
BEGIN
  u:=public.native_message_preview_recipient();
  IF u IS NULL OR p_subscription_id IS NULL THEN RETURN; END IF;
  sid:=(auth.jwt()->>'session_id')::uuid;
  RETURN QUERY
  SELECT 1::smallint,u,sid,s.id,d.fp,coalesce(g.revision,0),
    CASE WHEN eligible.ok THEN g.preview_level ELSE 'none' END,
    coalesce(eligible.ok,false),floor(extract(epoch FROM ts)*1000)::bigint,
    CASE WHEN eligible.ok THEN floor(extract(epoch FROM least(g.expires_at,a.not_after,
      CASE WHEN NOT runtime.enabled THEN admission.expires_at END))*1000)::bigint END
  FROM public.push_subscriptions s
  CROSS JOIN LATERAL (SELECT private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth) AS fp) d
  JOIN auth.sessions a ON a.id=sid AND a.user_id=u
  LEFT JOIN private.web_message_preview_grants g ON g.subscription_id=s.id
  LEFT JOIN public.notification_preview_preferences pref ON pref.user_id=u
  LEFT JOIN private.web_message_preview_install_admissions admission ON admission.subscription_id=s.id
  CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM private.web_message_preview_runtime r
    WHERE r.singleton AND r.enabled) AS enabled) runtime
  CROSS JOIN LATERAL (SELECT s.is_active AND d.fp IS NOT NULL AND g.recipient_id=u AND g.session_id=sid
    AND g.subscription_fingerprint=d.fp AND g.installation_consent AND g.grant_hash IS NOT NULL
    AND g.preview_level IN ('sender','message') AND g.preview_level=pref.preview_level
    AND g.issued_at<=ts AND g.expires_at>ts
    AND a.created_at<=ts AND (a.not_after IS NULL OR a.not_after>ts)
    AND (runtime.enabled OR private.web_message_preview_install_open(s.id,u)) AS ok) eligible
  WHERE s.id=p_subscription_id AND s.user_id=u AND d.fp IS NOT NULL;
END $fn$;


CREATE OR REPLACE FUNCTION public.web_message_preview_enroll(p_subscription_id uuid,p_expected_revision bigint,
  p_subscription_fingerprint text,p_preview_level text,p_grant_hash text,p_ttl_seconds integer DEFAULT 2592000)
RETURNS TABLE(preview_v smallint,recipient_id uuid,session_id uuid,subscription_id uuid,
  subscription_fingerprint text,revision bigint,preview_level text,installation_consent boolean,
  observed_at_epoch_ms bigint,expires_at_epoch_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s'
AS $fn$
DECLARE u uuid; sid uuid; s public.push_subscriptions%ROWTYPE;
  g private.web_message_preview_grants%ROWTYPE; a auth.sessions%ROWTYPE;
  pref text; fp text; ts timestamptz; runtime_enabled boolean; admission_expires timestamptz;
BEGIN
  IF p_subscription_id IS NULL OR p_expected_revision IS NULL
    OR p_expected_revision NOT BETWEEN 0 AND 9007199254740990
    OR p_preview_level IS NULL OR p_preview_level NOT IN ('sender','message')
    OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 1 AND 2592000
    OR p_subscription_fingerprint IS NULL OR p_subscription_fingerprint !~ '^v1:[0-9a-f]{64}$'
    OR p_grant_hash IS NULL OR octet_length(p_grant_hash)<>64 OR p_grant_hash !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'web_preview_input_refused' USING ERRCODE='22023'; END IF;
  u:=public.native_message_preview_recipient();
  IF u IS NULL THEN RAISE EXCEPTION 'web_preview_session_refused' USING ERRCODE='42501'; END IF;
  sid:=(auth.jwt()->>'session_id')::uuid;
  PERFORM 1 FROM private.web_message_preview_runtime r WHERE r.singleton AND r.enabled FOR SHARE;
  runtime_enabled:=FOUND;
  -- All readers/writers take subscription before admission, then grant.
  SELECT p.preview_level INTO pref FROM public.notification_preview_preferences p WHERE p.user_id=u FOR SHARE;
  IF pref IS DISTINCT FROM p_preview_level THEN RAISE EXCEPTION 'web_preview_choice_refused'; END IF;
  SELECT x.* INTO s FROM public.push_subscriptions x WHERE x.id=p_subscription_id AND x.user_id=u AND x.is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'web_preview_subscription_refused'; END IF;
  IF NOT runtime_enabled THEN
    SELECT admission.expires_at INTO admission_expires FROM private.web_message_preview_install_admissions admission
      WHERE admission.subscription_id=s.id AND admission.recipient_id=u
        AND admission.revoked_at IS NULL AND admission.expires_at>clock_timestamp()
      FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'web_preview_disabled'; END IF;
  END IF;
  fp:=private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth);
  IF fp IS DISTINCT FROM p_subscription_fingerprint THEN RAISE EXCEPTION 'web_preview_descriptor_refused'; END IF;
  INSERT INTO private.web_message_preview_grants(subscription_id,recipient_id,session_id,subscription_fingerprint,
    revision,preview_level,installation_consent) VALUES(s.id,u,sid,fp,0,'none',false)
    ON CONFLICT ON CONSTRAINT web_message_preview_grants_pkey DO NOTHING;
  SELECT x.* INTO g FROM private.web_message_preview_grants x WHERE x.subscription_id=s.id FOR UPDATE;
  IF g.revision<>p_expected_revision THEN RAISE EXCEPTION 'web_preview_revision_conflict' USING ERRCODE='40001'; END IF;
  IF g.last_grant_hash=decode(p_grant_hash,'hex') THEN RAISE EXCEPTION 'web_preview_rotation_refused' USING ERRCODE='22023'; END IF;
  SELECT x.* INTO a FROM auth.sessions x WHERE x.id=sid AND x.user_id=u FOR SHARE;
  ts:=clock_timestamp();
  IF NOT FOUND OR a.created_at>ts OR (a.not_after IS NOT NULL AND a.not_after<=ts)
    OR public.native_message_preview_recipient() IS DISTINCT FROM u
    OR (auth.jwt()->>'exp')::bigint<=extract(epoch FROM ts)
  THEN RAISE EXCEPTION 'web_preview_session_refused' USING ERRCODE='42501'; END IF;
  IF admission_expires<=ts THEN RAISE EXCEPTION 'web_preview_disabled'; END IF;
  -- Authenticated enrollment accepts only the browser-generated secret's hash.
  -- Never receive, generate, return or persist a plaintext grant in this path.
  UPDATE private.web_message_preview_grants x SET recipient_id=u,session_id=sid,subscription_fingerprint=fp,
    revision=g.revision+1,preview_level=p_preview_level,installation_consent=true,
    grant_hash=decode(p_grant_hash,'hex'),last_grant_hash=decode(p_grant_hash,'hex'),issued_at=ts,
    expires_at=least(ts+make_interval(secs=>p_ttl_seconds),a.not_after,admission_expires) WHERE x.subscription_id=s.id;
  RETURN QUERY SELECT c.* FROM public.web_message_preview_context(s.id) c;
END $fn$;


CREATE OR REPLACE FUNCTION public.web_message_preview_content(p_grant_secret text,p_notification_id uuid)
RETURNS TABLE(preview_v smallint,recipient_id uuid,session_id uuid,subscription_id uuid,
  subscription_fingerprint text,revision bigint,notification_id uuid,chat_id uuid,message_id uuid,
  preview_level text,sender_name text,title text,body text,observed_at_epoch_ms bigint,expires_at_epoch_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE seed private.web_message_preview_grants%ROWTYPE; g private.web_message_preview_grants%ROWTYPE;
  s public.push_subscriptions%ROWTYPE; a auth.sessions%ROWTYPE; n public.notifications%ROWTYPE;
  m public.messages%ROWTYPE; mid uuid; pref text; ts timestamptz; deadline timestamptz;
  runtime_enabled boolean; admission_expires timestamptz;
BEGIN
  IF p_grant_secret IS NULL OR octet_length(p_grant_secret)<>69 OR p_grant_secret !~ '^wpg1_[0-9a-f]{64}$'
    OR p_notification_id IS NULL OR current_setting('transaction_isolation')<>'read committed' THEN RETURN; END IF;
  SELECT x.* INTO seed FROM private.web_message_preview_grants x WHERE x.grant_hash=sha256(convert_to(p_grant_secret,'UTF8'));
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM private.web_message_preview_runtime r WHERE r.singleton AND r.enabled FOR SHARE NOWAIT;
  runtime_enabled:=FOUND;
  -- Keep pref -> subscription -> admission -> grant order, including retirement.
  SELECT p.preview_level INTO pref FROM public.notification_preview_preferences p WHERE p.user_id=seed.recipient_id FOR SHARE NOWAIT;
  IF pref IS DISTINCT FROM seed.preview_level OR pref NOT IN ('sender','message') THEN RETURN; END IF;
  SELECT x.* INTO s FROM public.push_subscriptions x WHERE x.id=seed.subscription_id AND x.user_id=seed.recipient_id AND x.is_active FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  IF private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth)
    IS DISTINCT FROM seed.subscription_fingerprint THEN RETURN; END IF; -- DESCRIPTOR_GUARD
  IF NOT runtime_enabled THEN
    SELECT admission.expires_at INTO admission_expires FROM private.web_message_preview_install_admissions admission
      WHERE admission.subscription_id=s.id AND admission.recipient_id=seed.recipient_id
        AND admission.revoked_at IS NULL AND admission.expires_at>clock_timestamp()
      FOR SHARE NOWAIT;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;
  SELECT x.* INTO g FROM private.web_message_preview_grants x WHERE x.subscription_id=seed.subscription_id
    AND x.grant_hash=sha256(convert_to(p_grant_secret,'UTF8')) AND x.revision=seed.revision
    AND x.recipient_id=seed.recipient_id AND x.session_id=seed.session_id
    AND x.installation_consent AND x.preview_level=pref FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT x.* INTO a FROM auth.sessions x WHERE x.id=g.session_id AND x.user_id=g.recipient_id
    AND x.created_at<=clock_timestamp() AND (x.not_after IS NULL OR x.not_after>clock_timestamp()) FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF; -- SESSION_GUARD
  ts:=clock_timestamp();
  IF g.issued_at>ts OR g.expires_at<=ts THEN RETURN; END IF;
  SELECT x.* INTO n FROM public.notifications x WHERE x.id=p_notification_id AND x.user_id=g.recipient_id
    AND x.kind='message' AND x.read_at IS NULL AND x.alert_suppressed_at IS NULL
    AND x.created_at>=a.created_at AND x.created_at<=ts FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  IF coalesce(n.payload->>'message_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN; END IF;
  mid:=(n.payload->>'message_id')::uuid;
  SELECT x.* INTO m FROM public.messages x WHERE x.id=mid
    AND n.payload->>'chat_id'=x.chat_id::text FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  -- The maintained topic barrier refuses busy/incompatible transactions; no
  -- caller-supplied bypass flag and no network/effect while locks are held.
  PERFORM private.topic_alert_source_lock(g.recipient_id,m.chat_id);
  ts:=clock_timestamp();
  IF g.expires_at<=ts OR (a.not_after IS NOT NULL AND a.not_after<=ts)
    OR admission_expires<=ts THEN RETURN; END IF;
  deadline:=least(ts+interval '15 seconds',g.expires_at,a.not_after,admission_expires);
  RETURN QUERY SELECT 1::smallint,g.recipient_id,g.session_id,g.subscription_id,g.subscription_fingerprint,g.revision,
    n.id,m.chat_id,m.id,g.preview_level,label.name,label.name,
    CASE WHEN g.preview_level='sender' THEN 'Новое сообщение' ELSE coalesce(nullif(left(btrim(regexp_replace(
      CASE m.type WHEN 'text' THEN m.content WHEN 'image' THEN 'Фото' WHEN 'video' THEN 'Видео'
        WHEN 'audio' THEN 'Голосовое сообщение' WHEN 'voice' THEN 'Голосовое сообщение'
        WHEN 'file' THEN 'Файл' ELSE 'Новое сообщение' END,'[[:cntrl:][:space:]]+',' ','g')),240),''),'Новое сообщение') END,
    floor(extract(epoch FROM ts)*1000)::bigint,floor(extract(epoch FROM deadline)*1000)::bigint
  FROM (SELECT 1) anchor
  LEFT JOIN public.profiles profile ON profile.id=m.user_id AND m.bot_id IS NULL
  LEFT JOIN public.bots bot ON bot.id=m.bot_id AND m.user_id IS NULL
  CROSS JOIN LATERAL (SELECT left(btrim(regexp_replace(coalesce(profile.full_name,bot.display_name,''),
    '[[:cntrl:][:space:]]+',' ','g')),96) AS name) label
  WHERE label.name<>'' AND private.message_notification_visible_to(m.id,g.recipient_id)
    AND private.notification_topic_alert_allowed(n.id)
    AND public._notification_push_allowed(g.recipient_id,'message',jsonb_build_object(
      'message_id',m.id,'chat_id',m.chat_id,'sender_id',m.user_id))
    AND (EXISTS(SELECT 1 FROM public.notifications_push_outbox o WHERE o.notification_id=n.id
      AND o.subscription_id=g.subscription_id AND o.user_id=g.recipient_id AND o.suppressed_at IS NULL)
      OR EXISTS(SELECT 1 FROM public.album_push_members member
        JOIN public.album_push_groups album ON album.id=member.group_id
        JOIN public.notifications_album_push_outbox delivery ON delivery.group_id=album.id
        WHERE member.notification_id=n.id AND member.message_id=m.id AND album.user_id=g.recipient_id
          AND album.chat_id=m.chat_id AND album.topic_alert_suppressed_at IS NULL
          AND ((album.sender_kind='user' AND album.sender_id=m.user_id AND m.bot_id IS NULL)
            OR (album.sender_kind='bot' AND album.sender_id=m.bot_id AND m.user_id IS NULL))
          AND delivery.subscription_id=g.subscription_id AND delivery.device_id IS NULL AND delivery.suppressed_at IS NULL));
EXCEPTION WHEN lock_not_available OR serialization_failure THEN RETURN;
END $fn$;


REVOKE ALL ON FUNCTION private.web_message_preview_install_open(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.web_message_preview_install_set(uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.web_message_preview_install_set(uuid,timestamptz,boolean) TO service_role;
DO $selfcheck$
BEGIN
  IF (SELECT enabled::text FROM private.web_message_preview_runtime WHERE singleton)
      IS DISTINCT FROM current_setting('letscube.web_preview_runtime_prior')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private.web_message_preview_install_admissions'::regclass)
    OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid='private.web_message_preview_install_admissions'::regclass AND a.grantee<>c.relowner)
    OR has_function_privilege('authenticated','private.web_message_preview_install_open(uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','private.web_message_preview_install_open(uuid,uuid)','EXECUTE')
    OR has_function_privilege('service_role','private.web_message_preview_install_open(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.web_message_preview_install_set(uuid,timestamptz,boolean)','EXECUTE')
    OR has_function_privilege('authenticated','public.web_message_preview_install_set(uuid,timestamptz,boolean)','EXECUTE')
    OR has_function_privilege('anon','public.web_message_preview_install_set(uuid,timestamptz,boolean)','EXECUTE')
  THEN RAISE EXCEPTION 'web_preview_install_admission_selfcheck_failed'; END IF;
END $selfcheck$;
COMMIT;
