# Is the migration actually on the database?

On 2026-09-14 six migrations were found sitting unapplied, three days after they
were written, committed, and described in the defect register as fixed. One of
them was the reason every signed-in account could read every chat's reactions
(D-104). Nothing in this repository was comparing what the migrations say to
what the database has, so the gap was invisible until somebody read the live
policies by hand.

`scripts/migration-inventory.sql` exports every function, table, policy and
trigger the database has. `scripts/migration-inventory.mjs` reads the recorded
migrations and reports the objects they name that are not there.

```bash
ssh -i ~/.ssh/letscube_ed25519 root@ms.letscube.ru \
  'docker exec -i supabase-db psql -U supabase_admin -d postgres' \
  < scripts/migration-inventory.sql > output/live-objects.txt
node scripts/migration-inventory.mjs output/live-objects.txt
```

The export is read-only, inside a transaction that ends in ROLLBACK, and names
objects rather than reading rows — no message, profile, phone number or token
passes through it. Run it before a release and after any batch of migrations.

## What it cannot tell you

It reads four statements — `create function`, `create table`, `create policy`,
`create trigger` — and nothing else. **A migration whose whole effect is an
`alter`, a `revoke` or a `grant` is invisible to it.** It catches a migration
that was never run at all, which is the failure that actually happened; it does
not verify that a migration which *was* run had the effect it describes. For
that, each migration carries its own self-check, and the rehearsal files under
`.migration-backup/supabase/rehearsal/` are what prove behaviour.

**An absent object is a question, not a verdict.** A policy renamed by a later
migration is absent for ever, and on the first run nine of the thirteen it found
were exactly that. The check is only worth having if somebody reads each line.

## The nine settled as superseded, 2026-09-14

Each was checked against the live schema and each has a successor. If one of
these appears again, it is this list that is stale, not the database.

| Migration | Absent | Superseded by |
| --- | --- | --- |
| `20260427_chats_update_policy` | «Chat members can update chats» | «Chat admins update chat» on `public.chats` |
| `20260427_folders_rls` | «Users manage own folders», «Users manage own folder_chats» | «Users can manage own folders» plus the four scope-aware policies |
| `20260504_tasks_system` | «tasks select for participants», «task_events select for participants» | «tasks select scoped», «task_events select scoped» |
| `20260505_audit_logs` | «admins read audit_logs» | «audit_logs select by permission» |
| `20260505_roles_permissions_foundation` | `public.user_roles` and ten functions | the later roles redesign: `public.roles`, `public.role_permissions` and their own functions |
| `20260505_tasks_visibility_and_assignment` | «tasks select with visibility», «task_events select with visibility» | the scoped policies above |
| `20260531_notification_center_read_sync_native_push` | the four «user_push_devices own …» policies | **the table is closed to clients on purpose.** RLS is on, it has no policies and no grant to `anon` or `authenticated`; registration goes through `public.register_push_device`, which is SECURITY DEFINER and which the client calls |
| `20260623_avatar_variants_read_policy` | «media variants chat peers can read avatar variants» | «media variants avatars are readable» and the three beside it |

## The batch this found, 2026-09-14

Six migrations of 2026-09-11, written and committed in `6e2f5ed` and its
neighbours, none of them on the database:

| Migration | What it was for |
| --- | --- |
| `20260911140000_chat_read_marks_forward_only` | a read mark may only move forward |
| `20260911141000_message_read_events` | per-message read receipts |
| `20260911142000_one_reaction_per_person` | Telegram's one reaction per person, held by the database |
| `20260911143000_delete_messages_for_everyone` | deleting for everyone, in one call |
| `20260911144000_forward_message_with_media` | forwarding that carries the media |
| `20260911150000_reactions_visible_to_chat_members` | **D-104**: reactions readable by the message's chat, not by everyone |
| `20260911151000_user_achievements_signed_in_only` | **D-107**: earned achievements not readable without an account |

All seven were applied that day. How, and what was measured after, is in the
register under D-104 and in the tracker's deploy baseline. The procedure is
worth repeating rather than describing: a verified backup, a throwaway database
loaded from a schema-only dump of production, every migration **and its
rehearsal** run there first, then production as the owning role, then the effect
measured as `authenticated` with real claims — never as the table's owner, since
a policy measured as its own table's owner is not measured at all.
