-- Candidate only: NOT a production migration and NOT installed by the app.
-- Rollback when eventually installed: DROP FUNCTION
-- public.message_text_cache_page_v1(uuid,text,uuid,timestamptz,uuid,text);
-- No tables/triggers/indexes or write-path work. Existing RLS stays authoritative.
CREATE FUNCTION public.message_text_cache_page_v1(
  p_chat_id uuid,
  p_scope text DEFAULT 'all',
  p_topic_id uuid DEFAULT NULL,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_if_digest text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $cache_page$
DECLARE
  v_owner uuid := auth.uid();
  v_chat_type text;
  v_cleared_at timestamptz;
  v_general_ids uuid[] := ARRAY[]::uuid[];
  v_supported boolean;
  v_payload text;
  v_digest text;
  v_where text := 'm.chat_id=$1';
BEGIN
  IF p_chat_id IS NULL OR p_scope IS NULL OR p_scope NOT IN ('all','root','topic')
     OR (p_scope = 'topic') <> (p_topic_id IS NOT NULL)
     OR (p_before_created_at IS NULL) <> (p_before_id IS NULL)
     OR (p_before_created_at IS NOT NULL AND NOT isfinite(p_before_created_at))
     OR (p_if_digest IS NOT NULL AND p_if_digest !~ '^[0-9a-f]{64}$') THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('status','denied'); END IF;

  -- An empty messages SELECT is not positive access admission. Both rows must
  -- be visible through current invoker RLS, even for an empty/matching page.
  SELECT c.type, cm.cleared_at INTO v_chat_type, v_cleared_at
    FROM public.chats c JOIN public.chat_members cm ON cm.chat_id=c.id
    WHERE c.id=p_chat_id AND cm.user_id=v_owner;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','denied'); END IF;
  IF p_scope='topic' AND NOT EXISTS(
    SELECT 1 FROM public.topics t WHERE t.id=p_topic_id AND t.chat_id=p_chat_id
  ) THEN RETURN jsonb_build_object('status','denied'); END IF;
  IF p_scope='root' THEN
    SELECT coalesce(array_agg(t.id ORDER BY t.id),ARRAY[]::uuid[]) INTO v_general_ids
      FROM public.topics t WHERE t.chat_id=p_chat_id AND t.is_general;
  END IF;

  -- Fixed server-selected fragments, all caller values remain bound parameters.
  -- An optional-filter OR in a cached generic plan hid the active partial index
  -- and made a100-row head scan the entire chat. Plan the actual selector instead.
  IF v_chat_type='private' THEN v_where := v_where || ' AND m.deleted_at IS NULL'; END IF;
  IF v_cleared_at IS NOT NULL THEN v_where := v_where || ' AND m.created_at>$2'; END IF;
  IF p_scope='topic' THEN v_where := v_where || ' AND m.topic_id=$3'; END IF;
  IF p_scope='root' THEN v_where := v_where || ' AND (m.topic_id IS NULL OR m.topic_id=ANY($4))'; END IF;
  IF p_before_created_at IS NOT NULL THEN v_where := v_where || ' AND (m.created_at,m.id)<($5,$6)'; END IF;

  -- STABLE reads share the calling statement snapshot. Select the actual page
  -- before own-hidden filtering: do not manufacture100 text rows by scanning.
  EXECUTE format($query$
  WITH selected AS MATERIALIZED (
    SELECT m.* FROM public.messages m
    WHERE %s
    ORDER BY m.created_at DESC,m.id DESC LIMIT 101
  ), page AS MATERIALIZED (
    SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT 100
  ), visible AS MATERIALIZED (
    SELECT m.* FROM page m WHERE NOT EXISTS (
      SELECT 1 FROM public.message_hidden_for_users h WHERE h.message_id=m.id AND h.user_id=$7
    )
  )
  SELECT coalesce(bool_and(coalesce(m.type='text' AND m.deleted_at IS NULL
      AND m.user_id IS NOT NULL AND isfinite(m.created_at)
      AND (m.edited_at IS NULL OR isfinite(m.edited_at))
      AND m.reply_to_id IS NULL AND m.forwarded_from_id IS NULL AND m.bot_id IS NULL
      AND m.media_url IS NULL AND m.media_bucket IS NULL AND m.media_path IS NULL
      AND m.media_metadata IS NULL AND m.bot_reply_markup IS NULL AND m.system_payload IS NULL
      AND m.forward_origin_name IS NULL AND m.forward_origin_hidden IS DISTINCT FROM true
      AND m.bot_input_field_placeholder IS NULL,false)),true),
    jsonb_build_object(
      'version',1,'chat_id',$1,'scope',$8,'topic_id',$3,
      'general_topic_ids',$4,
      'before_created_at',to_char($5 AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'before_id',$6,
      'cleared_at',to_char($2 AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'has_more',(SELECT count(*)>100 FROM selected),
      'next_before_created_at',CASE WHEN (SELECT count(*)>100 FROM selected) THEN
        (SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          FROM page ORDER BY created_at,id LIMIT 1) ELSE NULL END,
      'next_before_id',CASE WHEN (SELECT count(*)>100 FROM selected) THEN
        (SELECT id FROM page ORDER BY created_at,id LIMIT 1) ELSE NULL END,
      'rows',coalesce(jsonb_agg(jsonb_build_object(
        'id',m.id,'user_id',m.user_id,'content',m.content,
        'created_at',to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'edited_at',to_char(m.edited_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'pinned',coalesce(m.pinned,false),'topic_id',m.topic_id,'mention_entities',m.mention_entities
      ) ORDER BY m.created_at DESC,m.id DESC) FILTER (WHERE m.id IS NOT NULL),'[]'::jsonb)
    )::text
    FROM visible m
  $query$,v_where) INTO v_supported,v_payload
    USING p_chat_id,v_cleared_at,p_topic_id,v_general_ids,p_before_created_at,p_before_id,v_owner,p_scope;

  IF NOT v_supported OR octet_length(convert_to(v_payload,'UTF8'))>1048576
     OR (v_cleared_at IS NOT NULL AND NOT isfinite(v_cleared_at)) THEN
    RETURN jsonb_build_object('status','unsupported');
  END IF;
  v_digest := encode(sha256(convert_to(v_payload,'UTF8')),'hex');
  RETURN jsonb_build_object('status',CASE WHEN v_digest=p_if_digest THEN 'unchanged' ELSE 'fresh' END,
    'digest',v_digest,'payload',CASE WHEN v_digest=p_if_digest THEN NULL ELSE v_payload END);
END;
$cache_page$;
REVOKE ALL ON FUNCTION public.message_text_cache_page_v1(uuid,text,uuid,timestamptz,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.message_text_cache_page_v1(uuid,text,uuid,timestamptz,uuid,text) TO authenticated;
