BEGIN;
DO $seed$
DECLARE old_invite boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE '81000000-0000-4000-8000-00000000000%') THEN
    RAISE EXCEPTION 'presence_quiet_synthetic_collision';
  END IF;
  SELECT invite_only_enabled INTO STRICT old_invite FROM public.registration_invite_settings WHERE id;
  UPDATE public.registration_invite_settings SET invite_only_enabled=false WHERE id;
  INSERT INTO auth.users(id,raw_user_meta_data)
    SELECT ('81000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      jsonb_build_object('full_name','Isolated presence fixture ' || n) FROM generate_series(1,3) n;
  UPDATE public.registration_invite_settings SET invite_only_enabled=old_invite WHERE id;
END
$seed$;
INSERT INTO public.chats(id,name,type,created_by)
VALUES ('82000000-0000-4000-8000-000000000001','Isolated alert group','group','81000000-0000-4000-8000-000000000001'),
       ('82000000-0000-4000-8000-000000000002',NULL,'private','81000000-0000-4000-8000-000000000001'),
       ('82000000-0000-4000-8000-000000000003',NULL,'private','81000000-0000-4000-8000-000000000003');
INSERT INTO public.chat_members(chat_id,user_id,role,joined_at)
SELECT c.id,'81000000-0000-4000-8000-000000000002','member',clock_timestamp()-interval '1 hour'
FROM public.chats c WHERE c.id IN ('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000003');
UPDATE public.chat_members SET joined_at=clock_timestamp()-interval '1 hour'
WHERE chat_id IN ('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000003');
INSERT INTO public.notification_preferences(user_id,push_enabled,message_push_enabled,task_push_enabled,invite_push_enabled)
SELECT id,true,true,true,true FROM public.profiles
WHERE id IN ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')
ON CONFLICT(user_id) DO UPDATE SET push_enabled=true,message_push_enabled=true,task_push_enabled=true,invite_push_enabled=true;
INSERT INTO public.privacy_preferences(user_id,manual_status,manual_status_until,presence_visible,last_active_at)
SELECT id,'online',NULL,true,now() FROM public.profiles
WHERE id IN ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')
ON CONFLICT(user_id) DO UPDATE SET manual_status='online',manual_status_until=NULL,presence_visible=true,last_active_at=now();
INSERT INTO public.push_subscriptions(id,user_id,endpoint,p256dh,auth,is_active)
VALUES ('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','https://invalid.example/presence-quiet-web','synthetic','synthetic',true);
INSERT INTO auth.sessions(id,user_id,not_after,refreshed_at)
VALUES ('84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',NULL,now()),
       ('84000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002',NULL,now());
INSERT INTO public.user_push_devices(id,user_id,platform,provider,token,token_hash,enabled,session_id,voice_call_protocol)
VALUES ('83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','android','fcm',
        'synthetic-presence-not-a-token',repeat('8',64),true,'84000000-0000-4000-8000-000000000002',1);
COMMIT;
