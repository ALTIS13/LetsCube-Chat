# Where the client and the database disagree

A survey, not a repair. Nothing in this pass edits a source file, and nothing in
it writes to production.

Date: 2026-09-15. Branch `integration/message-actions`, worktree
`.worktrees/bot-platform`. Every database fact below was read off the live
Postgres behind `core.letscube.ru` on that date, not inferred from a migration
file — migrations say what somebody meant to apply, and this project has already
paid twice for the difference (`20260905140000_bot_avatar_policy_repair.sql`,
`20260905150000_media_path_uuid_pattern_repair.sql`).

## The defect class

One side knows something the other does not, and neither is wrong on its own.
The client offers a control a policy will refuse; a column is written by nobody
or read by nobody; a refusal is drawn as emptiness; one rule is written down
twice and the copies drift. The database is authoritative about what happens;
the client is authoritative about what a person is told. A defect of this class
lives in the gap and is invisible from either side alone.

## How it was measured

All reads were issued through one pipe, as `postgres`, with no psqlrc:

    ssh -i "C:/Users/maksi/.ssh/letscube_ed25519" root@ms.letscube.ru
      'docker exec -i supabase-db psql -U postgres -d postgres -X -A -F"|" -f -' < query.sql

Structure came from `pg_policies`, `pg_proc`, `pg_trigger`, `pg_constraint`,
`information_schema.role_table_grants`, `information_schema.role_column_grants`
and `has_table_privilege` / `has_column_privilege`. Population came from `count`
and `group by` over the tables themselves — counts, column names, policy names
and role names only. No phone number, email, message body, token or account id
was printed, copied or stored at any point.

**Three behavioural probes were run inside `begin; ... rollback;`**, each
impersonating a real account with `set_config('role','authenticated')` plus a
`request.jwt.claims` carrying that account's `sub`. A policy measured as its own
table's owner is not measured at all, which is why the impersonation was
necessary. Each probe is quoted under its finding, and each was followed by a
post-rollback count proving nothing was left behind: `bans` 0, `mutes` 0,
`folders where name='audit probe'` 0, `profiles where role='manager'` 0, and
`audit_logs` written in the preceding five minutes 0.

## The shape of this deployment

Read on 2026-09-15, because every judgement below about "how many people this
costs" rests on it:

| fact | value |
|---|---|
| accounts (`profiles`) | 18 |
| `profiles.role` | `user` 16, `admin` 2 |
| global roles in use | «Владелец» 3, «Тех. администратор» 2, «Пользователь» 14 |
| accounts satisfying `is_manager_or_admin()` | 5 |
| accounts satisfying `profiles.role in ('admin','manager')` | 2 |
| tables in `public` | 66, all with RLS enabled |
| policies in `public` | 190 |

That third and fourth row are the whole of Finding 1.

---

# Part A — Confirmed findings

Ranked by what a person actually loses. Every entry here was measured, and the
measurement is quoted.

---

## F-1 `[confirmed]` Three of the five staff accounts cannot issue a ban or a mute, and two of them are the product's owners

**Severity: highest.** It disables moderation for the majority of the people who
are supposed to do it, and it does so for the two highest-privileged accounts in
the product.

**The surface.** `artifacts/kub/src/pages/admin/UsersTab.tsx:367`

```ts
const canSanction = (target: Profile) =>
  target.id !== currentUser?.id && (isAdmin || target.role !== "admin");
```

This gates «Заблокировать…», «Замьютить…», «Снять блокировку» and «Снять мьют»
in the per-row menu (`UsersTab.tsx:956`, `:960`, `:968`, `:972`). The tab itself
is mounted behind `isStaff` only (`artifacts/kub/src/pages/admin/AdminLayout.tsx:85`,
`:180`). `isAdmin` and `isStaff` come from
`artifacts/kub/src/hooks/useRole.ts:87-92`, which ORs the legacy `profiles.role`,
the four global role keys, and a set of permission keys.

The write is `artifacts/kub/src/pages/admin/BanModal.tsx:61` —
`supabase.from("bans").insert({...})` — and its sibling in `MuteModal.tsx`.

**The database objects.** Two layers, and they do not agree with each other.

*Layer one, RLS.* `bans` and `mutes` each carry `managers insert bans` /
`managers insert mutes` with `WITH CHECK is_manager_or_admin(auth.uid())`. That
function, read off production:

```sql
select uid is not null and (
  exists (select 1 from public.profiles p
           where p.id = uid and p.role in ('admin'::app_role, 'manager'::app_role))
  or public.has_global_role(uid, 'owner')
  or public.has_global_role(uid, 'tech_admin')
  or public.has_global_role(uid, 'admin')
  or public.has_global_role(uid, 'manager'))
```

*Layer two, a trigger.* `trg_enforce_sanction_matrix_bans` and
`trg_enforce_sanction_matrix_mutes` both call `public.enforce_sanction_matrix()`,
whose entire notion of staff is the legacy column:

```sql
select role into caller_role from public.profiles where id = caller;
if caller_role = 'admin'   then return new; end if;
if caller_role = 'manager' then ... return new; end if;
raise exception 'Только администратор или менеджер может применять санкции'
  using errcode = '42501';
```

`has_global_role` is never consulted. So the RLS layer admits four global role
keys that the trigger layer has never heard of.

**What each side believes.** The client believes staff may sanction. RLS agrees.
The trigger believes only `profiles.role in ('admin','manager')` may, and the
trigger runs last.

**The observable consequence for a person.** A moderator opens «Пользователи»,
finds the account, picks «Заблокировать…», fills in a reason and a duration,
presses the red button — and gets back a sentence telling them they are not an
administrator. They are holding the «Владелец» role. Nothing they can do from any
screen in the product changes this, because the control that would fix it is
itself behind the same wall (see F-2). Two accounts in this state hold «Владелец»
and one holds «Тех. администратор».

**How it was measured.** First the population:

```sql
select is_manager_or_admin(p.id) as rls_says_staff,
       (p.role in ('admin','manager')) as trigger_says_staff,
       count(*) as people
from profiles p group by 1,2 order by people desc;
```

    rls_says_staff|trigger_says_staff|people
    f|f|13
    t|f|3          <-- the gap
    t|t|2

Then the behaviour, inside a transaction that was rolled back:

```sql
begin;
do $$
declare v_staff uuid; v_admin uuid; v_target uuid;
begin
  select p.id into v_staff  from profiles p
   where is_manager_or_admin(p.id) and p.role not in ('admin','manager') order by p.id limit 1;
  select p.id into v_admin  from profiles p where p.role='admin' order by p.id limit 1;
  select p.id into v_target from profiles p
   where p.role='user' and not is_manager_or_admin(p.id) order by p.id limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff::text, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  raise notice 'A precheck: is_manager_or_admin=%', is_manager_or_admin(v_staff);
  begin
    insert into public.bans(user_id, reason, issued_by) values (v_target,'audit probe',v_staff);
    raise notice 'A RESULT: BAN INSERT SUCCEEDED';
  exception when others then
    raise notice 'A RESULT: BAN REFUSED sqlstate=% msg=%', SQLSTATE, SQLERRM;
  end;
  -- the same block again for public.mutes
  perform set_config('role','postgres', true);

  -- control case: the profiles.role='admin' account, same target
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    insert into public.bans(user_id, reason, issued_by) values (v_target,'audit probe',v_admin);
    raise notice 'B RESULT: BAN INSERT SUCCEEDED (control case)';
  exception when others then
    raise notice 'B RESULT: BAN REFUSED sqlstate=% msg=%', SQLSTATE, SQLERRM;
  end;
end $$;
rollback;
```

Output:

    NOTICE:  A precheck: is_manager_or_admin=t
    NOTICE:  A RESULT: BAN REFUSED  sqlstate=42501  msg=Только администратор или менеджер может применять санкции
    NOTICE:  A RESULT: MUTE REFUSED sqlstate=42501  msg=Только администратор или менеджер может применять санкции
    NOTICE:  B RESULT: BAN INSERT SUCCEEDED (control case)
    ROLLBACK

Post-rollback: `bans` 0, `mutes` 0, `audit_logs` in the last five minutes 0.

**Note the asymmetry**, because it makes the screen incoherent rather than merely
broken: *lifting* a sanction is governed by `managers delete bans` / `managers
delete mutes`, which are RLS-only — no trigger guards DELETE. So the same three
accounts **can** unban and unmute. They can undo a sanction they were never
allowed to issue.

---

## F-2 `[confirmed]` The same three accounts cannot change anyone's role, including their own way out of F-1

**Severity: high.** It is what makes F-1 unrecoverable from inside the product.

**The surface.** `artifacts/kub/src/pages/admin/UsersTab.tsx` — the role control
in the user dialog, routed through the `admin_update_user_profile` RPC
(`UsersTab.tsx:1087`), with a direct `from("profiles").update(...)` fallback at
`:1093-1096` when the RPC is absent. The tab is behind `isStaff`; the role
controls behind `isAdmin`.

**The database object.** `trg_enforce_role_change_matrix` on `public.profiles`,
calling `public.enforce_role_change_matrix()`:

```sql
select role into caller_role from public.profiles where id = caller;
if caller_role = 'admin'   then return new; end if;
if caller_role = 'manager' then ... end if;
raise exception 'Только администратор или менеджер может менять роли'
  using errcode = '42501';
```

Same shape as F-1: the legacy column only. `admin_update_user_profile` is
`SECURITY DEFINER` and does `update public.profiles`, but `auth.uid()` inside it
still resolves to the caller, so the trigger fires with the caller's identity and
the RPC's own gate — `has_global_role(v_actor,'owner'|'tech_admin')` or
`has_permission(v_actor,'users.manage'|'system.manage')` — is overruled one layer
down.

**What each side believes.** The RPC believes a global owner may edit a profile.
The trigger believes only a legacy admin or manager may change its `role`.

**The observable consequence.** The owner of the product opens a user, changes
their role, and is told only an administrator or a manager may change roles.
Because the legacy `profiles.role` column is itself only writable by somebody who
already has `profiles.role in ('admin','manager')`, an owner cannot grant
themselves the column value that would let them act. The only way out is SQL.

**How it was measured.** Same probe harness, same rollback:

```sql
update public.profiles set role='manager'::public.app_role where id = v_target;
```

    NOTICE:  C RESULT: ROLE CHANGE REFUSED sqlstate=42501 msg=Только администратор или менеджер может менять роли
    ROLLBACK

Post-rollback: `profiles where role='manager'` 0.

---

## F-3 `[confirmed]` `useBanState` and `useMuteState` answer "not banned" when they could not tell

**Severity: high** structurally; currently unexercised, because `bans` and
`mutes` both hold 0 rows on this deployment. It is ranked this high because the
failure mode is silent, security-relevant, and compounds with every restrictive
policy in the schema.

**The surface.** `artifacts/kub/src/hooks/useBanState.ts:43-56`:

```ts
const { data } = await supabase
  .from("bans")
  .select("*, issuer:profiles!bans_issued_by_fkey(full_name,username)")
  .eq("user_id", userId)
  .order("created_at", { ascending: false });
if (cancelled) return;
const rows = ((data ?? []) as unknown) as (Ban & {...})[];
const active = rows.find((b) => !b.expires_at || new Date(b.expires_at).getTime() > now);
setState({ loading: false, banned: !!active, ban: active ?? null });
```

`error` is never destructured. `artifacts/kub/src/hooks/useMuteState.ts:56-58` is
the same shape: `const { data } = await q;` then `const rows = (data ?? []) as Mute[];`.

**The database side.** A failed read and an empty read are the same value here,
and the database's opinion of a banned person is expressed almost entirely
through *restrictive* policies that filter rather than raise. Fifteen tables
carry a `block banned` restrictive policy, measured on production:
`chat_channel_categories`, `chat_members`, `chats`, `content_reports`,
`folder_chats`, `folders`, `messages`, `profile_contacts`, `profiles`,
`push_subscriptions`, `reactions`, `topics`, `user_blocks`, `voice_channels`
and `voice_participants`. A banned account whose ban read fails
therefore gets the whole application — with every list empty and every write
refused.

**The observable consequence.** The person is not shown `BannedScreen.tsx`. They
are shown a working product in which no chat has any messages, no group has any
topics, and every attempt to send anything fails. They have no way to learn that
they are banned, and the empty lists actively tell them the opposite story (see
F-6).

**How it was measured.** The client side is the two files above. The database
side:

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname='public' and permissive='RESTRICTIVE' and qual like '%is_banned%';
```

— fifteen tables, listed above. `bans` itself carries no restrictive policy and does carry
`user reads own bans`, so the read normally succeeds; this is confirmed as a
*coding* defect (the hook cannot represent "I could not tell") rather than a
currently-firing one.

---

## F-4 `[confirmed]` `phone_discoverable` is written by an RPC no interface calls and read by nothing at all

**Severity: medium-high.** It is a privacy control that exists in the schema and
does not exist in fact.

**The surfaces.** There are none. That is the finding.
`artifacts/kub/src/components/sidebar/PhoneSection.tsx` offers verification
(`profile_phone_mark_verified`, `:167`) and removal, and nothing else. A search
for `phone_discoverable`, `set_discoverable` or `discoverab` across `artifacts/`
returns **zero hits**; the only matches in the repository are in the design spec
that asked for it,
`docs/superpowers/specs/2026-08-10-neutral-ui-smsru-phone-onboarding-design.md:228-244`.

**The database objects.**

- `public.profile_contacts.phone_discoverable boolean not null default false`.
- `public.profile_phone_set_discoverable(p_enabled boolean)` — the only writer,
  and it is called by nobody:

  ```sql
  update public.profile_contacts
     set phone_discoverable = coalesce(p_enabled, false)
   where user_id = auth.uid() and phone_verified is true;
  ```

- `public.search_profiles_by_phone(p_query text, p_limit integer)` — the only
  reader of the table, and it does **not** consult the column:

  ```sql
  from public.profile_contacts contact
  join public.profiles profile on profile.id = contact.user_id
  where contact.phone_verified is true
    and contact.phone = v_phone
  ```

  Its gate is `has_permission(v_actor,'users.view')` plus `not is_banned`.

**What each side believes.** The schema says every account has answered "no" to
the question "may I be found by my phone number?" — the column is `not null
default false` and all 18 rows are `false`. The search function has never asked.
The interface has never asked either.

**The observable consequence.** Four people have verified a phone number. Each of
them is findable by exact phone match by any of the five accounts holding
`users.view`, while the stored answer to the discoverability question is "no" for
every one of them, and no screen in the product has ever offered them the
question. The spec at `:244` does sanction a staff exception — staff "may find
verified contacts regardless of ordinary discoverability" — so the staff path is
as designed. What was never built is the other half: ordinary discoverability,
its opt-in, and any surface for it. The column and its writer are inert on both
sides.

**How it was measured.**

```sql
select phone_discoverable, (phone is not null) as has_phone, phone_verified, count(*)
from profile_contacts group by 1,2,3 order by 4 desc;
```

    phone_discoverable|has_phone|phone_verified|count
    f|f|f|13
    f|t|t|4
    f|t|f|1

```sql
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f'
   and pg_get_functiondef(p.oid) like '%phone_discoverable%';
```

    proname
    profile_phone_set_discoverable

One writer, zero readers. Column-level grants confirm the client *could* write it
directly — `INSERT` and `UPDATE` on `phone_discoverable` are granted to
`authenticated` — it simply never does.

---

## F-5 `[confirmed]` Two meanings of "staff" on one screen: a person may create a shared folder they are then not allowed to manage

**Severity: medium.** Latent in effect — all 8 folders on this deployment are
`personal` — but the disagreement is real and was proved against production.

**The surfaces.** Two different predicates, in code that meets on one screen.

`artifacts/kub/src/hooks/useFolders.ts:91` — legacy column only:

```ts
const isStaff = role === "admin" || role === "manager";
```

used by `canManageFolder` (`useFolders.ts:175-183`) to decide whether the edit and
delete controls appear for a `shared` folder.

`artifacts/kub/src/components/sidebar/FolderEditModal.tsx:39,168` — the *wide*
`isStaff`, from `useIsManagerOrAdmin()` into `useRoleAccess()`, which ORs global
roles and permissions; it decides whether the scope selector offers "shared" at
all.

**The database object.** `folders insert scope-aware`:

```sql
WITH CHECK ((user_id = auth.uid()) AND (COALESCE(created_by, user_id) = auth.uid())
            AND ((scope = 'personal'::folder_scope) OR is_manager_or_admin(auth.uid())))
```

and `folders update scope-aware` / `folders delete scope-aware`, which allow a
`shared` folder to be managed by `is_manager_or_admin(auth.uid())` or its creator.

**What each side believes.** The database uses `is_manager_or_admin` — global
roles included. `FolderEditModal` uses the wide client predicate, which agrees.
`useFolders` uses a third, narrower one that knows only `profiles.role`.

**The observable consequence.** One of the three accounts from F-1 opens the
folder editor, is offered the "shared" scope because `FolderEditModal` says they
are staff, creates the folder because the database says they are staff — and then
finds that folder has no edit and no delete control, because `useFolders` says
they are not. The database would accept both operations.

**How it was measured**, inside the same rolled-back transaction as F-2:

```sql
insert into public.folders(user_id, created_by, name, scope)
values (v_staff, v_staff, 'audit probe', 'shared'::public.folder_scope);
```

    NOTICE:  D RESULT: SHARED FOLDER INSERT SUCCEEDED (DB allows what useFolders hides)
    ROLLBACK

Post-rollback: `folders where name='audit probe'` 0. Scope distribution today:
`personal` 8, and no other scope — which is why this is real but not yet costing
anyone anything.

---

## F-6 `[confirmed]` Four list surfaces cannot represent a refused read, so refusal is drawn as «ничего нет»

**Severity: medium**, and it is the defect class this project already named
D-140, fixed twice per-surface and never generalised.

**The generaliser already exists and is used twice.**
`artifacts/kub/src/lib/listReadState.ts` provides the four-state view
(`loading | unavailable | stale | ready`). Its only two adopters are
`artifacts/kub/src/pages/admin/BansMutesTab.tsx:147` and
`artifacts/kub/src/pages/admin/ReportsTab.tsx`.

**The surfaces that still collapse failure into emptiness**, each verified by
reading the file:

| hook | line | what happens on failure | what the person is told |
|---|---|---|---|
| `hooks/useTasks.ts` | 87-91 | `if (error) { DEV-only log; setTasks([]) }`, and the return at `:128` has no `error` field | «Нет доступных задач» / «Нет назначенных задач», with a «Создать задачу» button |
| `hooks/useChats.ts` | 162-168 | the `chats` read's `error` is not even destructured; `if (!chatsData) return;` | «Чаты не найдены» (`ChatList.tsx:584`) |
| `hooks/useTopics.ts` | 35-42 | `const { data } = await ...` then `setTopics((data ?? []) as Topic[])` | the forum silently renders as a plain chat |
| `hooks/useMessages.ts` | 665-671 | `setPinnedMessages([]); setPinnedReady(true)` — actively asserts the empty answer is final | the pinned banner disappears |

**The database side that makes this bite.** Two mechanisms, and they are
different:

1. *Filtering.* RLS normally filters rather than raising, so an ordinary refusal
   arrives as zero rows and not as an error — which is precisely why the
   restrictive `block banned` policies of F-3 turn every one of these lists into
   an empty one for a banned person, with no error to catch. Measured: fifteen
   tables carry `block banned` restrictive policies, `messages`, `chats`, `topics`
   and `folders` among them.
2. *Raising.* A missing grant or a failing policy function does produce an error.
   `tasks`, `chats`, `messages` and `topics` all have full table grants today, so
   this half is not currently firing — but it is one grant change away, and the
   SELECT policy on `tasks` calls `_task_visible_to_current_user_v3(...)`, a
   nine-argument plpgsql function whose failure would arrive here as "you have no
   tasks".

**The observable consequence.** For a banned person, every chat says «Сообщений
пока нет» and invites them to say hello; the task list says they are all caught
up. For anyone hitting a genuine error, the same. The note the product already
wrote for itself, in `BansMutesTab.tsx:79-81`, states the rule correctly: a
failed read is not an empty one.

**Cheapest repair, for whoever picks this up:** add `error` to the return of
`useTasks` at `:128`, `useChats` at `:526` and `useTopics`, and route the three
empty states through `listReadView`. That is the whole of the table above except
the pinned banner.

---

## F-7 `[confirmed]` The one refusal reactions can produce has a translated sentence, and the only code path that can raise it throws it away — after drawing the result on screen

**Severity: medium-low**, conditional. Included because it is an unusually clean
specimen: the product built the message and then made it unreachable.

**The surface.** `artifacts/kub/src/hooks/useMessages.ts:1495-1499` paints the
result first:

```ts
if (shown) {
  const guess = planReactionToggle(shown.reactions, user.id, emoji);
  showReactions(applyReactionPlan(shown.reactions, user.id, guess, {...}));
```

then `:1519-1525` discards both possible refusals:

```ts
const { error } = await supabase.from("reactions").delete()
  .eq("message_id", messageId).eq("user_id", user.id);
if (error) console.error("Reaction removal error:", error);
...
const { error } = await supabase.from("reactions")
  .insert({ message_id: messageId, user_id: user.id, emoji: plan.add });
if (error) console.error("Reaction insert error:", error);
```

There is no rollback path, and `mapPgError` is never called — although
`artifacts/kub/src/lib/errors.ts:78` already carries the exact sentence:

```ts
if (lowerMessage.includes("reaction_limit_reached"))
  return "На это сообщение больше реакций поставить нельзя.";
```

**The database object.** `trg_enforce_reaction_limit` on `public.reactions` calls
`private.enforce_reaction_limit()`:

```sql
v_limit := private.reaction_limit_per_message(new.user_id);
select count(*) into v_others
  from public.reactions
 where message_id = new.message_id and user_id = new.user_id
   and emoji is distinct from new.emoji;
if v_others >= v_limit then
  raise exception 'reaction_limit_reached' using errcode = 'P0001';
end if;
```

and `private.reaction_limit_per_message(p_user_id)` currently returns `1`, with
its own comment: "Every account: one reaction per message. The subscription reads
its entitlement for p_user_id here."

**What each side believes.** They agree on the value `1` today, but they hold it
in different forms. The database holds it as a **per-user function**, already
parameterised for a future entitlement, and publishes it as
`public.reaction_limit_per_message()` for the client to ask. The client holds it
as a **hardcoded rule** in `planReactionToggle`
(`artifacts/kub/src/lib/messageReactions.ts:61-69`), which unconditionally
removes all of the person's rows before adding one, and never calls the RPC.

**The observable consequence, today.** The normal path works, because the client
deletes before it inserts and the trigger then counts zero others. But the two
statements are separate and the refusal of the first does not stop the second: if
the DELETE fails, the INSERT runs, hits the limit, and both errors go to the
console while the screen keeps showing the new reaction. The person sees their
reaction change and finds the old one back after a reload.

**The observable consequence the day the entitlement ships.** A subscriber whose
limit becomes 2 still loses their first reaction when they add a second, because
the client's copy of the rule is a constant.

---

## F-8 `[confirmed]` The client's offline copy of the legacy permission table is missing one key

**Severity: low.** Recorded because it is exactly the "two copies of one rule"
shape and the diff is a single line.

`artifacts/kub/src/hooks/useRole.ts:426-463` carries `legacyRoleHasPermission`, a
client-side role-to-permission table used whenever the access-snapshot RPC returns
nothing or throws (`useRole.ts:189-194`, `:206-213`). The database's copy is
`public._legacy_role_has_permission(p_role app_role, p_permission_key text)`.

Diffing the two `admin` lists as read on production:

- Database grants legacy `admin` **23** keys.
- The client grants **22**.
- The difference is `folders.manage_shared`, present in the database list and
  absent from the client's.

The `manager` and default lists match exactly, 8 keys and 1 key respectively.

**The observable consequence.** In the fallback path only — that is, when the
snapshot RPC is disabled or fails — a legacy admin is denied the shared-folder
capability the database would grant them. It compounds with F-5, which is about
the same capability reached by a different predicate.

---

# Part B — Suspicions, and things that are latent rather than live

Recorded separately and deliberately. A suspicion written up as a finding is
worse than one not written up at all.

**S-1 `[latent]` A legacy `admin` with no global role would lose most of the
administration.** `_legacy_role_has_permission` does not grant `system.manage`,
`support.view`, `media.moderate`, `roles.manage`, `permissions.manage`,
`tasks.delete`, `tasks.bulk_delete`, `tasks.restore` or any `support.*` key,
while `useRoleAccess().isAdmin` is true for `legacyRole === "admin"` outright.
Such an account would be shown «Роли и права», «Инвайты» and «Операции» and be
refused by `_require_permission` inside every RPC behind them. Measured: **zero
accounts are in this state today** — the capability cross-tab over all 18
profiles returns exactly two groups, "none of it" (13) and "all of it" (5). It is
one role edit away.

**S-2 `[latent]` `RolesPermissionsTab` computes its own authority.**
`artifacts/kub/src/pages/admin/RolesPermissionsTab.tsx:170-178` derives
`canManageRoles` from client-side joins over `roles`, `role_permissions` and
`user_global_roles` rather than from `has_permission`. The RPCs it guards require
`_require_permission('roles.manage')` and `_require_permission('permissions.manage')`,
both held only by «Владелец» and «Тех. администратор» on this deployment. All
five staff hold both today, so the two predicates cannot be distinguished by
measurement right now.

**S-3 `[not a disagreement — recorded so the next reader does not re-find it]`
Any chat member can pin or unpin any message.** `public.pin_message` and
`public.unpin_message` gate on `is_chat_member(v_message.chat_id)` and nothing
else; the client offers the control to every signed-in member
(`ChatWindow.tsx:1402`). The two sides **agree**, so this is not a client/server
disagreement — it is a product decision that sits oddly beside topics (owner
only) and channels (`canManageChannels`). 17 pinned rows exist. Left here as an
observation for the interface stage, not as a defect of this class.

**S-4 `[hardening, not a live hole]` Grants that no policy can ever use.**
`notifications` carries full `SELECT/INSERT/UPDATE/DELETE` grants for both `anon`
and `authenticated` and exactly one policy — `Owner reads own notifications`
(SELECT). Every write is therefore RLS-refused, and correctly so: the client uses
`notifications_mark_read`, `notifications_mark_all_read` and
`notifications_mark_chat_messages_read`. The same shape appears on
`notifications_push_outbox` (RLS on, **zero** policies, full DML granted to `anon`
and `authenticated`) and `user_achievements` (full DML granted, SELECT policy
only). Nothing reaches these; they are grants with no purpose, in the same family
as `20260911130000_revoke_unfiltered_table_privileges.sql`.

**S-5 `[unverified]` `registration_invite_settings` has an admin-read policy and
no grant.** The policy `registration_invite_settings admin read` is
`has_permission(auth.uid(),'system.manage')`, but
`has_table_privilege('authenticated','public.registration_invite_settings','SELECT')`
returns **false** — there is no grant for `anon` or `authenticated` at all, so the
policy is unreachable from any client. One row exists. I could not find a client
surface that reads the table directly; `OpsReportTab.tsx:455` uses the name only
as a label for an audit-log target kind, and the invite screens go through
`registration_invites_list` and `registration_invite_mode` instead. So this costs
nobody anything today. Worth a decision nonetheless: either drop the policy or add
the grant, because a policy that cannot be reached is a claim the schema makes and
cannot keep.

**S-6 `[unverified]` Android is the only native push platform the enqueuer
knows.** `_enqueue_push_after_notification_insert` fills
`notifications_native_push_outbox` from `user_push_devices` filtered to
`platform = 'android' and provider = 'fcm'`. All 9 rows on this deployment are
android/fcm — 3 live, 6 disabled and revoked — so nothing is being dropped today.
Listed because `docs/PRODUCTION_PRIORITY_TRACKER.md` still carries killed-process
WNS delivery as an open Windows gate, and a Windows device registered into this
table would be enqueued by nobody, silently.

**S-7 `[checked, no drift found]` The chat-member role matrix is duplicated, and
the copies agree.** `artifacts/kub/src/lib/chatMemberRules.ts:44-90` mirrors
`public.enforce_chat_member_update()` exactly — owner has full control, admin may
only flip `member` to `admin` and back and may not touch an owner. I diffed them
line by line and found no drift. The client copy does **not** model the last-owner
rule (`enforce_chat_member_delete`, «Нельзя удалить последнего владельца чата»),
but `ChatList.tsx:485` gates leaving on `myRole !== "owner"` for groups, which
covers it. Recorded so the duplication is known, not as a defect.

---

# Part C — Checked, and found sound

Negative results, so that the next pass does not spend its budget here.

- **The moderation queue gate is correct.** `lib/moderationAccess.ts` mirrors
  `is_manager_or_admin` exactly — the four global role keys plus the two legacy
  values — and `AdminLayout.tsx:90` gates both «Жалобы» and «Блокировки» on it.
  The `content_reports` column-level UPDATE grant the queue depends on is present
  in production and is exactly `status, handled_by, handled_at`, with `note` and
  `reason` correctly excluded: `has_column_privilege` returns true for `status`,
  false for `note`, and `has_table_privilege(...,'UPDATE')` is false.
- **`speak_role` is now surfaced.** `voice_channels` grants `authenticated` a
  column-level UPDATE on `archived, max_participants, name, position, speak_role,
  updated_at`, and `ChannelManageModal.tsx:594,630,1101` offers it. The absent
  table-level UPDATE grant is deliberate, not a gap.
- **The chat mute round-trip is sound.** `chat_notification_preferences` has
  PRIMARY KEY `(chat_id, user_id)`, which is exactly the `onConflict` target the
  upsert at `app.store.ts:445-455` names; the write surfaces its refusal and rolls
  the optimistic row back; `useChatMute.ts:59-66` keeps the cache on a failed read
  and does not claim it is the server's answer. The table holding 0 rows means
  nobody has muted a chat, not that the write fails.
- **The three push toggles are honoured.** `message_push_enabled`,
  `task_push_enabled` and `invite_push_enabled` are all read by
  `_notification_push_allowed`, which gates **both** the web outbox and the native
  one. Four of the twelve live notification kinds — `chat_added`,
  `support_ticket_created`, `mute_issued`, `ban_issued`, 77 of 2271 rows — match
  none of the three patterns and are governed by the master switch alone; that
  appears intentional and is not counted as a defect.
- **The chat list is ordered by real message time.** `chat_list_summaries` uses a
  lateral `order by message.created_at desc, message.id desc`, so the documented
  RLS no-op on `chats.updated_at` for non-admin senders
  (`useMessages.ts:1030-1050`) costs nothing. The acceptance written there is
  correct.
- **`has_location_permission` and the client's `selectPermissionKeys` agree** —
  both treat a global permission as satisfying a location-scoped check.
- **No ungated admin RPC.** My first regex reported ten RPCs as having no gate;
  reading the bodies showed every one of them calls `public._require_permission(...)`,
  an idiom the regex did not know. Corrected rather than reported.
- **Role badge columns are read.** `roles.badge_icon` and `roles.badge_public`
  appear nowhere in `artifacts/`, but `public.profile_badges` reads both and the
  client calls that RPC (`useProfileBadges.ts`).
- **Recurrence limits are written.** `task_recurrences.end_at` and
  `max_occurrences` never appear as column names in client code, but they are
  passed as `p_end_at` and `p_max_occurrences` to `task_recurrence_create` and
  `task_recurrence_update` (`useRecurringTasks.ts:192-193`, `:210-211`).
- **Task writes are all RPC.** `tasks`, `task_events`, `task_recurrences` and
  `task_recurrence_events` have `false` for every INSERT, UPDATE and DELETE
  policy, and the client never attempts a direct write to any of them.
- **`api-server` and the bot runtime swallow nothing user-visible.**
  `bot/repository.ts`, `bot/updateDelivery.ts`, `bot/webhookWorker.ts` and
  `bot/deletionFinalizer.ts` all throw on `response.error`. The discarded results
  in `pushDispatcher.ts` and `mediaVariantsWorker.ts` are outbox bookkeeping with
  no surface.

---

# Part D — What this survey did not cover

An honest gap is worth more than a broad claim. None of the following was
examined, and no statement above should be read as covering it.

**Storage.** `storage.objects` and `storage.buckets` — their policies, the
`_kub_media_path_allowed` and `_kub_bot_avatar_path_allowed` guards, and the TUS
upload path. This is the single largest omission, and it is the area that produced
the 2026-09-04 outage. Media was touched here only through `media_variants`.

**Schemas other than `public`.** `auth`, `realtime`, `private` (except the two
reaction functions reached from a `public` trigger), `net`, `vault` and the
Supabase internal schemas were not enumerated. Realtime subscription authorisation
in particular is a separate policy surface that the client depends on heavily and
that this pass never opened.

**Edge Functions.** `phone-verification-gateway` is invoked from
`PhoneSection.tsx` and `UsersTab.tsx`; its internals, its own gate, and whether
they agree with `phone_verification_available_internal` were not read.

**The Bot Gateway.** `letscube-bot-gateway` was not surveyed beyond confirming
that `bots`, `bot_owners`, `bot_commands` and `chat_bot_members` grant
`authenticated` SELECT only. Bot token handling was not touched at all.

**Support.** The `support_*` family — eight tables, `support_operator_preferences`
and `support_settings` included — was read at the grant and policy level but no
support surface was traced. `support_operator_preferences.email_enabled` appears
in no client file; I did not establish whether anything reads it.

**Shells.** Everything above was read as source. Nothing was run. No browser, no
Windows Tauri shell, no Android APK, no installed iPhone PWA. The four
notification kinds governed by no toggle, the empty-list behaviour of F-6 and the
reaction path of F-7 are all reasoned from code and schema, not observed on a
screen. Where a finding was proved behaviourally it says so and quotes the probe;
where it was not, it does not.

**Tables not opened.** `achievements`, `cosmetics`, `product_milestones`,
`privacy_policy_versions`, `registration_invite_uses`, `task_recurrence_events`,
`message_hidden_for_users`, `folder_chats`, `location_members`,
`support_guest_sessions`, `support_rate_limit_signals`, `support_email_messages`,
`support_email_routes`, `phone_verification_claims`,
`phone_verification_pilot_users`, `phone_verification_policy`,
`phone_verification_sms_events`, `push_foreground_sessions`. Of these,
`push_foreground_sessions` is worth one line: it holds 1 row, has zero policies
and zero grants, and the hook named after it
(`artifacts/kub/src/hooks/usePushForegroundSession.ts`) never names the table — I
did not establish what writes it. `privacy_acceptances` is worth a second: it
holds 0 rows, grants `authenticated` SELECT only, has no INSERT policy, and is
named nowhere in `artifacts/` — so nothing in the product has ever recorded a
privacy-policy acceptance, and nothing could.

**Not attempted.** No write, no migration, no RLS change, no policy measured as
its own table's owner without impersonation. The three probes were transactional
and their rollbacks were verified by counting afterwards.
