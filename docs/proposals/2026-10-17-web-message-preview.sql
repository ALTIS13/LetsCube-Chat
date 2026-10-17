-- DRAFT: additive Web-only preview API; NOT production/clone applied.
-- Requires the complete item77 topic delivery contract. Runtime starts OFF.
-- Apply only with the repository's verified backup, transactional selfcheck and
-- byte-identical registered migration/mirror procedure. No native RPC changes.
-- Rollback: 2026-10-17-web-message-preview.rollback.sql; keep retired revisions.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prestate$
DECLARE r record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:web-message-preview',0))
    OR to_regclass('private.web_message_preview_grants') IS NOT NULL
    OR to_regclass('private.web_message_preview_runtime') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private') AND p.proname LIKE 'web_message_preview_%')
    OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.push_subscriptions'::regclass,
      'public.notification_preview_preferences'::regclass,'public.notifications'::regclass,
      'public.notifications_push_outbox'::regclass) AND NOT relrowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
      WHERE p.oid=to_regprocedure('private.topic_alert_source_lock(uuid,uuid)')
        AND p.prosecdef AND p.provolatile='v' AND o.rolname='postgres' AND p.proconfig=ARRAY['search_path=""'])
  THEN RAISE EXCEPTION 'web_preview_prestate_drift'; END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.native_message_preview_recipient()','b133d8a966da8f08e9e9acc87f6dec5ab32f090ea1b15ee7226ee29e3ace8304'),
    ('private.message_notification_visible_to(uuid,uuid)','7e4079917f96f31a297764c18172aa7dcb8d193856562a8d8ecf06cbc0dfbaf3'),
    ('public._notification_push_allowed(uuid,text,jsonb)','45cf2fdc00bc3cef29d1e6ca281f7a91a4202e1783da80f92b8e074a3f508a1e'),
    ('private.notification_topic_alert_allowed(uuid)','82ca6127e4b1aa030249bf97db8b286876f1721246f4ff46c6ee0c1d8e834360')
  ) v(signature,hash) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
      WHERE p.oid=to_regprocedure(r.signature) AND p.prosecdef AND o.rolname='postgres'
        AND p.provolatile='s' AND p.proconfig=CASE WHEN r.signature='public.native_message_preview_recipient()'
          THEN ARRAY['search_path=pg_catalog'] ELSE ARRAY['search_path=""'] END
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=r.hash)
    THEN RAISE EXCEPTION 'web_preview_dependency_drift'; END IF;
  END LOOP;
END $prestate$;
SET LOCAL ROLE postgres;

CREATE TABLE private.web_message_preview_runtime (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE private.web_message_preview_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.web_message_preview_runtime FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.web_message_preview_runtime VALUES(true,false);

-- Operator-owned, revocable admission for one install. It does not enable the global runtime.
CREATE TABLE private.web_message_preview_install_admissions (
  subscription_id uuid PRIMARY KEY REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
ALTER TABLE private.web_message_preview_install_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.web_message_preview_install_admissions FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.web_message_preview_grants (
  subscription_id uuid PRIMARY KEY REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- No session FK: deletion must deny content without deleting the CAS tombstone.
  session_id uuid NOT NULL,
  subscription_fingerprint text NOT NULL CHECK(subscription_fingerprint ~ '^v1:[0-9a-f]{64}$'),
  revision bigint NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
  preview_level text NOT NULL CHECK(preview_level IN ('none','sender','message')),
  installation_consent boolean NOT NULL,
  grant_hash bytea UNIQUE,
  last_grant_hash bytea CHECK(last_grant_hash IS NULL OR octet_length(last_grant_hash)=32),
  issued_at timestamptz,
  expires_at timestamptz,
  CHECK((installation_consent AND preview_level IN ('sender','message')
      AND grant_hash IS NOT NULL AND octet_length(grant_hash)=32
      AND last_grant_hash IS NOT NULL AND last_grant_hash=grant_hash AND issued_at IS NOT NULL AND expires_at IS NOT NULL
      AND expires_at<=issued_at+interval '30 days')
    OR (NOT installation_consent AND preview_level='none' AND grant_hash IS NULL AND expires_at IS NULL))
);
ALTER TABLE private.web_message_preview_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.web_message_preview_grants FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX web_message_preview_grants_recipient ON private.web_message_preview_grants(recipient_id);

CREATE FUNCTION private.web_message_preview_descriptor(p_id uuid,p_user uuid,p_endpoint text,p_p256dh text,p_auth text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog
AS $fn$
DECLARE v text; b bytea; framed bytea:=''::bytea;
BEGIN
  IF octet_length(p_endpoint) NOT BETWEEN 1 AND 8192
    OR octet_length(p_p256dh) NOT BETWEEN 1 AND 1024
    OR octet_length(p_auth) NOT BETWEEN 1 AND 1024 THEN RETURN NULL; END IF;
  FOREACH v IN ARRAY ARRAY[p_id::text,p_user::text,p_endpoint,p_p256dh,p_auth] LOOP
    b:=convert_to(v,'UTF8');
    framed:=framed||convert_to(octet_length(b)::text||':','UTF8')||b;
  END LOOP;
  RETURN 'v1:'||encode(sha256(framed),'hex');
END $fn$;

CREATE FUNCTION private.web_message_preview_install_open(p_subscription uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
  SELECT EXISTS(
    SELECT 1 FROM private.web_message_preview_install_admissions a
    JOIN public.push_subscriptions s ON s.id=a.subscription_id
    WHERE a.subscription_id=p_subscription AND a.recipient_id=p_user AND s.user_id=p_user AND s.is_active
      AND a.revoked_at IS NULL AND a.expires_at>clock_timestamp());
$fn$;

-- Trusted backend only. Recipient is the subscription owner, never a caller argument.
CREATE FUNCTION public.web_message_preview_install_set(p_subscription uuid,p_expires_at timestamptz,p_revoke boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE owner_id uuid;
BEGIN
  IF p_subscription IS NULL OR p_revoke IS NULL THEN
    RAISE EXCEPTION 'web_preview_input_refused' USING ERRCODE='22023'; END IF;
  SELECT user_id INTO owner_id FROM public.push_subscriptions WHERE id=p_subscription AND is_active;
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

CREATE FUNCTION private.web_message_preview_choice_retire()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF TG_OP='DELETE' OR NEW.preview_level IS DISTINCT FROM OLD.preview_level THEN
    UPDATE private.web_message_preview_grants SET grant_hash=NULL,installation_consent=false,
      preview_level='none',expires_at=NULL,revision=least(revision+1,9007199254740991)
      WHERE recipient_id=OLD.user_id;
  END IF;
  RETURN NULL;
END $fn$;
CREATE TRIGGER web_message_preview_choice_retire
  AFTER UPDATE OF preview_level OR DELETE ON public.notification_preview_preferences
  FOR EACH ROW EXECUTE FUNCTION private.web_message_preview_choice_retire();

CREATE FUNCTION private.web_message_preview_subscription_retire()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF ROW(NEW.user_id,NEW.endpoint,NEW.p256dh,NEW.auth,NEW.is_active)
    IS DISTINCT FROM ROW(OLD.user_id,OLD.endpoint,OLD.p256dh,OLD.auth,OLD.is_active) THEN
    UPDATE private.web_message_preview_grants SET grant_hash=NULL,installation_consent=false,
      preview_level='none',expires_at=NULL,revision=least(revision+1,9007199254740991)
      WHERE subscription_id=OLD.id;
    UPDATE private.web_message_preview_install_admissions SET revoked_at=clock_timestamp()
      WHERE subscription_id=OLD.id AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END $fn$;
CREATE TRIGGER web_message_preview_subscription_retire
  AFTER UPDATE OF user_id,endpoint,p256dh,auth,is_active ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION private.web_message_preview_subscription_retire();

CREATE FUNCTION public.web_message_preview_context(p_subscription_id uuid)
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
    CASE WHEN eligible.ok THEN floor(extract(epoch FROM least(g.expires_at,a.not_after))*1000)::bigint END
  FROM public.push_subscriptions s
  CROSS JOIN LATERAL (SELECT private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth) AS fp) d
  JOIN auth.sessions a ON a.id=sid AND a.user_id=u
  LEFT JOIN private.web_message_preview_grants g ON g.subscription_id=s.id
  LEFT JOIN public.notification_preview_preferences pref ON pref.user_id=u
  CROSS JOIN LATERAL (SELECT s.is_active AND d.fp IS NOT NULL AND g.recipient_id=u AND g.session_id=sid
    AND g.subscription_fingerprint=d.fp AND g.installation_consent AND g.grant_hash IS NOT NULL
    AND g.preview_level IN ('sender','message') AND g.preview_level=pref.preview_level
    AND g.issued_at<=ts AND g.expires_at>ts
    AND a.created_at<=ts AND (a.not_after IS NULL OR a.not_after>ts)
    AND (EXISTS(SELECT 1 FROM private.web_message_preview_runtime r WHERE r.singleton AND r.enabled)
      OR private.web_message_preview_install_open(s.id,u)) AS ok) eligible
  WHERE s.id=p_subscription_id AND s.user_id=u AND d.fp IS NOT NULL;
END $fn$;

CREATE FUNCTION public.web_message_preview_enroll(p_subscription_id uuid,p_expected_revision bigint,
  p_subscription_fingerprint text,p_preview_level text,p_grant_hash text,p_ttl_seconds integer DEFAULT 2592000)
RETURNS TABLE(preview_v smallint,recipient_id uuid,session_id uuid,subscription_id uuid,
  subscription_fingerprint text,revision bigint,preview_level text,installation_consent boolean,
  observed_at_epoch_ms bigint,expires_at_epoch_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s'
AS $fn$
DECLARE u uuid; sid uuid; s public.push_subscriptions%ROWTYPE;
  g private.web_message_preview_grants%ROWTYPE; a auth.sessions%ROWTYPE;
  pref text; fp text; ts timestamptz;
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
  IF NOT FOUND THEN
    PERFORM 1 FROM private.web_message_preview_install_admissions admission
      JOIN public.push_subscriptions installed ON installed.id=admission.subscription_id
      WHERE admission.subscription_id=p_subscription_id AND admission.recipient_id=u AND installed.user_id=u AND installed.is_active
        AND admission.revoked_at IS NULL AND admission.expires_at>clock_timestamp()
      FOR SHARE OF admission;
    IF NOT FOUND THEN RAISE EXCEPTION 'web_preview_disabled'; END IF;
  END IF;
  SELECT p.preview_level INTO pref FROM public.notification_preview_preferences p WHERE p.user_id=u FOR SHARE;
  IF pref IS DISTINCT FROM p_preview_level THEN RAISE EXCEPTION 'web_preview_choice_refused'; END IF;
  SELECT x.* INTO s FROM public.push_subscriptions x WHERE x.id=p_subscription_id AND x.user_id=u AND x.is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'web_preview_subscription_refused'; END IF;
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
  -- Authenticated enrollment accepts only the browser-generated secret's hash.
  -- Never receive, generate, return or persist a plaintext grant in this path.
  UPDATE private.web_message_preview_grants x SET recipient_id=u,session_id=sid,subscription_fingerprint=fp,
    revision=g.revision+1,preview_level=p_preview_level,installation_consent=true,
    grant_hash=decode(p_grant_hash,'hex'),last_grant_hash=decode(p_grant_hash,'hex'),issued_at=ts,
    expires_at=least(ts+make_interval(secs=>p_ttl_seconds),a.not_after) WHERE x.subscription_id=s.id;
  RETURN QUERY SELECT c.* FROM public.web_message_preview_context(s.id) c;
END $fn$;

CREATE FUNCTION public.web_message_preview_revoke(p_subscription_id uuid,p_expected_revision bigint)
RETURNS TABLE(preview_v smallint,recipient_id uuid,session_id uuid,subscription_id uuid,
  subscription_fingerprint text,revision bigint,preview_level text,installation_consent boolean,
  observed_at_epoch_ms bigint,expires_at_epoch_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s'
AS $fn$
DECLARE u uuid; sid uuid; s public.push_subscriptions%ROWTYPE; fp text; rev bigint;
BEGIN
  IF p_subscription_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991
  THEN RAISE EXCEPTION 'web_preview_input_refused' USING ERRCODE='22023'; END IF;
  u:=public.native_message_preview_recipient();
  IF u IS NULL THEN RAISE EXCEPTION 'web_preview_session_refused' USING ERRCODE='42501'; END IF;
  sid:=(auth.jwt()->>'session_id')::uuid;
  SELECT x.* INTO s FROM public.push_subscriptions x WHERE x.id=p_subscription_id AND x.user_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'web_preview_subscription_refused'; END IF;
  fp:=private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth);
  IF fp IS NULL THEN RAISE EXCEPTION 'web_preview_descriptor_refused'; END IF;
  INSERT INTO private.web_message_preview_grants(subscription_id,recipient_id,session_id,subscription_fingerprint,
    revision,preview_level,installation_consent) VALUES(s.id,u,sid,fp,0,'none',false)
    ON CONFLICT ON CONSTRAINT web_message_preview_grants_pkey DO NOTHING;
  SELECT x.revision INTO rev FROM private.web_message_preview_grants x WHERE x.subscription_id=s.id FOR UPDATE;
  IF rev<>p_expected_revision THEN RAISE EXCEPTION 'web_preview_revision_conflict' USING ERRCODE='40001'; END IF;
  IF public.native_message_preview_recipient() IS DISTINCT FROM u THEN RAISE EXCEPTION 'web_preview_session_refused'; END IF;
  UPDATE private.web_message_preview_grants x SET grant_hash=NULL,installation_consent=false,preview_level='none',
    expires_at=NULL,revision=least(rev+1,9007199254740991) WHERE x.subscription_id=s.id;
  RETURN QUERY SELECT c.* FROM public.web_message_preview_context(s.id) c;
END $fn$;

CREATE FUNCTION public.web_message_preview_content(p_grant_secret text,p_notification_id uuid)
RETURNS TABLE(preview_v smallint,recipient_id uuid,session_id uuid,subscription_id uuid,
  subscription_fingerprint text,revision bigint,notification_id uuid,chat_id uuid,message_id uuid,
  preview_level text,sender_name text,title text,body text,observed_at_epoch_ms bigint,expires_at_epoch_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE seed private.web_message_preview_grants%ROWTYPE; g private.web_message_preview_grants%ROWTYPE;
  s public.push_subscriptions%ROWTYPE; a auth.sessions%ROWTYPE; n public.notifications%ROWTYPE;
  m public.messages%ROWTYPE; mid uuid; pref text; ts timestamptz; deadline timestamptz;
BEGIN
  IF p_grant_secret IS NULL OR octet_length(p_grant_secret)<>69 OR p_grant_secret !~ '^wpg1_[0-9a-f]{64}$'
    OR p_notification_id IS NULL OR current_setting('transaction_isolation')<>'read committed' THEN RETURN; END IF;
  SELECT x.* INTO seed FROM private.web_message_preview_grants x WHERE x.grant_hash=sha256(convert_to(p_grant_secret,'UTF8'));
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM private.web_message_preview_runtime r WHERE r.singleton AND r.enabled FOR SHARE NOWAIT;
  IF NOT FOUND AND NOT private.web_message_preview_install_open(seed.subscription_id,seed.recipient_id) THEN RETURN; END IF;
  -- Keep the same pref -> subscription -> grant order as authenticated enrollment.
  SELECT p.preview_level INTO pref FROM public.notification_preview_preferences p WHERE p.user_id=seed.recipient_id FOR SHARE NOWAIT;
  IF pref IS DISTINCT FROM seed.preview_level OR pref NOT IN ('sender','message') THEN RETURN; END IF;
  SELECT x.* INTO s FROM public.push_subscriptions x WHERE x.id=seed.subscription_id AND x.user_id=seed.recipient_id AND x.is_active FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  IF private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth)
    IS DISTINCT FROM seed.subscription_fingerprint THEN RETURN; END IF; -- DESCRIPTOR_GUARD
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
  IF g.expires_at<=ts OR (a.not_after IS NOT NULL AND a.not_after<=ts) THEN RETURN; END IF;
  deadline:=least(ts+interval '15 seconds',g.expires_at,a.not_after);
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

REVOKE ALL ON FUNCTION private.web_message_preview_descriptor(uuid,uuid,text,text,text),
  private.web_message_preview_install_open(uuid,uuid),
  private.web_message_preview_choice_retire(),private.web_message_preview_subscription_retire()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.web_message_preview_install_set(uuid,timestamptz,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.web_message_preview_install_set(uuid,timestamptz,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.web_message_preview_context(uuid),
  public.web_message_preview_enroll(uuid,bigint,text,text,text,integer),public.web_message_preview_revoke(uuid,bigint),
  public.web_message_preview_content(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.web_message_preview_context(uuid),
  public.web_message_preview_enroll(uuid,bigint,text,text,text,integer),public.web_message_preview_revoke(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.web_message_preview_content(text,uuid) TO anon;

DO $selfcheck$
DECLARE r record; oid_ oid; role_ oid;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('private.web_message_preview_grants'::regclass,
    'private.web_message_preview_runtime'::regclass,'private.web_message_preview_install_admissions'::regclass)
    AND (NOT relrowsecurity OR relowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')))
    OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid IN ('private.web_message_preview_grants'::regclass,'private.web_message_preview_runtime'::regclass,
        'private.web_message_preview_install_admissions'::regclass)
        AND a.grantee<>c.relowner)
    OR has_function_privilege('authenticated','private.web_message_preview_install_open(uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','private.web_message_preview_install_open(uuid,uuid)','EXECUTE')
    OR has_function_privilege('service_role','private.web_message_preview_install_open(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.web_message_preview_install_set(uuid,timestamptz,boolean)','EXECUTE')
    OR has_function_privilege('authenticated','public.web_message_preview_install_set(uuid,timestamptz,boolean)','EXECUTE')
    OR has_function_privilege('anon','public.web_message_preview_install_set(uuid,timestamptz,boolean)','EXECUTE')
    OR (SELECT enabled FROM private.web_message_preview_runtime WHERE singleton) IS DISTINCT FROM false
    OR EXISTS(SELECT 1 FROM private.web_message_preview_grants)
  THEN RAISE EXCEPTION 'web_preview_selfcheck_failed'; END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.web_message_preview_context(uuid)','authenticated'),
    ('public.web_message_preview_enroll(uuid,bigint,text,text,text,integer)','authenticated'),
    ('public.web_message_preview_revoke(uuid,bigint)','authenticated'),
    ('public.web_message_preview_content(text,uuid)','anon')
  ) v(signature,caller) LOOP
    oid_:=to_regprocedure(r.signature); SELECT oid INTO role_ FROM pg_roles WHERE rolname=r.caller;
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=oid_ AND p.prosecdef AND p.provolatile='v'
      AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND p.proconfig[1]='search_path=pg_catalog')
      OR NOT has_function_privilege(r.caller,oid_,'EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=oid_
        AND (a.grantee NOT IN (p.proowner,role_) OR a.is_grantable))
    THEN RAISE EXCEPTION 'web_preview_selfcheck_failed'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('web_message_preview_choice_retire',
    'web_message_preview_subscription_retire') AND NOT tgisinternal AND tgenabled='O')<>2
  THEN RAISE EXCEPTION 'web_preview_selfcheck_failed'; END IF;
END $selfcheck$;
COMMIT;
