-- TEST-ONLY current-avatar publication prototype, NOT an installable migration.
-- Requires the fictional fixture_avatar owner/variant schema from the test.
-- Rollback: discard the exact owned disposable PostgreSQL fixture.
-- No external I/O, physical incarnation, durable PUT intent or reclamation proof.
create or replace function fixture_avatar.publish(
  p_scope text, p_owner_id uuid, p_avatar_url text, p_row jsonb
) returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare
  v_current text;
begin
  if p_scope is null or p_scope not in ('profile', 'chat') or p_owner_id is null or p_avatar_url is null
     or p_row is null or p_row->>'variant_kind' is null or p_row->>'variant_kind' not in ('avatar_128', 'avatar_256')
     or p_row->>'status' is null or p_row->>'status' not in ('ready', 'failed')
     or p_row->>'source_bucket' is distinct from 'media'
     or p_row->>'variant_bucket' is distinct from 'media'
     or nullif(p_row->>'source_path', '') is null
     or nullif(p_row->>'variant_path', '') is null
  then
    raise exception using errcode = '22023', message = 'fixture_avatar_input_invalid';
  end if;

  select avatar_url into v_current
    from fixture_avatar.owners
   where scope = p_scope and id = p_owner_id
     for update;
  if not found or v_current is distinct from p_avatar_url then
    return false;
  end if;

  delete from fixture_avatar.variants
   where scope = p_scope and owner_id = p_owner_id
     and kind = p_row->>'variant_kind';
  insert into fixture_avatar.variants(scope, owner_id, kind, row_data)
    values(p_scope, p_owner_id, p_row->>'variant_kind', p_row);
  return true;
end;
$function$;
revoke all on function fixture_avatar.publish(text,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function fixture_avatar.publish(text,uuid,text,jsonb) to service_role;
