-- Test-only protocol candidate, NOT a migration or production close entrypoint.
-- The coarse barrier covers messages only. Receipts, PUTs, avatars, variants,
-- moderation participants and physical generation are NOT deletion eligibility.
SET ROLE postgres;

CREATE FUNCTION fixture_coverage.before_write() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'fixture_isolation_unsupported' USING ERRCODE = '0A000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_locks
      WHERE pid = pg_catalog.pg_backend_pid() AND locktype = 'advisory'
        AND classid = 270311 AND objid = 1 AND objsubid = 2
        AND mode = 'ExclusiveLock' AND granted) THEN
    RAISE EXCEPTION 'fixture_closer_cannot_write' USING ERRCODE = '55000';
  END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(270311, 1) THEN
    RAISE EXCEPTION 'fixture_coverage_busy' USING ERRCODE = '55P03';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION fixture_coverage.check_refs(refs jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(refs) r
      JOIN fixture_coverage.objects o ON o.generation_id = (r->>'generation_id')::uuid
      WHERE o.closed) THEN
    RAISE EXCEPTION 'fixture_generation_closed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM fixture_coverage.objects WHERE closed)
      AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(refs) r
        WHERE r->>'reference_state' <> 'registered') THEN
    RAISE EXCEPTION 'fixture_unknown_after_close' USING ERRCODE = '55000';
  END IF;
END $$;

CREATE FUNCTION fixture_coverage.after_write() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ids uuid[]; refs jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT pg_catalog.array_agg(id) INTO ids FROM new_rows;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT pg_catalog.array_agg(id) INTO ids FROM
      (SELECT id FROM old_rows UNION SELECT id FROM new_rows) affected;
  ELSE
    SELECT pg_catalog.array_agg(id) INTO ids FROM old_rows;
  END IF;

  -- Reread final rows: nested AFTER ROW writes can supersede transition images.
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), '[]'::jsonb)
  INTO refs FROM public.messages m
  CROSS JOIN LATERAL private.bot_message_media_references(
    m.media_bucket, m.media_path, m.media_url, m.media_metadata) r
  WHERE m.id = ANY(ids);
  PERFORM fixture_coverage.check_refs(refs);
  IF TG_OP <> 'INSERT' THEN
    SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), '[]'::jsonb)
    INTO refs FROM old_rows m
    CROSS JOIN LATERAL private.bot_message_media_references(
      m.media_bucket, m.media_path, m.media_url, m.media_metadata) r;
    PERFORM fixture_coverage.check_refs(refs);
  END IF;
  -- Existing bound generations remain independent observations, not a counter.
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), '[]'::jsonb)
  INTO refs FROM private.bot_message_media_observations r WHERE r.message_id = ANY(ids);
  PERFORM fixture_coverage.check_refs(refs);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION fixture_coverage.close_objects(ids integer[]) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'fixture_isolation_unsupported' USING ERRCODE = '0A000';
  END IF;
  -- No same-transaction upgrade/reentry: a closer must never become a writer.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_locks
      WHERE pid = pg_catalog.pg_backend_pid() AND locktype = 'advisory'
        AND classid = 270311 AND objid = 1 AND objsubid = 2 AND granted) THEN
    RAISE EXCEPTION 'fixture_coverage_upgrade' USING ERRCODE = '55000';
  END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(270311, 1) THEN
    RAISE EXCEPTION 'fixture_coverage_busy' USING ERRCODE = '55P03';
  END IF;
  IF ids IS NULL OR pg_catalog.cardinality(ids) = 0
      OR EXISTS (SELECT 1 FROM pg_catalog.unnest(ids) i
        WHERE i IS NULL OR NOT EXISTS (SELECT 1 FROM fixture_coverage.objects o WHERE o.id = i)) THEN
    RAISE EXCEPTION 'fixture_close_input_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    PERFORM id FROM fixture_coverage.objects WHERE id = ANY(ids)
      ORDER BY id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'fixture_control_busy' USING ERRCODE = '55P03';
  END;
  -- Fresh commands after the barrier. No message/membership/Storage row locks.
  IF EXISTS (SELECT 1 FROM public.messages m
      CROSS JOIN LATERAL private.bot_message_media_references(
        m.media_bucket, m.media_path, m.media_url, m.media_metadata) r
      WHERE r.reference_state <> 'registered')
      OR EXISTS (SELECT 1 FROM private.bot_message_media_observations WHERE reference_state <> 'registered') THEN
    RAISE EXCEPTION 'fixture_unknown_coverage' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.messages m
      CROSS JOIN LATERAL private.bot_message_media_references(
        m.media_bucket, m.media_path, m.media_url, m.media_metadata) r
      JOIN fixture_coverage.objects o ON o.generation_id = r.generation_id
      WHERE o.id = ANY(ids))
      OR EXISTS (SELECT 1 FROM private.bot_message_media_observations r
        JOIN fixture_coverage.objects o ON o.generation_id = r.generation_id WHERE o.id = ANY(ids)) THEN
    RAISE EXCEPTION 'fixture_reference_present' USING ERRCODE = '55000';
  END IF;
  UPDATE fixture_coverage.objects SET closed = true WHERE id = ANY(ids);
END $$;

REVOKE ALL ON FUNCTION fixture_coverage.before_write(), fixture_coverage.after_write(),
  fixture_coverage.check_refs(jsonb), fixture_coverage.close_objects(integer[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER fixture_coverage_before BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
  ON public.messages FOR EACH STATEMENT EXECUTE FUNCTION fixture_coverage.before_write();
CREATE TRIGGER fixture_coverage_insert AFTER INSERT ON public.messages
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION fixture_coverage.after_write();
CREATE TRIGGER fixture_coverage_update AFTER UPDATE ON public.messages
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION fixture_coverage.after_write();
CREATE TRIGGER fixture_coverage_delete AFTER DELETE ON public.messages
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION fixture_coverage.after_write();
