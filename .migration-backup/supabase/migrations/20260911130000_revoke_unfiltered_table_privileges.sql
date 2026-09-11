/**
 * Remove the three table privileges that row-level security never filters from
 * the two roles every API caller runs as.
 *
 * RLS policies govern SELECT, INSERT, UPDATE and DELETE. They do not govern
 * TRUNCATE, TRIGGER or REFERENCES: a role holding TRUNCATE on a table empties
 * it regardless of any policy. The owner approved removing them on 2026-09-11,
 * as hardening after the private-chat delete repair (20260911120000).
 *
 * Why this is hardening and not a repair: neither PostgREST nor pg_graphql can
 * issue TRUNCATE, create a trigger or add a foreign key, and a user's JWT is not
 * a database password, so none of the three was reachable through the public
 * API. It removes a capability nothing uses, so that a future change which does
 * expose raw SQL — a SECURITY INVOKER function built with dynamic SQL, a pooler
 * opened to the network — does not inherit it.
 *
 * Measured read-only on production before writing this:
 *   - anon and authenticated each held TRUNCATE, TRIGGER and REFERENCES on the
 *     same 36 tables in `public`: achievements, audit_logs, bans, chat_members,
 *     chat_notification_preferences, chats, cosmetics, folder_chats, folders,
 *     group_invites, location_members, locations, message_hidden_for_users,
 *     messages, mutes, notification_preferences, notifications,
 *     notifications_push_outbox, permissions, privacy_preferences,
 *     product_milestones, profile_contacts, profiles, push_subscriptions,
 *     reactions, registration_invite_uses, registration_invites,
 *     role_permissions, roles, task_events, task_recurrence_events,
 *     task_recurrences, tasks, topics, user_achievements, user_global_roles;
 *   - row-filtered grants held: anon SELECT 39, INSERT 36, UPDATE 36, DELETE 36;
 *     authenticated SELECT 51, INSERT 37, UPDATE 37, DELETE 36;
 *   - the default privileges `postgres` hands out in `public` granted all three
 *     to both roles on every NEW table (anon=arwdDxt/postgres,
 *     authenticated=arwdDxt/postgres), so revoking on existing tables alone
 *     would have been undone by the next migration that creates one;
 *   - live PostgREST reads as anon with limit 0 answered 200 on cosmetics,
 *     achievements and product_milestones (three of the 36), and 401
 *     "permission denied for function is_banned" on folders, profiles and
 *     chats — access already closed for anon, by an error rather than an
 *     empty set.
 *
 * Safety, checked read-only before writing this:
 *   - no function in any non-system schema contains TRUNCATE, so no code path
 *     depends on the privilege;
 *   - the event triggers present (graphql, pg_cron and pg_net access grants,
 *     PostgREST's DDL watch) do not re-grant table privileges in `public`;
 *   - 60 of the 61 tables in `public` are owned by `postgres`, one by
 *     `supabase_admin`, on which anon and authenticated held none of the three.
 *
 * Deliberately untouched: the platform schemas `storage`, `graphql`,
 * `graphql_public` and `supabase_functions`, whose grants belong to the
 * Supabase services that manage them.
 *
 * Schema backup taken and verified first:
 *   /srv/letscube/backups/db-schema/pre-20260911130000-revoke-unfiltered-privileges-20260911T005817Z.sql
 *   907059 bytes, sha256 15fbd852870c505be0d73f2303ed29c56647501214423a1ae95ffeff4240cf56,
 *   169 policies, the default privileges verbatim, and 20260911120000 already
 *   inside.
 *
 * Rollback:
 *   grant truncate, trigger, references on <the 36 tables listed above>
 *     to anon, authenticated;
 *   alter default privileges for role postgres in schema public
 *     grant truncate, trigger, references on tables to anon, authenticated;
 *
 * One transaction. The self-check refuses to commit unless all three are gone
 * from existing tables, gone from the defaults for new ones, and — the part that
 * would actually break the product — every SELECT, INSERT, UPDATE and DELETE
 * grant the two roles held before is still held after.
 */

begin;

create temp table _row_filtered_grants_before on commit drop as
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon', 'authenticated')
   and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

do $$
declare
  v_left integer;
  v_default_left integer;
  v_lost integer;
  v_before integer;
begin
  select count(*) into v_left
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  if v_left <> 0 then
    raise exception '% unfiltered table privileges remain for anon/authenticated', v_left;
  end if;

  select count(*) into v_default_left
    from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'r'
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
     and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  if v_default_left <> 0 then
    raise exception 'new tables would still receive % unfiltered privileges', v_default_left;
  end if;

  select count(*) into v_before from _row_filtered_grants_before;
  if v_before = 0 then
    raise exception 'captured no row-filtered grants before the revoke; refusing to trust an empty comparison';
  end if;

  select count(*) into v_lost
    from _row_filtered_grants_before b
   where not exists (
     select 1
       from information_schema.role_table_grants g
      where g.table_schema = 'public'
        and g.grantee = b.grantee
        and g.table_name = b.table_name
        and g.privilege_type = b.privilege_type
   );
  if v_lost <> 0 then
    raise exception 'the revoke removed % row-filtered privileges the API relies on', v_lost;
  end if;
end
$$;

commit;
