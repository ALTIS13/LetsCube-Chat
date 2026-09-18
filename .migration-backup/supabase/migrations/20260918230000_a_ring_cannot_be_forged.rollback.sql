/**
 * Rollback for `20260918230000_a_ring_cannot_be_forged.sql`.
 *
 * Run as `supabase_admin`, which owns `public.voice_channels`.
 *
 * It restores the **table-level** INSERT grant that migration replaced with an
 * explicit fourteen-column list. That is a real widening and it is the point of
 * the rollback: with the table grant back, `authenticated` can once again insert
 * any column of this table, the three ring columns included, so a participant
 * who may insert a room in a chat may insert one that is already ringing —
 * which is the forgery the other file closed, and which the block list does not
 * see.
 *
 * **So do not run this file on its own.** It belongs with the rollback of
 * `20260918220000`, which removes the ring columns entirely and therefore makes
 * the widening harmless again. Running only this one leaves the hole open.
 *
 * Idempotent, and it does not assume the column grants exist: `revoke` on a
 * privilege nobody holds is not an error, and the table grant that follows
 * subsumes whatever is left.
 */

begin;

revoke insert on public.voice_channels from authenticated;
grant insert on public.voice_channels to authenticated;

do $$
begin
  -- The table-level grant is back exactly when every column reads INSERT,
  -- including any added since. Asserted by counting rather than by listing, so
  -- this file does not go stale the next time a column appears.
  if exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'voice_channels'
       and not exists (
         select 1 from information_schema.column_privileges p
          where p.table_schema = 'public' and p.table_name = 'voice_channels'
            and p.column_name = c.column_name
            and p.grantee = 'authenticated' and p.privilege_type = 'INSERT'
       )
  ) then
    raise exception 'the table-level INSERT grant did not reach every column';
  end if;
end;
$$;

commit;
