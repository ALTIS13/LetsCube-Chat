-- Rollback: drop table public.user_contacts; no existing table is modified.
-- A contact is private to its owner and does not depend on a chat membership.
begin;

create table public.user_contacts (
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  contact_user_id uuid not null references public.profiles(id) on delete cascade,
  alias text,
  created_at timestamptz not null default now(),
  constraint user_contacts_pkey primary key (owner_user_id, contact_user_id),
  constraint user_contacts_not_self check (owner_user_id <> contact_user_id),
  constraint user_contacts_alias_valid check (
    alias is null or (alias = btrim(alias) and char_length(alias) between 1 and 64)
  )
);

create index user_contacts_contact_user_id_idx on public.user_contacts(contact_user_id);

alter table public.user_contacts enable row level security;

create policy user_contacts_select_own on public.user_contacts
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy user_contacts_insert_own on public.user_contacts
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy user_contacts_update_own on public.user_contacts
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy user_contacts_delete_own on public.user_contacts
  for delete to authenticated using (owner_user_id = (select auth.uid()));

revoke all on public.user_contacts from public, anon, authenticated;
grant select, insert, delete on public.user_contacts to authenticated;
grant update(alias) on public.user_contacts to authenticated;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.user_contacts'::regclass)
    or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'user_contacts') <> 4
    or pg_catalog.has_table_privilege('anon', 'public.user_contacts', 'SELECT')
    or not pg_catalog.has_table_privilege('authenticated', 'public.user_contacts', 'SELECT')
    or not pg_catalog.has_column_privilege('authenticated', 'public.user_contacts', 'alias', 'UPDATE')
    or pg_catalog.has_column_privilege('authenticated', 'public.user_contacts', 'owner_user_id', 'UPDATE')
    or pg_catalog.has_column_privilege('authenticated', 'public.user_contacts', 'contact_user_id', 'UPDATE')
  then
    raise exception 'user_contacts_rls_or_grants_invalid';
  end if;
end;
$$;

commit;
