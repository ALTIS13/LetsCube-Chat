# Is it actually on production?

Two checks with the same shape, for the two kinds of thing this project ships
outside a git push: database migrations, and Edge Functions. Both were written on
2026-09-14, the day each of them found something.

## Is the migration actually on the database?

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

## Removed on purpose, not superseded, 2026-09-19

The list above is about objects that have a successor. This one has none, and
that is why it needs its own heading: the script reports an absence, and the
obvious repair — re-apply the migration that created them — is the **wrong**
thing to do here.

| Migration | Absent | Why |
| --- | --- | --- |
| `20260918200000_a_call_says_so_in_the_conversation` | `public.voice_call_transition`, `public.voice_call_service_line`, `public.write_voice_call_service_message`, `trg_voice_call_service_message` | **Dropped deliberately** by `20260919180000_the_rail_already_says_who_is_in_the_channel.sql`, applied 2026-09-19 at the owner's instruction: a group already shows who is in a channel, so the conversation stopped saying it too. `voice_channels.call_announced_at` went with them. |

Re-applying `20260918200000` would put the trigger back and start writing the
two sentences into every group again, which is the thing that was removed. If
the feature is ever wanted back, the file to run is
`20260919180000_the_rail_already_says_who_is_in_the_channel.rollback.sql`, which
restores `20260918280000`'s writer rather than `20260918200000`'s — the
difference being whether a private chat is told about a «канал» it does not
have.

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

## Is the Edge Function the one in this repository?

`send-push-notifications` on the server was dated 2026-07-14 where this
repository's is 2026-08-31, and had no `wns.ts` at all — the whole Windows
sender, with unit tests here and no existence there (D-185). Three other
directories were serving old copies of themselves beside the real file.

```bash
node scripts/function-inventory.mjs --local > output/functions-local.txt
node scripts/function-inventory.mjs --remote-command      # prints the ssh line
node scripts/function-inventory.mjs --compare output/functions-local.txt output/functions-remote.txt
```

It hashes source bytes and nothing else: no environment, no secret, no row. It
answers three things, and the third is the one that is easy to leave out — a
file **on the server and not here** is reported rather than ignored, because
that is exactly what the stale `.bak` copies were. `main` and `hello` belong to
the runtime, not to this repository, and are left out so the output stays worth
reading.

It says nothing about whether the function *works*: the runtime compiles per
request, so a function that matches byte for byte can still fail to boot. After
deploying one, call it once and read the runtime's log.

As of 2026-09-14 all 22 files match, with nothing extra on either side.
