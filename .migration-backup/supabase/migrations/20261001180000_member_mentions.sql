-- D-331 scoped identity mentions. Coordinator alone may apply production SQL.
-- Rollback: 20261001180000_member_mentions.rollback.sql; disable producers first.
-- Rollback retains mention_entities deliberately; it never drops historical identities.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $prestate$
DECLARE p pg_proc;
BEGIN
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.enqueue_message_notifications()'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> 'e8e6e3d6a9e511c072b5b300502a338154336d472b2697a0d3bd61b05e82a48e' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.enqueue_message_notifications'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public._notification_push_allowed(uuid, text, jsonb)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '53019ef87d58e4a1b0318e17dc621b72f72474a1df301932f81c8076eb247229' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> false OR p.provolatile <> 's'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM NULL::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public._notification_push_allowed'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public._notification_push_payload(text, jsonb)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '607ff23b1810e422b10728f512e7d3f8a8c69ecb56e2679a03a226e469dad26e' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> false OR p.provolatile <> 'i'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public._notification_push_payload'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.push_outbox_delivery_recheck(uuid, uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '0a445cad6bcf7790309ca9d6b5e62549646a875e01ce91759bb1e1fac1d65a81' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=public, pg_temp"]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.push_outbox_delivery_recheck'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.native_push_outbox_delivery_recheck(uuid, uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '8432fe8214d6552b6c169e868d97085dcf33258c6a8050c5138e6501b539a017' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=pg_catalog"]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.native_push_outbox_delivery_recheck'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.album_push_recheck(uuid, uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '75303ec9a867c71aed3b1f4d20f61e5ac8beac708affceaa7cdace4b7997b10a' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=pg_catalog"]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.album_push_recheck'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.bot_can_receive_message(uuid, uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '5b9783f4ac32b79bda916f00fdf36513d40de6e1e0926b71c35589b5aab6dd7b' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 's'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:private.bot_can_receive_message'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.enqueue_bot_message_updates_after_update()'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '157a84e5e03d81eea34db30b34f2e6cba13ab06329ecfb08ed115cd29e4f9a4b' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:private.enqueue_bot_message_updates_after_update'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.deleted_message_keeps_nothing()'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> 'e976c4264c2487355e45e514236ec490e8ce68f077e56274aadcf3854ad468a9' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:private.deleted_message_keeps_nothing'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.scrub_deleted_message_notifications(uuid[])'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '9f0fcc7406326f109039488cafccd0ea47d64a86a43824a1057c3ff7f09b659a' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:private.scrub_deleted_message_notifications'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.bot_update_still_visible(uuid, text, jsonb)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '7c36b872154bb7f219483b39e4d7fa44b51e937c2699382d7fe2d2927ed305f6' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:private.bot_update_still_visible'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.bot_delivery_prepare_internal(bigint, uuid, bigint)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '6da69e1ac4601cea77e88d11d5c41d6dfca38bd4982f38a950f2f0e66ff646e1' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.bot_delivery_prepare_internal'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.bot_updates_poll_internal(uuid, bigint, integer, text[], uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> 'e8bf25e59bb8c5eaec2d4b1c9f3514a0011d86d6a98e29a27896de8cf22f5166' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.bot_updates_poll_internal'; END IF;
  IF to_regprocedure('private.normalize_message_mentions()') IS NOT NULL THEN RAISE EXCEPTION 'mentions_already_applied'; END IF;
  IF (SELECT encode(sha256(convert_to(string_agg(t.tgrelid::regclass::text||':'||t.tgname||':'||t.tgenabled::text||':'||pg_get_triggerdef(t.oid),E'\n' ORDER BY t.tgrelid::regclass::text,t.tgname),'UTF8')),'hex') FROM pg_trigger t WHERE t.tgrelid IN('public.messages'::regclass,'public.notifications'::regclass) AND NOT t.tgisinternal) IS DISTINCT FROM '37d48a624600be133c588efb9960393dbb5c178515808cc78b37389ea59c9401'
     OR (SELECT encode(sha256(convert_to(string_agg(policy_row.polname||':'||policy_row.polcmd::text||':'||policy_row.polpermissive::text||':'||array_to_string(ARRAY(SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END FROM unnest(policy_row.polroles) r ORDER BY r),',')||':'||coalesce(pg_get_expr(policy_row.polqual,policy_row.polrelid),'')||':'||coalesce(pg_get_expr(policy_row.polwithcheck,policy_row.polrelid),''),E'\n' ORDER BY policy_row.polname),'UTF8')),'hex') FROM pg_policy policy_row WHERE policy_row.polrelid='public.notifications'::regclass) IS DISTINCT FROM '20af8387c3cee003482cc8939d4f0b343e367f95153f87e440176a4a48db2499' THEN
    RAISE EXCEPTION 'mentions_catalog_prestate_drift';
  END IF;
END
$prestate$;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS mention_entities jsonb NOT NULL
  DEFAULT '{"version":1,"revision":null,"items":[]}'::jsonb;

CREATE FUNCTION private.mention_utf16_length(p_text text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT coalesce(sum(CASE WHEN ascii(substring(p_text FROM i FOR 1)) > 65535 THEN 2 ELSE 1 END),0)::integer
  FROM generate_series(1,char_length(coalesce(p_text,''))) i;
$fn$;

CREATE FUNCTION private.mention_utf16_slice(p_text text, p_offset integer, p_length integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE units bigint := 0; start_at integer; finish_at integer; i integer;
BEGIN
  IF p_offset < 0 OR p_length <= 0 OR p_offset IS NULL OR p_length IS NULL THEN RETURN NULL; END IF;
  FOR i IN 1..char_length(coalesce(p_text,'')) LOOP
    IF units = p_offset THEN start_at := i; END IF;
    IF units = p_offset::bigint + p_length THEN finish_at := i; EXIT; END IF;
    units := units + CASE WHEN ascii(substring(p_text FROM i FOR 1)) > 65535 THEN 2 ELSE 1 END;
  END LOOP;
  IF units = p_offset::bigint + p_length AND finish_at IS NULL THEN finish_at := char_length(coalesce(p_text,''))+1; END IF;
  IF start_at IS NULL OR finish_at IS NULL THEN RETURN NULL; END IF;
  RETURN substring(p_text FROM start_at FOR finish_at-start_at);
END
$fn$;

-- Unicode 17.0 category ranges generated from Node's built-in Unicode property
-- engine (tests/rehearsal/member-mentions/unicode.test.mjs verifies every scalar).
CREATE FUNCTION private.mention_unicode_class(p_code integer, p_class text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT CASE p_class
    WHEN 'nonvisible' THEN p_code <@ '{[32,33),[160,161),[173,174),[768,880),[1155,1162),[1425,1470),[1471,1472),[1473,1475),[1476,1478),[1479,1480),[1536,1542),[1552,1563),[1564,1565),[1611,1632),[1648,1649),[1750,1758),[1759,1765),[1767,1769),[1770,1774),[1807,1808),[1809,1810),[1840,1867),[1958,1969),[2027,2036),[2045,2046),[2070,2074),[2075,2084),[2085,2088),[2089,2094),[2137,2140),[2192,2194),[2199,2208),[2250,2308),[2362,2365),[2366,2384),[2385,2392),[2402,2404),[2433,2436),[2492,2493),[2494,2501),[2503,2505),[2507,2510),[2519,2520),[2530,2532),[2558,2559),[2561,2564),[2620,2621),[2622,2627),[2631,2633),[2635,2638),[2641,2642),[2672,2674),[2677,2678),[2689,2692),[2748,2749),[2750,2758),[2759,2762),[2763,2766),[2786,2788),[2810,2816),[2817,2820),[2876,2877),[2878,2885),[2887,2889),[2891,2894),[2901,2904),[2914,2916),[2946,2947),[3006,3011),[3014,3017),[3018,3022),[3031,3032),[3072,3077),[3132,3133),[3134,3141),[3142,3145),[3146,3150),[3157,3159),[3170,3172),[3201,3204),[3260,3261),[3262,3269),[3270,3273),[3274,3278),[3285,3287),[3298,3300),[3315,3316),[3328,3332),[3387,3389),[3390,3397),[3398,3401),[3402,3406),[3415,3416),[3426,3428),[3457,3460),[3530,3531),[3535,3541),[3542,3543),[3544,3552),[3570,3572),[3633,3634),[3636,3643),[3655,3663),[3761,3762),[3764,3773),[3784,3791),[3864,3866),[3893,3894),[3895,3896),[3897,3898),[3902,3904),[3953,3973),[3974,3976),[3981,3992),[3993,4029),[4038,4039),[4139,4159),[4182,4186),[4190,4193),[4194,4197),[4199,4206),[4209,4213),[4226,4238),[4239,4240),[4250,4254),[4957,4960),[5760,5761),[5906,5910),[5938,5941),[5970,5972),[6002,6004),[6068,6100),[6109,6110),[6155,6160),[6277,6279),[6313,6314),[6432,6444),[6448,6460),[6679,6684),[6741,6751),[6752,6781),[6783,6784),[6832,6878),[6880,6892),[6912,6917),[6964,6981),[7019,7028),[7040,7043),[7073,7086),[7142,7156),[7204,7224),[7376,7379),[7380,7401),[7405,7406),[7412,7413),[7415,7418),[7616,7680),[8192,8208),[8232,8240),[8287,8293),[8294,8304),[8400,8433),[11503,11506),[11647,11648),[11744,11776),[12288,12289),[12330,12336),[12441,12443),[42607,42611),[42612,42622),[42654,42656),[42736,42738),[43010,43011),[43014,43015),[43019,43020),[43043,43048),[43052,43053),[43136,43138),[43188,43206),[43232,43250),[43263,43264),[43302,43310),[43335,43348),[43392,43396),[43443,43457),[43493,43494),[43561,43575),[43587,43588),[43596,43598),[43643,43646),[43696,43697),[43698,43701),[43703,43705),[43710,43712),[43713,43714),[43755,43760),[43765,43767),[44003,44011),[44012,44014),[64286,64287),[65024,65040),[65056,65072),[65279,65280),[65529,65532),[66045,66046),[66272,66273),[66422,66427),[68097,68100),[68101,68103),[68108,68112),[68152,68155),[68159,68160),[68325,68327),[68900,68904),[68969,68974),[69291,69293),[69370,69376),[69446,69457),[69506,69510),[69632,69635),[69688,69703),[69744,69745),[69747,69749),[69759,69763),[69808,69819),[69821,69822),[69826,69827),[69837,69838),[69888,69891),[69927,69941),[69957,69959),[70003,70004),[70016,70019),[70067,70081),[70089,70093),[70094,70096),[70188,70200),[70206,70207),[70209,70210),[70367,70379),[70400,70404),[70459,70461),[70462,70469),[70471,70473),[70475,70478),[70487,70488),[70498,70500),[70502,70509),[70512,70517),[70584,70593),[70594,70595),[70597,70598),[70599,70603),[70604,70609),[70610,70611),[70625,70627),[70709,70727),[70750,70751),[70832,70852),[71087,71094),[71096,71105),[71132,71134),[71216,71233),[71339,71352),[71453,71468),[71724,71739),[71984,71990),[71991,71993),[71995,71999),[72000,72001),[72002,72004),[72145,72152),[72154,72161),[72164,72165),[72193,72203),[72243,72250),[72251,72255),[72263,72264),[72273,72284),[72330,72346),[72544,72552),[72751,72759),[72760,72768),[72850,72872),[72873,72887),[73009,73015),[73018,73019),[73020,73022),[73023,73030),[73031,73032),[73098,73103),[73104,73106),[73107,73112),[73459,73463),[73472,73474),[73475,73476),[73524,73531),[73534,73539),[73562,73563),[78896,78913),[78919,78934),[90398,90416),[92912,92917),[92976,92983),[94031,94032),[94033,94088),[94095,94099),[94180,94181),[94192,94194),[113821,113823),[113824,113828),[118528,118574),[118576,118599),[119141,119146),[119149,119171),[119173,119180),[119210,119214),[119362,119365),[121344,121399),[121403,121453),[121461,121462),[121476,121477),[121499,121504),[121505,121520),[122880,122887),[122888,122905),[122907,122914),[122915,122917),[122918,122923),[123023,123024),[123184,123191),[123566,123567),[123628,123632),[124140,124144),[124398,124400),[124643,124644),[124646,124647),[124654,124656),[124661,124662),[125136,125143),[125252,125259),[917505,917506),[917536,917632),[917760,918000)}'::int4multirange
    WHEN 'letter_number' THEN p_code <@ '{[48,58),[65,91),[97,123),[170,171),[178,180),[181,182),[185,187),[188,191),[192,215),[216,247),[248,706),[710,722),[736,741),[748,749),[750,751),[880,885),[886,888),[890,894),[895,896),[902,903),[904,907),[908,909),[910,930),[931,1014),[1015,1154),[1162,1328),[1329,1367),[1369,1370),[1376,1417),[1488,1515),[1519,1523),[1568,1611),[1632,1642),[1646,1648),[1649,1748),[1749,1750),[1765,1767),[1774,1789),[1791,1792),[1808,1809),[1810,1840),[1869,1958),[1969,1970),[1984,2027),[2036,2038),[2042,2043),[2048,2070),[2074,2075),[2084,2085),[2088,2089),[2112,2137),[2144,2155),[2160,2184),[2185,2192),[2208,2250),[2308,2362),[2365,2366),[2384,2385),[2392,2402),[2406,2416),[2417,2433),[2437,2445),[2447,2449),[2451,2473),[2474,2481),[2482,2483),[2486,2490),[2493,2494),[2510,2511),[2524,2526),[2527,2530),[2534,2546),[2548,2554),[2556,2557),[2565,2571),[2575,2577),[2579,2601),[2602,2609),[2610,2612),[2613,2615),[2616,2618),[2649,2653),[2654,2655),[2662,2672),[2674,2677),[2693,2702),[2703,2706),[2707,2729),[2730,2737),[2738,2740),[2741,2746),[2749,2750),[2768,2769),[2784,2786),[2790,2800),[2809,2810),[2821,2829),[2831,2833),[2835,2857),[2858,2865),[2866,2868),[2869,2874),[2877,2878),[2908,2910),[2911,2914),[2918,2928),[2929,2936),[2947,2948),[2949,2955),[2958,2961),[2962,2966),[2969,2971),[2972,2973),[2974,2976),[2979,2981),[2984,2987),[2990,3002),[3024,3025),[3046,3059),[3077,3085),[3086,3089),[3090,3113),[3114,3130),[3133,3134),[3160,3163),[3164,3166),[3168,3170),[3174,3184),[3192,3199),[3200,3201),[3205,3213),[3214,3217),[3218,3241),[3242,3252),[3253,3258),[3261,3262),[3292,3295),[3296,3298),[3302,3312),[3313,3315),[3332,3341),[3342,3345),[3346,3387),[3389,3390),[3406,3407),[3412,3415),[3416,3426),[3430,3449),[3450,3456),[3461,3479),[3482,3506),[3507,3516),[3517,3518),[3520,3527),[3558,3568),[3585,3633),[3634,3636),[3648,3655),[3664,3674),[3713,3715),[3716,3717),[3718,3723),[3724,3748),[3749,3750),[3751,3761),[3762,3764),[3773,3774),[3776,3781),[3782,3783),[3792,3802),[3804,3808),[3840,3841),[3872,3892),[3904,3912),[3913,3949),[3976,3981),[4096,4139),[4159,4170),[4176,4182),[4186,4190),[4193,4194),[4197,4199),[4206,4209),[4213,4226),[4238,4239),[4240,4250),[4256,4294),[4295,4296),[4301,4302),[4304,4347),[4348,4681),[4682,4686),[4688,4695),[4696,4697),[4698,4702),[4704,4745),[4746,4750),[4752,4785),[4786,4790),[4792,4799),[4800,4801),[4802,4806),[4808,4823),[4824,4881),[4882,4886),[4888,4955),[4969,4989),[4992,5008),[5024,5110),[5112,5118),[5121,5741),[5743,5760),[5761,5787),[5792,5867),[5870,5881),[5888,5906),[5919,5938),[5952,5970),[5984,5997),[5998,6001),[6016,6068),[6103,6104),[6108,6109),[6112,6122),[6128,6138),[6160,6170),[6176,6265),[6272,6277),[6279,6313),[6314,6315),[6320,6390),[6400,6431),[6470,6510),[6512,6517),[6528,6572),[6576,6602),[6608,6619),[6656,6679),[6688,6741),[6784,6794),[6800,6810),[6823,6824),[6917,6964),[6981,6989),[6992,7002),[7043,7073),[7086,7142),[7168,7204),[7232,7242),[7245,7294),[7296,7307),[7312,7355),[7357,7360),[7401,7405),[7406,7412),[7413,7415),[7418,7419),[7424,7616),[7680,7958),[7960,7966),[7968,8006),[8008,8014),[8016,8024),[8025,8026),[8027,8028),[8029,8030),[8031,8062),[8064,8117),[8118,8125),[8126,8127),[8130,8133),[8134,8141),[8144,8148),[8150,8156),[8160,8173),[8178,8181),[8182,8189),[8304,8306),[8308,8314),[8319,8330),[8336,8349),[8450,8451),[8455,8456),[8458,8468),[8469,8470),[8473,8478),[8484,8485),[8486,8487),[8488,8489),[8490,8494),[8495,8506),[8508,8512),[8517,8522),[8526,8527),[8528,8586),[9312,9372),[9450,9472),[10102,10132),[11264,11493),[11499,11503),[11506,11508),[11517,11518),[11520,11558),[11559,11560),[11565,11566),[11568,11624),[11631,11632),[11648,11671),[11680,11687),[11688,11695),[11696,11703),[11704,11711),[11712,11719),[11720,11727),[11728,11735),[11736,11743),[11823,11824),[12293,12296),[12321,12330),[12337,12342),[12344,12349),[12353,12439),[12445,12448),[12449,12539),[12540,12544),[12549,12592),[12593,12687),[12690,12694),[12704,12736),[12784,12800),[12832,12842),[12872,12880),[12881,12896),[12928,12938),[12977,12992),[13312,19904),[19968,42125),[42192,42238),[42240,42509),[42512,42540),[42560,42607),[42623,42654),[42656,42736),[42775,42784),[42786,42889),[42891,42973),[42993,43010),[43011,43014),[43015,43019),[43020,43043),[43056,43062),[43072,43124),[43138,43188),[43216,43226),[43250,43256),[43259,43260),[43261,43263),[43264,43302),[43312,43335),[43360,43389),[43396,43443),[43471,43482),[43488,43493),[43494,43519),[43520,43561),[43584,43587),[43588,43596),[43600,43610),[43616,43639),[43642,43643),[43646,43696),[43697,43698),[43701,43703),[43705,43710),[43712,43713),[43714,43715),[43739,43742),[43744,43755),[43762,43765),[43777,43783),[43785,43791),[43793,43799),[43808,43815),[43816,43823),[43824,43867),[43868,43882),[43888,44003),[44016,44026),[44032,55204),[55216,55239),[55243,55292),[63744,64110),[64112,64218),[64256,64263),[64275,64280),[64285,64286),[64287,64297),[64298,64311),[64312,64317),[64318,64319),[64320,64322),[64323,64325),[64326,64434),[64467,64830),[64848,64912),[64914,64968),[65008,65020),[65136,65141),[65142,65277),[65296,65306),[65313,65339),[65345,65371),[65382,65471),[65474,65480),[65482,65488),[65490,65496),[65498,65501),[65536,65548),[65549,65575),[65576,65595),[65596,65598),[65599,65614),[65616,65630),[65664,65787),[65799,65844),[65856,65913),[65930,65932),[66176,66205),[66208,66257),[66273,66300),[66304,66340),[66349,66379),[66384,66422),[66432,66462),[66464,66500),[66504,66512),[66513,66518),[66560,66718),[66720,66730),[66736,66772),[66776,66812),[66816,66856),[66864,66916),[66928,66939),[66940,66955),[66956,66963),[66964,66966),[66967,66978),[66979,66994),[66995,67002),[67003,67005),[67008,67060),[67072,67383),[67392,67414),[67424,67432),[67456,67462),[67463,67505),[67506,67515),[67584,67590),[67592,67593),[67594,67638),[67639,67641),[67644,67645),[67647,67670),[67672,67703),[67705,67743),[67751,67760),[67808,67827),[67828,67830),[67835,67868),[67872,67898),[67904,67930),[67968,68024),[68028,68048),[68050,68097),[68112,68116),[68117,68120),[68121,68150),[68160,68169),[68192,68223),[68224,68256),[68288,68296),[68297,68325),[68331,68336),[68352,68406),[68416,68438),[68440,68467),[68472,68498),[68521,68528),[68608,68681),[68736,68787),[68800,68851),[68858,68900),[68912,68922),[68928,68966),[68975,68998),[69216,69247),[69248,69290),[69296,69298),[69314,69320),[69376,69416),[69424,69446),[69457,69461),[69488,69506),[69552,69580),[69600,69623),[69635,69688),[69714,69744),[69745,69747),[69749,69750),[69763,69808),[69840,69865),[69872,69882),[69891,69927),[69942,69952),[69956,69957),[69959,69960),[69968,70003),[70006,70007),[70019,70067),[70081,70085),[70096,70107),[70108,70109),[70113,70133),[70144,70162),[70163,70188),[70207,70209),[70272,70279),[70280,70281),[70282,70286),[70287,70302),[70303,70313),[70320,70367),[70384,70394),[70405,70413),[70415,70417),[70419,70441),[70442,70449),[70450,70452),[70453,70458),[70461,70462),[70480,70481),[70493,70498),[70528,70538),[70539,70540),[70542,70543),[70544,70582),[70583,70584),[70609,70610),[70611,70612),[70656,70709),[70727,70731),[70736,70746),[70751,70754),[70784,70832),[70852,70854),[70855,70856),[70864,70874),[71040,71087),[71128,71132),[71168,71216),[71236,71237),[71248,71258),[71296,71339),[71352,71353),[71360,71370),[71376,71396),[71424,71451),[71472,71484),[71488,71495),[71680,71724),[71840,71923),[71935,71943),[71945,71946),[71948,71956),[71957,71959),[71960,71984),[71999,72000),[72001,72002),[72016,72026),[72096,72104),[72106,72145),[72161,72162),[72163,72164),[72192,72193),[72203,72243),[72250,72251),[72272,72273),[72284,72330),[72349,72350),[72368,72441),[72640,72673),[72688,72698),[72704,72713),[72714,72751),[72768,72769),[72784,72813),[72818,72848),[72960,72967),[72968,72970),[72971,73009),[73030,73031),[73040,73050),[73056,73062),[73063,73065),[73066,73098),[73112,73113),[73120,73130),[73136,73180),[73184,73194),[73440,73459),[73474,73475),[73476,73489),[73490,73524),[73552,73562),[73648,73649),[73664,73685),[73728,74650),[74752,74863),[74880,75076),[77712,77809),[77824,78896),[78913,78919),[78944,82939),[82944,83527),[90368,90398),[90416,90426),[92160,92729),[92736,92767),[92768,92778),[92784,92863),[92864,92874),[92880,92910),[92928,92976),[92992,92996),[93008,93018),[93019,93026),[93027,93048),[93053,93072),[93504,93549),[93552,93562),[93760,93847),[93856,93881),[93883,93908),[93952,94027),[94032,94033),[94099,94112),[94176,94178),[94179,94180),[94194,94199),[94208,101590),[101631,101663),[101760,101875),[110576,110580),[110581,110588),[110589,110591),[110592,110883),[110898,110899),[110928,110931),[110933,110934),[110948,110952),[110960,111356),[113664,113771),[113776,113789),[113792,113801),[113808,113818),[118000,118010),[119488,119508),[119520,119540),[119648,119673),[119808,119893),[119894,119965),[119966,119968),[119970,119971),[119973,119975),[119977,119981),[119982,119994),[119995,119996),[119997,120004),[120005,120070),[120071,120075),[120077,120085),[120086,120093),[120094,120122),[120123,120127),[120128,120133),[120134,120135),[120138,120145),[120146,120486),[120488,120513),[120514,120539),[120540,120571),[120572,120597),[120598,120629),[120630,120655),[120656,120687),[120688,120713),[120714,120745),[120746,120771),[120772,120780),[120782,120832),[122624,122655),[122661,122667),[122928,122990),[123136,123181),[123191,123198),[123200,123210),[123214,123215),[123536,123566),[123584,123628),[123632,123642),[124112,124140),[124144,124154),[124368,124398),[124400,124411),[124608,124639),[124640,124643),[124644,124646),[124647,124654),[124656,124661),[124670,124672),[124896,124903),[124904,124908),[124909,124911),[124912,124927),[124928,125125),[125127,125136),[125184,125252),[125259,125260),[125264,125274),[126065,126124),[126125,126128),[126129,126133),[126209,126254),[126255,126270),[126464,126468),[126469,126496),[126497,126499),[126500,126501),[126503,126504),[126505,126515),[126516,126520),[126521,126522),[126523,126524),[126530,126531),[126535,126536),[126537,126538),[126539,126540),[126541,126544),[126545,126547),[126548,126549),[126551,126552),[126553,126554),[126555,126556),[126557,126558),[126559,126560),[126561,126563),[126564,126565),[126567,126571),[126572,126579),[126580,126584),[126585,126589),[126590,126591),[126592,126602),[126603,126620),[126625,126628),[126629,126634),[126635,126652),[127232,127245),[130032,130042),[131072,173792),[173824,178206),[178208,183982),[183984,191457),[191472,192094),[194560,195102),[196608,201547),[201552,210042)}'::int4multirange
    ELSE false END;
$fn$;

CREATE FUNCTION private.mention_label_valid(p_label text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE i integer; code integer; visible boolean := false;
BEGIN
  IF p_label IS NULL OR left(p_label,1)<>'@' OR private.mention_utf16_length(p_label)>128 THEN RETURN false; END IF;
  FOR i IN 2..char_length(p_label) LOOP
    code := ascii(substring(p_label FROM i FOR 1));
    IF code < 32 OR code BETWEEN 127 AND 159 OR code IN (8232,8233,8203,8206,8207,8288,65279)
       OR code BETWEEN 8234 AND 8238 OR code BETWEEN 8288 AND 8303 THEN RETURN false; END IF;
    IF NOT private.mention_unicode_class(code,'nonvisible') THEN visible:=true; END IF;
  END LOOP;
  code := ascii(right(p_label,1));
  IF code IN (9,10,11,12,13,32,160,5760,8232,8233,8239,8287,12288,65279)
     OR code BETWEEN 8192 AND 8202 THEN RETURN false; END IF;
  RETURN visible;
END
$fn$;

CREATE FUNCTION private.mention_context_masked(p_text text, p_offset integer, p_length integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE n integer := char_length(coalesce(p_text,'')); i integer:=1; j integer; k integer;
  run integer; closing integer; last_at integer; line_end integer; line_start integer;
  line text; token text[]; fences int4range[] := ARRAY[]::int4range[]; fence int4range;
  start_at integer; end_at integer; units integer:=0; target_start integer; target_end integer;
  slashes integer; delimiter text; pos integer; hit integer; dots integer; code integer;
  whitespace text:=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)
    ||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)
    ||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
  letter text:='a-zA-Z'||chr(383)||chr(8490);
BEGIN
  FOR i IN 1..n+1 LOOP
    IF units=p_offset THEN target_start:=i; END IF;
    IF units=p_offset+p_length THEN target_end:=i; EXIT; END IF;
    IF i<=n THEN units:=units+CASE WHEN ascii(substring(p_text FROM i FOR 1))>65535 THEN 2 ELSE 1 END; END IF;
  END LOOP;
  IF target_start IS NULL OR target_end IS NULL THEN RETURN true; END IF;
  -- Line-anchored fences: same delimiter, at least the opening run length.
  i:=1;
  WHILE i<=n LOOP
    line_end:=strpos(substring(p_text FROM i),chr(10));
    IF line_end=0 THEN line_end:=n+1; ELSE line_end:=i+line_end-1; END IF;
    line:=substring(p_text FROM i FOR line_end-i);
    token:=regexp_match(line,'^ {0,3}(`{3,}|~{3,})');
    IF token IS NOT NULL THEN
      delimiter:=left(token[1],1); run:=char_length(token[1]); j:=line_end+1; last_at:=n+1;
      WHILE j<=n LOOP
        closing:=strpos(substring(p_text FROM j),chr(10));
        IF closing=0 THEN closing:=n+1; ELSE closing:=j+closing-1; END IF;
        IF substring(p_text FROM j FOR closing-j) ~ ('^ {0,3}'||delimiter||'{'||run||',}[ '||chr(9)||']*'||chr(13)||'?$') THEN
          last_at:=least(closing+1,n+1); EXIT;
        END IF;
        j:=closing+1;
      END LOOP;
      fences:=array_append(fences,int4range(i,last_at));
      IF target_start<last_at AND target_end>i THEN RETURN true; END IF;
      i:=last_at;
    ELSE i:=line_end+1; END IF;
  END LOOP;
  -- Inline runs cannot cross a newline; odd backslash escaping disables a run.
  i:=1;
  WHILE i<=n LOOP
    IF substring(p_text FROM i FOR 1)<>chr(96) THEN i:=i+1; CONTINUE; END IF;
    run:=1; WHILE substring(p_text FROM i+run FOR 1)=chr(96) LOOP run:=run+1; END LOOP;
    IF EXISTS(SELECT 1 FROM unnest(fences) f WHERE f && int4range(i,i+run)) THEN i:=i+run; CONTINUE; END IF;
    slashes:=0; j:=i-1; WHILE j>0 AND substring(p_text FROM j FOR 1)=chr(92) LOOP slashes:=slashes+1; j:=j-1; END LOOP;
    IF slashes%2=1 THEN i:=i+run; CONTINUE; END IF;
    line_end:=strpos(substring(p_text FROM i+run),chr(10));
    IF line_end=0 THEN line_end:=n+1; ELSE line_end:=i+run+line_end-1; END IF;
    last_at:=line_end; j:=i+run;
    WHILE j<line_end LOOP
      IF substring(p_text FROM j FOR 1)=chr(96) THEN
        closing:=1; WHILE substring(p_text FROM j+closing FOR 1)=chr(96) LOOP closing:=closing+1; END LOOP;
        slashes:=0; k:=j-1; WHILE k>0 AND substring(p_text FROM k FOR 1)=chr(92) LOOP slashes:=slashes+1; k:=k-1; END LOOP;
        IF closing=run AND slashes%2=0 THEN last_at:=j+closing; EXIT; END IF;
        j:=j+closing;
      ELSE j:=j+1; END IF;
    END LOOP;
    IF target_start<last_at AND target_end>i THEN RETURN true; END IF;
    i:=last_at;
  END LOOP;
  -- URLs and commands use the same boundaries as the settled pure API.
  pos:=1;
  FOR token IN SELECT regexp_matches(p_text,'(([hH][tT][tT][pP][sS'||chr(383)||']?://|[wW][wW][wW][.])[^'||whitespace||'<>'||chr(96)||']+)','g') LOOP
    hit:=pos+strpos(substring(p_text FROM pos),token[1])-1;
    IF hit=1 OR substring(p_text FROM hit-1 FOR 1) !~ ('['||letter||'0-9_]') THEN
      IF target_start<hit+char_length(token[1]) AND target_end>hit THEN RETURN true; END IF;
    END IF;
    pos:=hit+char_length(token[1]);
  END LOOP;
  pos:=1;
  FOR token IN SELECT regexp_matches(p_text,'((^|['||whitespace||'(*~\[])/['||letter||']['||letter||'0-9_]*(@['||letter||'0-9_]*)?)','g') LOOP
    hit:=pos+strpos(substring(p_text FROM pos),token[1])-1;
    IF target_start<hit+char_length(token[1]) AND target_end>hit THEN RETURN true; END IF;
    pos:=hit+char_length(token[1]);
  END LOOP;
  -- Unicode L/N email atoms: use the reference engine's categories, not locale
  -- alphabetic classes (which differ for marks and recently assigned scalars).
  FOR i IN 1..n LOOP
    IF substring(p_text FROM i FOR 1)<>'@' THEN CONTINUE; END IF;
    j:=i-1;
    WHILE j>0 LOOP
      code:=ascii(substring(p_text FROM j FOR 1));
      EXIT WHEN NOT private.mention_unicode_class(code,'letter_number') AND strpos('._%+-',chr(code))=0;
      j:=j-1;
    END LOOP;
    IF j=i-1 THEN CONTINUE; END IF;
    start_at:=j+1; j:=i+1; dots:=0; end_at:=NULL;
    WHILE j<=n LOOP
      k:=j;
      WHILE j<=n LOOP
        code:=ascii(substring(p_text FROM j FOR 1));
        EXIT WHEN NOT private.mention_unicode_class(code,'letter_number') AND code<>45;
        j:=j+1;
      END LOOP;
      EXIT WHEN j=k;
      IF dots>0 THEN end_at:=j; END IF;
      EXIT WHEN substring(p_text FROM j FOR 1)<>'.';
      dots:=dots+1; j:=j+1;
    END LOOP;
    IF end_at IS NOT NULL AND target_start<end_at AND target_end>start_at THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END
$fn$;

CREATE FUNCTION private.validate_message_mentions(p_text text, p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE item jsonb; items jsonb := '[]'::jsonb; off integer; len integer; previous_end bigint := 0;
  label text; target_key text; ch text; revision text;
BEGIN
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object'
     OR NOT (p_data ?& ARRAY['version','revision','items'])
     OR p_data - ARRAY['version','revision','items'] <> '{}'::jsonb
     OR p_data->'version' IS DISTINCT FROM '1'::jsonb
     OR jsonb_typeof(p_data->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_message_mentions' USING ERRCODE='22023';
  END IF;
  revision := p_data->>'revision';
  IF jsonb_typeof(p_data->'revision') NOT IN ('null','string')
     OR (revision IS NOT NULL AND revision !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR jsonb_array_length(p_data->'items') > 32
     OR (jsonb_array_length(p_data->'items') > 0 AND revision IS NULL) THEN
    RAISE EXCEPTION 'invalid_message_mentions' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_data->'items') LOOP
    target_key := CASE item->>'kind' WHEN 'user' THEN 'user_id' WHEN 'bot' THEN 'bot_id' END;
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR target_key IS NULL
       OR NOT (item ?& ARRAY['kind',target_key,'offset','length','label'])
       OR item - ARRAY['kind',target_key,'offset','length','label'] <> '{}'::jsonb
       OR jsonb_typeof(item->target_key) IS DISTINCT FROM 'string'
       OR coalesce(item->>target_key,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(item->'offset') IS DISTINCT FROM 'number'
       OR jsonb_typeof(item->'length') IS DISTINCT FROM 'number'
       OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid_message_mentions' USING ERRCODE='22023';
    END IF;
    IF (item->>'offset')::numeric < 0 OR (item->>'offset')::numeric > 2147483647
       OR (item->>'offset')::numeric <> trunc((item->>'offset')::numeric)
       OR (item->>'length')::numeric <= 0 OR (item->>'length')::numeric > 128
       OR (item->>'length')::numeric <> trunc((item->>'length')::numeric) THEN
      RAISE EXCEPTION 'invalid_message_mentions' USING ERRCODE='22023';
    END IF;
    off := (item->>'offset')::numeric::integer; len := (item->>'length')::numeric::integer; label := item->>'label';
    item := jsonb_set(jsonb_set(item,'{offset}',to_jsonb(off)),'{length}',to_jsonb(len));
    IF off < previous_end OR NOT private.mention_label_valid(label)
       OR private.mention_utf16_slice(p_text,off,len) IS DISTINCT FROM label THEN
      RAISE EXCEPTION 'invalid_message_mentions' USING ERRCODE='22023';
    END IF;
    FOR ch IN SELECT substring(label FROM i FOR 1) FROM generate_series(1,char_length(label)) i LOOP
      IF ascii(ch) < 32 OR ascii(ch) BETWEEN 127 AND 159 OR ascii(ch) IN (8232,8233) THEN
        RAISE EXCEPTION 'invalid_message_mentions' USING ERRCODE='22023';
      END IF;
    END LOOP;
    previous_end := off::bigint+len;
    IF NOT private.mention_context_masked(p_text,off,len) THEN
      item := jsonb_set(item,ARRAY[target_key],to_jsonb((item->>target_key)::uuid::text));
      items := items || jsonb_build_array(item);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('version',1,'revision',revision,'items',items);
END
$fn$;

CREATE FUNCTION private.message_mentions_targeted(p_data jsonb, p_kind text, p_id uuid) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_data->'items')='array' THEN p_data->'items' ELSE '[]'::jsonb END) item
    WHERE item->>'kind'=p_kind
      AND item->>(CASE p_kind WHEN 'user' THEN 'user_id' WHEN 'bot' THEN 'bot_id' END)=p_id::text);
$fn$;

CREATE FUNCTION private.mention_historical_item(p_old_text text,p_new_text text,p_old jsonb,p_new jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE prefix integer:=0; old_finish integer:=char_length(coalesce(p_old_text,'')); new_finish integer:=char_length(coalesce(p_new_text,''));
  edit_start integer; edit_end integer; delta integer; old_offset integer:=(p_old->>'offset')::integer; expected integer;
BEGIN
  IF p_old-'offset' IS DISTINCT FROM p_new-'offset' THEN RETURN false; END IF;
  WHILE prefix<least(old_finish,new_finish)
    AND substring(p_old_text FROM prefix+1 FOR 1)=substring(p_new_text FROM prefix+1 FOR 1) LOOP prefix:=prefix+1; END LOOP;
  WHILE old_finish>prefix AND new_finish>prefix
    AND substring(p_old_text FROM old_finish FOR 1)=substring(p_new_text FROM new_finish FOR 1) LOOP old_finish:=old_finish-1; new_finish:=new_finish-1; END LOOP;
  edit_start:=private.mention_utf16_length(substring(p_old_text FROM 1 FOR prefix));
  edit_end:=private.mention_utf16_length(substring(p_old_text FROM 1 FOR old_finish));
  delta:=private.mention_utf16_length(p_new_text)-private.mention_utf16_length(p_old_text);
  IF edit_end<=old_offset THEN expected:=old_offset+delta;
  ELSIF edit_start>=old_offset+(p_old->>'length')::integer THEN expected:=old_offset;
  ELSE RETURN false; END IF;
  RETURN (p_new->>'offset')::integer=expected;
END
$fn$;

CREATE FUNCTION private.normalize_message_mentions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE checked jsonb; item jsonb; kept jsonb := '[]'::jsonb; historical boolean; old_data jsonb;
BEGIN
  IF new.deleted_at IS NOT NULL OR new.forwarded_from_id IS NOT NULL THEN
    new.mention_entities := '{"version":1,"revision":null,"items":[]}'::jsonb; RETURN new;
  END IF;
  IF new.topic_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.topics t WHERE t.id=new.topic_id AND t.chat_id=new.chat_id) THEN
    RAISE EXCEPTION 'invalid_message_topic' USING ERRCODE='22023';
  END IF;
  IF tg_op='UPDATE' THEN
    old_data := old.mention_entities;
    IF new.content IS DISTINCT FROM old.content AND new.mention_entities IS NOT DISTINCT FROM old.mention_entities THEN
      new.mention_entities := '{"version":1,"revision":null,"items":[]}'::jsonb; RETURN new;
    END IF;
    IF new.content IS NOT DISTINCT FROM old.content AND new.mention_entities IS NOT DISTINCT FROM old.mention_entities
       AND new.chat_id IS NOT DISTINCT FROM old.chat_id THEN RETURN new; END IF;
  END IF;
  checked := private.validate_message_mentions(new.content,new.mention_entities);
  IF tg_op='UPDATE' AND checked IS DISTINCT FROM old_data
     AND (jsonb_array_length(checked->'items')>0 OR jsonb_array_length(old_data->'items')>0)
     AND (checked->>'revision' IS NULL OR (checked->>'revision')::uuid = (old_data->>'revision')::uuid) THEN
    RAISE EXCEPTION 'invalid_message_mentions_revision' USING ERRCODE='22023';
  END IF;

  -- Lock membership rows, not private recipient preferences. Bot membership locking
  -- matches the installed epoch guard; delivery independently rechecks active state.
  PERFORM 1 FROM public.chat_members cm
    WHERE cm.chat_id=new.chat_id AND cm.user_id IN (
      SELECT (value->>'user_id')::uuid FROM jsonb_array_elements(checked->'items') WHERE value->>'kind'='user')
    ORDER BY cm.user_id FOR SHARE OF cm;
  PERFORM 1 FROM public.chat_bot_members cbm
    WHERE cbm.chat_id=new.chat_id AND cbm.removed_at IS NULL AND cbm.bot_id IN (
      SELECT (value->>'bot_id')::uuid FROM jsonb_array_elements(checked->'items') WHERE value->>'kind'='bot')
    ORDER BY cbm.bot_id FOR SHARE OF cbm;

  FOR item IN SELECT value FROM jsonb_array_elements(checked->'items') LOOP
    historical := false;
    IF tg_op='UPDATE' AND new.chat_id IS NOT DISTINCT FROM old.chat_id THEN
      historical := EXISTS (SELECT 1 FROM jsonb_array_elements(old_data->'items') previous
        WHERE private.mention_historical_item(old.content,new.content,previous,item));
    END IF;
    IF historical OR (item->>'kind'='user' AND EXISTS(
        SELECT 1 FROM public.chat_members cm WHERE cm.chat_id=new.chat_id AND cm.user_id=(item->>'user_id')::uuid))
      OR (item->>'kind'='bot' AND EXISTS(
        SELECT 1 FROM public.chat_bot_members cbm JOIN public.bots b ON b.id=cbm.bot_id
        WHERE cbm.chat_id=new.chat_id AND cbm.bot_id=(item->>'bot_id')::uuid AND cbm.removed_at IS NULL AND b.state='active')) THEN
      kept := kept || jsonb_build_array(item);
    END IF;
  END LOOP;
  new.mention_entities := jsonb_set(checked,'{items}',kept);
  RETURN new;
END
$fn$;

CREATE FUNCTION private.message_notification_visible_to(p_message_id uuid,p_recipient_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS(
    SELECT 1 FROM public.messages m JOIN public.chats c ON c.id=m.chat_id
    JOIN public.chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=p_recipient_id
    WHERE m.id=p_message_id AND m.deleted_at IS NULL AND coalesce(m.type,'text') <> 'system'
      AND (m.user_id IS NOT NULL OR m.bot_id IS NOT NULL)
      AND m.user_id IS DISTINCT FROM p_recipient_id
      AND m.created_at >= cm.joined_at AND cm.hidden_at IS NULL
      AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
      AND NOT public.is_banned(p_recipient_id)
      AND (m.topic_id IS NULL OR EXISTS(SELECT 1 FROM public.topics t WHERE t.id=m.topic_id AND t.chat_id=m.chat_id))
      AND NOT EXISTS(SELECT 1 FROM public.message_hidden_for_users h WHERE h.message_id=m.id AND h.user_id=p_recipient_id)
      AND NOT EXISTS(SELECT 1 FROM public.user_blocks b WHERE b.blocker_id=p_recipient_id AND b.blocked_id=m.user_id));
$fn$;

CREATE FUNCTION public.message_notification_visible(p_message_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL AND private.message_notification_visible_to(p_message_id,auth.uid());
$fn$;

CREATE FUNCTION private.update_message_mention_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF new.mention_entities IS NOT DISTINCT FROM old.mention_entities
     AND new.deleted_at IS NOT DISTINCT FROM old.deleted_at THEN RETURN NULL; END IF;
  UPDATE public.notifications n
    SET payload=n.payload || jsonb_build_object('mentioned',
      new.deleted_at IS NULL AND private.message_mentions_targeted(new.mention_entities,'user',n.user_id))
    WHERE n.kind='message' AND n.payload->>'message_id'=new.id::text;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER trg_member_mentions_validate BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.normalize_message_mentions();
CREATE TRIGGER trg_member_mentions_note_update AFTER UPDATE OF content, mention_entities, deleted_at ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.update_message_mention_notification();
CREATE POLICY "message notification source remains readable" ON public.notifications AS RESTRICTIVE
  FOR SELECT TO authenticated USING (kind <> 'message' OR CASE
    WHEN payload->>'message_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.message_notification_visible((payload->>'message_id')::uuid) ELSE false END);

ALTER FUNCTION private.mention_utf16_length(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.mention_utf16_length(text) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.mention_utf16_slice(text,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.mention_utf16_slice(text,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.mention_context_masked(text,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.mention_context_masked(text,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.mention_unicode_class(integer,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.mention_unicode_class(integer,text) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.mention_label_valid(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.mention_label_valid(text) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.mention_historical_item(text,text,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.mention_historical_item(text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.validate_message_mentions(text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.validate_message_mentions(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.message_mentions_targeted(jsonb,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.message_mentions_targeted(jsonb,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.normalize_message_mentions() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.normalize_message_mentions() FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.message_notification_visible_to(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.message_notification_visible_to(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.update_message_mention_notification() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.update_message_mention_notification() FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.message_notification_visible(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.message_notification_visible(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.message_notification_visible(uuid) TO authenticated;

DO $patch$
DECLARE ddl text := pg_get_functiondef('public.enqueue_message_notifications()'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$'group_tag', 'message:chat:' || new.chat_id::text$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:enqueue_message_notifications:0'; END IF;
  ddl := replace(ddl,$old0$'group_tag', 'message:chat:' || new.chat_id::text$old0$,$new0$'group_tag', 'message:chat:' || new.chat_id::text,
      'mentioned', private.message_mentions_targeted(new.mention_entities, 'user', member_row.user_id)$new0$);
  IF strpos(ddl,$old1$where member_row.chat_id = new.chat_id
$old1$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:enqueue_message_notifications:1'; END IF;
  ddl := replace(ddl,$old1$where member_row.chat_id = new.chat_id
$old1$,$new1$where member_row.chat_id = new.chat_id
    and private.message_notification_visible_to(new.id, member_row.user_id)
$new1$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('public._notification_push_allowed(uuid, text, jsonb)'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$begin
  select * into v_prefs$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:_notification_push_allowed:0'; END IF;
  ddl := replace(ddl,$old0$begin
  select * into v_prefs$old0$,$new0$begin
  if p_kind = 'message' then
    if coalesce(p_payload->>'message_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
    if not private.message_notification_visible_to((p_payload->>'message_id')::uuid, p_user_id)
       or not exists (select 1 from public.messages m where m.id = (p_payload->>'message_id')::uuid
           and m.chat_id::text = p_payload->>'chat_id') then
      return false;
    end if;
  end if;
  select * into v_prefs$new0$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('public.push_outbox_delivery_recheck(uuid, uuid)'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$  v_subscription_user_id uuid;$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:push_outbox_delivery_recheck:0'; END IF;
  ddl := replace(ddl,$old0$  v_subscription_user_id uuid;$old0$,$new0$  v_subscription_user_id uuid;
  v_note_owner uuid;
  v_kind text;
  v_payload jsonb;$new0$);
  IF strpos(ddl,$old1$select o.user_id, n.read_at, s.is_active, s.user_id
  into v_user_id, v_read_at, v_subscription_active, v_subscription_user_id$old1$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:push_outbox_delivery_recheck:1'; END IF;
  ddl := replace(ddl,$old1$select o.user_id, n.read_at, s.is_active, s.user_id
  into v_user_id, v_read_at, v_subscription_active, v_subscription_user_id$old1$,$new1$select o.user_id, n.read_at, s.is_active, s.user_id, n.user_id, n.kind, n.payload
  into v_user_id, v_read_at, v_subscription_active, v_subscription_user_id, v_note_owner, v_kind, v_payload$new1$);
  IF strpos(ddl,$old2$  if exists (
    select 1
    from public.push_foreground_sessions$old2$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:push_outbox_delivery_recheck:2'; END IF;
  ddl := replace(ddl,$old2$  if exists (
    select 1
    from public.push_foreground_sessions$old2$,$new2$  if v_note_owner is distinct from v_user_id
      or not public._notification_push_allowed(v_user_id, v_kind, v_payload) then
    update public.notifications_push_outbox
    set suppressed_at = v_now, suppression_reason = NULL,
        claim_token = null, claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'not_eligible';
  end if;

  if exists (
    select 1
    from public.push_foreground_sessions$new2$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('public.native_push_outbox_delivery_recheck(uuid, uuid)'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$  v_device_active boolean;$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:native_push_outbox_delivery_recheck:0'; END IF;
  ddl := replace(ddl,$old0$  v_device_active boolean;$old0$,$new0$  v_device_active boolean;
  v_user_id uuid;
  v_kind text;
  v_payload jsonb;$new0$);
  IF strpos(ddl,$old1$  select o.claimed_until, n.read_at,$old1$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:native_push_outbox_delivery_recheck:1'; END IF;
  ddl := replace(ddl,$old1$  select o.claimed_until, n.read_at,$old1$,$new1$  select o.claimed_until, n.read_at, o.user_id, n.kind, n.payload,$new1$);
  IF strpos(ddl,$old2$into v_claimed_until, v_read_at, v_device_active$old2$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:native_push_outbox_delivery_recheck:2'; END IF;
  ddl := replace(ddl,$old2$into v_claimed_until, v_read_at, v_device_active$old2$,$new2$into v_claimed_until, v_read_at, v_user_id, v_kind, v_payload, v_device_active$new2$);
  IF strpos(ddl,$old3$  update public.notifications_native_push_outbox
  set claimed_until$old3$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:native_push_outbox_delivery_recheck:3'; END IF;
  ddl := replace(ddl,$old3$  update public.notifications_native_push_outbox
  set claimed_until$old3$,$new3$  if not public._notification_push_allowed(v_user_id, v_kind, v_payload) then
    update public.notifications_native_push_outbox
    set sent_at = v_now, last_error = 'suppressed:not_eligible',
        claim_token = null, claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'not_eligible';
  end if;

  update public.notifications_native_push_outbox
  set claimed_until$new3$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('public.album_push_recheck(uuid, uuid)'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$      and cm.hidden_at is null$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:album_push_recheck:0'; END IF;
  ddl := replace(ddl,$old0$      and cm.hidden_at is null$old0$,$new0$      and private.message_notification_visible_to(m.id, v_outbox.user_id)
      and cm.hidden_at is null$new0$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('private.bot_can_receive_message(uuid, uuid)'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$    where message_row.id = p_message_id$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:bot_can_receive_message:0'; END IF;
  ddl := replace(ddl,$old0$    where message_row.id = p_message_id$old0$,$new0$    where message_row.id = p_message_id
      and message_row.deleted_at is null$new0$);
  IF strpos(ddl,$old1$          and (
            pg_catalog.lower$old1$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:bot_can_receive_message:1'; END IF;
  ddl := replace(ddl,$old1$          and (
            pg_catalog.lower$old1$,$new1$          and (
            private.message_mentions_targeted(message_row.mention_entities, 'bot', p_bot_id)
            or pg_catalog.lower$new1$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('private.enqueue_bot_message_updates_after_update()'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$    old.bot_reply_markup
$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:enqueue_bot_message_updates_after_update:0'; END IF;
  ddl := replace(ddl,$old0$    old.bot_reply_markup
$old0$,$new0$    old.bot_reply_markup,
    old.mention_entities
$new0$);
  IF strpos(ddl,$old1$    new.bot_reply_markup
$old1$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:enqueue_bot_message_updates_after_update:1'; END IF;
  ddl := replace(ddl,$old1$    new.bot_reply_markup
$old1$,$new1$    new.bot_reply_markup,
    new.mention_entities
$new1$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('private.deleted_message_keeps_nothing()'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$  new.pinned := false;$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:deleted_message_keeps_nothing:0'; END IF;
  ddl := replace(ddl,$old0$  new.pinned := false;$old0$,$new0$  new.pinned := false;
  new.mention_entities := '{"version":1,"revision":null,"items":[]}'::jsonb;$new0$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('private.scrub_deleted_message_notifications(uuid[])'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$pg_catalog.jsonb_build_object('preview', null, 'deleted', true)$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:scrub_deleted_message_notifications:0'; END IF;
  ddl := replace(ddl,$old0$pg_catalog.jsonb_build_object('preview', null, 'deleted', true)$old0$,$new0$pg_catalog.jsonb_build_object('preview', null, 'deleted', true, 'mentioned', false)$new0$);
  EXECUTE ddl;
END
$patch$;
DROP TRIGGER trg_enqueue_bot_message_updates_after_update ON public.messages;
CREATE TRIGGER trg_enqueue_bot_message_updates_after_update AFTER UPDATE OF content, media_bucket, media_path, media_metadata, topic_id, reply_to_id, bot_reply_markup, mention_entities ON public.messages
FOR EACH ROW EXECUTE FUNCTION private.enqueue_bot_message_updates_after_update();
ALTER FUNCTION public._notification_push_allowed(uuid,text,jsonb) SECURITY DEFINER SET search_path = '';

DO $poststate$
DECLARE p pg_proc; signature text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.messages'::regclass AND a.attname='mention_entities' AND NOT a.attisdropped
      AND a.atttypid='jsonb'::regtype AND a.attnotnull
      AND pg_get_expr(d.adbin,d.adrelid)='''{"items": [], "version": 1, "revision": null}''::jsonb') THEN
    RAISE EXCEPTION 'mentions_column_incomplete';
  END IF;
  FOREACH signature IN ARRAY ARRAY['private.mention_utf16_length(text)','private.mention_utf16_slice(text,integer,integer)','private.mention_context_masked(text,integer,integer)','private.mention_unicode_class(integer,text)','private.mention_label_valid(text)','private.mention_historical_item(text,text,jsonb,jsonb)','private.validate_message_mentions(text,jsonb)','private.message_mentions_targeted(jsonb,text,uuid)','private.normalize_message_mentions()','private.message_notification_visible_to(uuid,uuid)','private.update_message_mention_notification()','public.message_notification_visible(uuid)'] LOOP
    SELECT * INTO STRICT p FROM pg_proc WHERE oid=signature::regprocedure;
    IF pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
       OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE')
       OR (has_function_privilege('authenticated',p.oid,'EXECUTE') IS DISTINCT FROM (signature='public.message_notification_visible(uuid)'))
       OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0) THEN
      RAISE EXCEPTION 'mentions_helper_permissions_incomplete';
    END IF;
    IF p.prosecdef IS DISTINCT FROM (signature IN ('private.normalize_message_mentions()','private.message_notification_visible_to(uuid,uuid)','private.update_message_mention_notification()','public.message_notification_visible(uuid)'))
       OR p.provolatile IS DISTINCT FROM (CASE
         WHEN signature IN ('private.message_notification_visible_to(uuid,uuid)','public.message_notification_visible(uuid)') THEN 's'::"char"
         WHEN signature IN ('private.normalize_message_mentions()','private.update_message_mention_notification()') THEN 'v'::"char"
         ELSE 'i'::"char" END) THEN
      RAISE EXCEPTION 'mentions_helper_security_incomplete';
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.messages'::regclass AND tgname='trg_member_mentions_validate'
      AND tgenabled='O' AND tgtype=23 AND tgfoid='private.normalize_message_mentions()'::regprocedure)
     OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.messages'::regclass AND tgname='trg_member_mentions_note_update'
      AND tgenabled='O' AND tgfoid='private.update_message_mention_notification()'::regprocedure)
     OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.notifications'::regclass
      AND polname='message notification source remains readable' AND NOT polpermissive AND polcmd='r'
      AND pg_get_expr(polqual,polrelid) LIKE '%message_notification_visible%'
      AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')])
     OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.messages'::regclass
      AND tgname='trg_enqueue_bot_message_updates_after_update' AND tgenabled='O' AND tgtype=17
      AND pg_get_triggerdef(oid) LIKE '%bot_reply_markup, mention_entities%')
     OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public._notification_push_allowed(uuid,text,jsonb)'::regprocedure
      AND prosecdef AND proconfig=ARRAY['search_path=""']
      AND NOT has_function_privilege('anon',oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'mentions_policy_trigger_incomplete';
  END IF;
  IF private.mention_utf16_slice(chr(128512)||' @User',3,5) IS DISTINCT FROM '@User'
    OR private.mention_utf16_slice(chr(128512)||' @User',1,1) IS NOT NULL
    OR private.validate_message_mentions('@User','{"version":1,"revision":"60000000-0000-4000-8000-000000000001","items":[{"kind":"user","user_id":"10000000-0000-4000-8000-000000000002","offset":0,"length":5,"label":"@User"}]}'::jsonb)->'items' IS DISTINCT FROM
      '[{"kind":"user","user_id":"10000000-0000-4000-8000-000000000002","offset":0,"length":5,"label":"@User"}]'::jsonb THEN
    RAISE EXCEPTION 'mentions_scalar_incomplete';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.messages'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.notifications'::regclass)
     OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.notifications_message_user_once_idx') AND indisunique AND indisvalid) THEN
    RAISE EXCEPTION 'mentions_existing_guards_incomplete';
  END IF;
END
$poststate$;
COMMIT;
