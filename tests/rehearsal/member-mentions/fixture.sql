BEGIN;
DO $seed$
DECLARE old_invite boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE '10000000-0000-4000-8000-00000000000%') THEN
    RAISE EXCEPTION 'synthetic_fixture_collision';
  END IF;
  SELECT invite_only_enabled INTO STRICT old_invite FROM public.registration_invite_settings WHERE id;
  UPDATE public.registration_invite_settings SET invite_only_enabled=false WHERE id;
  INSERT INTO auth.users(id,raw_user_meta_data)
    SELECT ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      jsonb_build_object('full_name','D331 Isolated Fixture ' || n) FROM generate_series(1,5) n;
  UPDATE public.registration_invite_settings SET invite_only_enabled=old_invite WHERE id;
END
$seed$;
INSERT INTO public.chats(id,name,type,created_by)
VALUES ('20000000-0000-4000-8000-000000000001','D331 isolated group','group','10000000-0000-4000-8000-000000000001'),
       ('20000000-0000-4000-8000-000000000002','D331 other group','group','10000000-0000-4000-8000-000000000001');
INSERT INTO public.chat_members(chat_id,user_id,role,joined_at)
SELECT '20000000-0000-4000-8000-000000000001',id,'member',clock_timestamp()-interval '1 hour'
FROM public.profiles WHERE id IN ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003');
UPDATE public.chat_members SET joined_at=clock_timestamp()-interval '1 hour'
WHERE chat_id='20000000-0000-4000-8000-000000000001';
INSERT INTO public.bots(id,username,display_name)
VALUES ('30000000-0000-4000-8000-000000000001','d331_restricted','D331 restricted'),
       ('30000000-0000-4000-8000-000000000002','d331_fullbot','D331 full');
INSERT INTO public.chat_bot_members(chat_id,bot_id,privacy_mode,joined_at)
VALUES ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','restricted',clock_timestamp()-interval '1 hour'),
       ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','full',clock_timestamp()-interval '1 hour');
INSERT INTO public.notification_preferences(user_id,push_enabled)
SELECT id,true FROM public.profiles WHERE id IN ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003')
ON CONFLICT(user_id) DO UPDATE SET push_enabled=true;
INSERT INTO public.push_subscriptions(id,user_id,endpoint,p256dh,auth,is_active)
VALUES ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','https://invalid.example/d331','synthetic','synthetic',true);
INSERT INTO public.user_push_devices(id,user_id,platform,provider,token,token_hash,enabled)
VALUES ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','android','fcm','d331-synthetic-not-a-token',repeat('0',64),true);
COMMIT;
