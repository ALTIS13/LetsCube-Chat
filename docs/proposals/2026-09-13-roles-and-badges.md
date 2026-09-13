# Roles and badges — the Discord shape, against what this product already has

Written 2026-09-13 against `integration/message-actions`. **Nothing here has been
applied.** No database was touched to write it, no server was started, no
repository file outside this one was changed. Every statement about the product
is quoted from a file in the tree with its line, or from a measurement already
recorded in the defect register; every statement about production that this
document cannot prove is marked as something to read before anything is applied.

It answers the owner's message of 2026-09-13, quoted in full in section 0. The
governing constraint comes from the owner himself and is repeated here because
it decides more of the design than the feature does: **a relabelled old function
is not an answer.** The second constraint is the register's: this product has
already been told, wrongly, that achievements do not exist. Section 1 is
therefore longer than section 4 on purpose.

**One caveat about the line numbers.** Everything cited below was read on
2026-09-13 at `14854cc` plus the working tree as it then stood. While this
document was being written, another agent's uncommitted work rewrote
`ChatInfoPanel.tsx` (193 lines changed) and added
`artifacts/kub/src/components/chat/ChatSettingsView.tsx`,
`artifacts/kub/src/lib/chatSettings.ts` and `tests/unit/chat-settings.test.mts` —
the group settings screen of D-164. **Line numbers inside `ChatInfoPanel.tsx` are
therefore approximate**; the symbol names (`GroupMemberRow`, `loadMembers`, the
tab strip) are not, and section 5.4 is written against the new screen rather than
against the tab strip it replaces. Re-read that file before implementing anything
that cites it.

---

## 0. The request, verbatim

> «Настраиваемый тег можно сделать по типу ролей в дискорде (тем более что мы и
> так планировали делать это скорее как каналы в дискорде с войсами и т.п, чем
> просто группами как изначально в телеге), в своей группе у пользователя свои
> теги, но есть роли также глобальные которые у нас отвечают за работников,
> админов приложения и т.п, их мы можем немного видоизменить и сделать по типу
> лычек как опять же в дискорде, в которых написано кто такой, за что получил
> медальку (достижения, покупка подписки и статус условно премиум) и в каком
> Squad состоит, но у нас Squad можно переделать как раз в отображение
> глобальной роли и там свой значок красивый в зависимости от локации работника
> и отношения человека к админскому составу, чем выше статус тем красивее иконка
> или тому подобное.»

Three things, and a direction:

1. **Per-group roles**, configured inside the group, Discord-shaped.
2. **Global roles redisplayed as badges** that say who somebody is and why they
   have the medal — achievements, a subscription purchase, premium standing.
3. **The «Squad» slot repurposed** to show the global role, with a nicer icon the
   higher the standing.

The direction — «скорее как каналы в дискорде … чем просто группами как
изначально в телеге» — is already recorded in
`docs/PRODUCTION_PRIORITY_TRACKER.md:495-516`, and the three parts are already
set against the product in `docs/INTERFACE_DEFECT_REGISTER.md:8452-8535` (D-168).
This document is the design D-168 says is still owed, not a second survey of the
same ground; where it repeats a fact from D-168 it is because the design turns on
it.

---

## 1. What already exists

### 1.1 The global role and permission system

Four tables, created by
`.migration-backup/supabase/migrations/20260514_dynamic_roles_permissions.sql`:

| Table | Columns | Where |
| --- | --- | --- |
| `public.roles` | `id, key, name, description, scope, is_system, is_active, created_at, updated_at` + `priority`, `colour` | `20260514…:15-28`, `20260904080000…:42-49` |
| `public.permissions` | `key, name, description, category` | `20260514…:30-37` |
| `public.role_permissions` | `role_id, permission_key` | `20260514…:39-42` |
| `public.user_global_roles` | `user_id, role_id, assigned_by, assigned_at` | `20260514…:45-50` |

The live row shape is confirmed in the generated types:
`artifacts/kub/src/types/database.generated.ts:1080-1120` carries `colour`,
`priority` and `scope` on `roles`.

`scope` is constrained to `('global','location','chat')` (`20260514…:27`). Thirteen
roles are seeded (`20260514…:91-104`): five global — `owner`, `tech_admin`,
`admin`, `manager`, `user`; five location — `location_owner`, `location_admin`,
`location_manager`, `location_staff`, `location_client`; and three chat —
`chat_owner`, `chat_admin`, `chat_member`.

**The three chat-scope rows are dead and must not be revived as the per-group
mechanism.** `20260904060000_roles_retire_dead_tiers_and_club_naming.sql:36-39`
says why, from a production measurement: «chat-scope roles are never evaluated
anywhere: `has_permission` filters `scope='global'` and `has_location_permission`
filters `scope='location'`. Chat access comes from `chat_members.role` via
`is_chat_admin`/`chat_role_of`.» That migration deactivates them. There is no
table anywhere assigning a chat-scope role to a (chat, person) pair.

Twenty-seven permission keys are seeded (`20260514…:106-137`), including the four
that belong to conversations and have never been reachable: `chats.invite`,
`chats.invite_any`, `chats.manage_invites`, `chats.moderate`, `chats.manage_roles`.

**How access is actually decided** — three tiers, in this order
(`20260514…:330-361`, restated in `20260904060000…:14-22`):

1. `has_global_role(u,'owner')` or `has_global_role(u,'tech_admin')` returns true
   for **every** permission, without reading `role_permissions`;
2. any global-scope active role in `user_global_roles` whose `role_permissions`
   contains the key;
3. otherwise `_legacy_role_has_permission(profiles.role, key)`, a hardcoded list
   inside the function.

`_require_permission` (`20260514…:499-516`) is the gate every management RPC
calls; it also refuses a banned actor. `_critical_role_count` (`:518-531`) is the
last-owner guard.

Writes are closed to the client. All four tables carry `insert/update/delete
blocked` policies with `check (false)` (`20260514…:454-456, :465-467, :476-478,
:487-489`); every change goes through `security definer` RPCs — `role_create`,
`role_update`, `role_set_permissions`, `role_delete_or_archive`,
`user_assign_global_role`, `user_remove_global_role`, `location_member_assign_role`
(`20260514…:536-780`), each auditing into `public.audit_logs`.

**Reads are narrow, and this is the fact the whole badge design turns on**
(`20260514…:437-489`):

```sql
create policy "roles select scoped"
  on public.roles for select to authenticated
  using (
    public.has_permission(auth.uid(), 'roles.view')
    or exists (select 1 from public.user_global_roles ugr
                where ugr.user_id = auth.uid() and ugr.role_id = roles.id)
    or exists (select 1 from public.location_members lm
                where lm.user_id = auth.uid() and lm.role_id = roles.id)
  );

create policy "user_global_roles select scoped"
  on public.user_global_roles for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(), 'users.assign_roles'));
```

An ordinary account holds the global `user` role — backfilled and kept by
`trg_profiles_default_user_global_role` (`20260904060000…:53`) — so it can read
exactly one row of `roles` (its own) and exactly its own rows of
`user_global_roles`. **It cannot learn anybody else's global role at all.**
`location_members` is the same shape: `20260513_locations_task_routing.sql:172-178`
allows `is_admin(auth.uid()) or user_id = auth.uid() or is_location_admin(...)`.

**`priority` and `colour` already exist, and already mean what Discord means.**
`20260904080000_roles_priority_and_colour.sql` was written on the owner's request
of 2026-09-04 for «the shape a Discord user expects»: higher sorts first, ties
allowed and meaningful, a hex colour constrained by
`roles_colour_format_check` to six hex digits so it can be interpolated into a
style attribute safely. Its header states the rule that every later surface has
to keep repeating: **priority is presentation, not authority** — nothing in
`has_permission` reads it, and moving a role up the list grants it nothing.

The client half is `artifacts/kub/src/lib/roleHierarchy.ts`, 270 lines, pure, no
React and no `@/` alias so `node --test` runs it: `compareRolesByHierarchy` (:81),
`sortRolesByHierarchy` (:90), `rankLevels` (:95), `buildRoleHierarchy` (:107),
`planPriorityMove` (:163), `normalizeRoleColour` (:216), `roleSwatchColour` (:231),
`roleFormSignature` (:250). Its interface `RoleRankFields` (:44-50) is structural
— `{ id, key, name, scope, priority }` — so anything with those five fields can
use the whole module unchanged. Gate: `tests/unit/role-hierarchy.test.mts`.

**The role editor already exists and is already Discord-shaped.**
`artifacts/kub/src/pages/admin/RolesPermissionsTab.tsx` (1101 lines), mounted from
`AdminLayout.tsx:171` behind `isAdmin`, renders «Роли по старшинству» (`:638`) as
one group per scope, each role with its colour swatch (`:655, :682`), ↑/↓ buttons
driven by `planPriorityMove` (`:717, :727, :369`), a «Цвет роли» field validated
against the same regex (`:807-830`), and the permission set as grouped checkboxes.
Gates: `tests/unit/roles-panel-contract.test.mjs`,
`tests/unit/roles-cleanup-schema-contract.test.mjs`.

Client access helpers: `artifacts/kub/src/hooks/useRole.ts` — `useRoleAccess`
(:55), `usePermissionAccess` (:75), `useAnyLocationPermissionAccess` (:207), with
module-level `accessCache`/`permissionCache` maps (:26-27) and a legacy fallback
(:402). `artifacts/kub/src/hooks/useAccessSnapshot.ts` collapses the N `has_permission`
round trips into one `current_user_access_snapshot()` RPC
(`20260710_current_user_access_snapshot.sql`) — **for the current user only**;
there is no equivalent for anybody else. Copy lives in
`artifacts/kub/src/lib/rolePermissions.ts`: `ROLE_SCOPE_LABEL` (:8),
`SYSTEM_ROLE_LABEL` (:26-39), `PERMISSION_LABEL` (:98+, rewritten into plain verbs
by `20260904090000_permission_copy_in_plain_language.sql`).

### 1.2 The per-chat membership role

`public.chat_members` has **eleven columns** and no room for a tag:
`chat_id`, `user_id`, `role`, `joined_at`, `last_read_at`, `last_delivered_at`,
`hidden_at`, `cleared_at`, `pinned`, `pinned_at`, `pinned_order`
(`artifacts/kub/src/types/database.generated.ts:133-172`). Primary key
`(chat_id, user_id)`. `role` is the enum `public.chat_member_role` —
`('owner','admin','member')`, created at
`20260504_chats_membership_hardening.sql:31-37`; that migration deliberately drops
every text CHECK on the column and says so at `:211-214`.

`enforce_chat_member_update` (`20260504_chats_membership_hardening.sql:391-459`,
`security definer`, `before update`) is the authority on who may change whose
role:

- `auth.uid() is null` (service session): everything passes.
- moving a row between chats or users: always refused, `42501`.
- a non-role update (read marks, pins, hide, clear): untouched — the whole role
  block sits inside `if new.role is distinct from old.role`.
- **owner caller**: any transition, the handover to `owner` included.
- **admin caller**: exactly `member → admin` and `admin → member`; refused if
  either side is `owner` («Администратор не может менять роль владельца»).
- **member or non-member**: every role change refused.
- **last-owner guard**, caller-independent: `pg_advisory_xact_lock` on
  `hashtext('chat_owner:' || chat_id)`, then a count of other owners; zero raises
  `P0001` «Нельзя снять последнего владельца чата».

`artifacts/kub/src/lib/chatMemberRules.ts` (103 lines, pure) mirrors it:
`allowedRoleChanges` (:44), `canPromoteToAdmin` (:58), `canDemoteFromAdmin` (:63),
`canTransferOwnership` (:75), `canRemoveMember` (:86), `hasAnyMemberAction` (:94),
`chatRoleLabel` (:101). It is deliberately stricter than the server on `isSelf`,
and deliberately does not mirror the last-owner rule. Gate:
`tests/unit/chat-member-rules.test.mts`, eleven tests written from the trigger.

Helpers, all `security definer` and single-argument so no caller can spoof another
uid (`20260504_chats_membership_hardening.sql:18-24, :221-271`): `is_chat_member`,
`chat_role_of`, `is_chat_admin` (`role in ('owner','admin')`), `is_chat_owner`.

RLS on `chat_members` (`:323-388`) — eight policies, four restrictive ban vetoes:
select is `user_id = auth.uid() or is_chat_member(chat_id)`; insert may only ever
create a `member` row (`is_chat_admin(chat_id) and role = 'member'`); update is
`user_id = auth.uid() or is_chat_admin(chat_id)` with the trigger doing the real
work; delete is owner-removes-non-owner, admin-removes-member, or yourself.

**What a member row shows today.** One surface only:
`artifacts/kub/src/components/chat/ChatInfoPanel.tsx:2214-2284` (`GroupMemberRow`),
listed from `:1686-1707`. It draws the avatar (`:2241`), a `crown` icon for an
owner and a `shield` for an admin (`:2244-2245`), the name (`:2246`), «(вы)»
(`:2247`), a second line reading «Владелец» or «Администратор» in
`--kub-accent-text` **only for those two** (`:2249-2253`), and the «ещё» control
added on 2026-09-13 (`:2256-2281`). An ordinary member's row carries nothing — no
username, no presence, no join date. That is D-168's first paragraph, still open.

Members are loaded twice, both raw supabase-js, no hook:
`ChatInfoPanel.tsx:414-428` selects `role, profile:profiles(*)` per chat and
flattens to `MemberRow = Profile & { chat_role }` (`:127`); and
`artifacts/kub/src/hooks/useChats.ts:162-165` selects
`members:chat_members(user_id, role, joined_at, last_read_at, last_delivered_at, profile:profiles(*))`
onto `chat.members`.

### 1.3 Achievements, criteria, granting, and cosmetics

This exists, and is further along than the question assumed. Five migrations.

**`20260903210000_profile_achievements_cosmetics.sql`**

| Table | Columns |
| --- | --- |
| `public.achievements` | `key` (pk), `title`, `description`, `icon` (default `'crown'`), `grant_kind` (`'auto'`/`'manual'`), `sort_order`, `active`, `created_at` — `:18-29` |
| `public.user_achievements` | `user_id`, `achievement_key`, `granted_at`, `granted_by`; pk `(user_id, achievement_key)`; index on `user_id` — `:31-40` |
| `public.cosmetics` | `key` (pk), `kind` (`'frame'`/`'background'`), `title`, `required_achievement` (null = everyone), `sort_order`, `active`, `created_at` — `:42-51` |

Plus two columns on `profiles`: `profile_frame`, `profile_background`, both FKs to
`cosmetics(key)` (`:53-56`) — and a `before insert or update` trigger
`profiles_validate_cosmetics` (`:86-134`) that raises `cosmetic_not_unlocked`
(`P0001`) when the wearer is not entitled. The header says why in one sentence
worth reusing: `profiles` is updatable by its owner, so an entitlement enforced
only in the client «could be set to the tester's frame by anyone with a REST
client, and the badge would mean nothing.»

`achievement_grant(p_user_id, p_key, p_granted default true)` (`:208-255`) is the
manual path, guarded by `has_permission(actor,'users.manage')`; on revoke it also
clears any cosmetic that required the key. **It has zero TypeScript call sites** —
it is SQL-console-only today.

**`20260903220000_achievement_criteria.sql`** adds `public.product_milestones`
(`key`, `title`, `reached_at`, `updated_by`, `updated_at` — `:17-24`) and
`achievements.criteria jsonb not null default '{"kind":"manual"}'` (`:50-51`). Four
recognised shapes (`:42-46`): `manual`, `registered_before_milestone`,
`account_age_days`, `messages_sent`. An unrecognised shape grants nothing.

**`20260903230000_achievement_version_binding.sql`** adds
`product_milestones.version` with a `major.minor.patch` check and a second check
that a reached milestone must carry one (`:21-35`), and
`user_achievements.evidence jsonb not null default '{}'` (`:38-39`). It replaces
`product_milestone_set` with a write-once three-argument version (`:77-130`) and
adds `product_milestone_correct` requiring a reason of at least eight characters
(`:139-187`). `achievements_sync()` is rewritten to record evidence per grant
(`:189-308`).

**`20260904030000_achievement_recipients_exclude_test.sql`** adds two
`security_invoker` views: `achievement_recipients` (`:19-28`) and
`achievement_stats` (`achievement_key, holders, eligible` — `:49-59`), both
excluding `profiles.is_test_account` (`20260903240000_test_account_flag.sql:13-14`).

**`20260911151000_user_achievements_signed_in_only.sql`** — the one that matters
most here. It replaces the open read with:

```sql
create policy "Signed-in people can view earned achievements"
  on public.user_achievements for select to authenticated using (true);
revoke select, insert, update, delete on public.user_achievements from anon;
```

with the comment «A badge is there to be seen by the people in the product, not by
a reader without an account (D-107).» The catalogues — `achievements`,
`cosmetics`, `product_milestones` — stay readable by anyone (`:32-34`).

**So: any signed-in account may already read anybody's earned achievements.** No
policy change is needed to show a medal on another person's card. That is the
whole of the difference between part 2 of the request and part 3.

**The live catalogue**, after all five migrations: `tester` (Тестировщик, icon
`shield`, auto since `20260904050000`, criteria `registered_before_milestone:
alpha_start`), `alpha_tester` (Альфа-тестер, `shield`), `beta_tester`
(Бета-тестер, `zap`), `settled_in` (Освоился, `check`, 30 days), `veteran`
(Ветеран, `crown`, 365 days), `conversationalist` (Собеседник, `chats`, 100
messages), `storyteller` (Рассказчик, `chatRect`, 1000 messages). Seed at
`20260903210000…:264-276`, amended by `20260903220000…:69-105` and
`20260903230000…:45-61`. Milestones: `v1_0`, `alpha_end`, `alpha_start`.

Cosmetics: `frame_tester`, `frame_alpha`, `frame_beta`, `frame_veteran`,
`frame_talker`, `bg_aurora`, `bg_circuit`, `bg_prism`. Appearance table in
`artifacts/kub/src/lib/profileCosmetics.ts` (`FRAMES` :31-57, `BACKGROUNDS` :59-72),
with `canRenderCosmetic` (:89-95) so a catalogue row this build cannot draw is
hidden rather than broken — the pattern this design copies for icons.

Client: `artifacts/kub/src/lib/achievementRules.ts` holds the domain types
(`AchievementDefinition` :10, `CosmeticDefinition` :19, `AchievementProgress` :28,
`AchievementState` :33, `AchievementShare` :115);
`artifacts/kub/src/lib/achievements.ts:31-77` `loadAchievementState()` fires four
requests in parallel — `achievements`, `cosmetics`, `rpc achievements_sync`,
`achievement_stats`. Gates: `tests/unit/profile-achievements.test.mts`,
`tests/e2e/profile-decoration.spec.ts`.

**The surface**: `artifacts/kub/src/components/settings/ProfileDecorationSection.tsx`
(363 lines), opened from `SettingsScreen.tsx:369-377` under «Оформление». It draws
each achievement with its `KubIcon`, title, description, held state, progress bar
and rarity share (`:96-181`), then the frame and background pickers.

### 1.4 The icon set and the badge component

`artifacts/kub/src/components/kub/icons.ts` maps 106 semantic names onto
`@phosphor-icons/react` components (union at `:107-212`, record at `:225-334`);
`artifacts/kub/src/components/kub/KubIcon.tsx` renders them with
`{ name, size = 20, weight, tone, className, label, spin }` (`:31-46`) and nine
tones (`:8-29`). Icons are inline SVG, not a font, and `weight` is a first-class
prop — several entries already default to `"fill"`: `crown`, `pause`, `pin`,
`play`, `send`, `verified`, `zap`.

The complete name list, since a design that picks from it must be checkable:

`activity`, `admin`, `airplane`, `alert`, `atSign`, `attach`, `audit`, `back`,
`ban`, `bookmark`, `bot`, `camera`, `channel`, `chatBubble`, `chatRect`, `chats`,
`check`, `checkCircle`, `checklist`, `chevronDown`, `chevronLeft`,
`chevronRight`, `chevronUp`, `clock`, `close`, `cloud`, `contact`, `copy`,
`create`, `crown`, `dashboard`, `delete`, `doubleCheck`, `download`, `edit`,
`externalLink`, `eye`, `eyeOff`, `file`, `filter`, `folder`, `folderAdd`,
`folderOpen`, `food`, `forward`, `gesture`, `group`, `hash`, `heart`, `help`,
`image`, `imageOriginal`, `info`, `key`, `link`, `lock`, `logout`, `mail`,
`mailCheck`, `manager`, `mapPin`, `menu`, `microphone`, `microphoneSlash`,
`more`, `music`, `muted`, `notifications`, `notificationsOff`, `pause`, `paw`,
`phone`, `pin`, `pinOff`, `play`, `poll`, `private`, `profile`, `reject`,
`reply`, `rotate`, `search`, `send`, `settings`, `shield`, `shieldOff`, `smile`,
`spinner`, `sport`, `tasks`, `themeDark`, `themeLight`, `themeSystem`, `unban`,
`user`, `userCog`, `userRemove`, `userPlus`, `users`, `verified`, `video`,
`voice`, `volume`, `warning`, `webhook`, `zap`.

There is **no** `star`, `medal`, `trophy`, `gem`, `diamond` or `sparkle`. The ones
that fit a standing ladder are `crown`, `verified` (SealCheck, fill), `admin`
(ShieldCheck), `shield`, `manager`, `key`, `zap`, `mapPin`, `checkCircle`,
`bookmark`, `clock`, `activity`, `heart`, `hash`.

`artifacts/kub/src/components/kub/KubBadge.tsx` is the chip, and its docstring
(`:14-32`) is a measurement this design has to obey: painting the label in the
tone over an 18% tint of the same tone ranged from **3.17:1 to 5.55:1** across the
three surfaces a badge sits on, and the audit caught «Активна» at **2.62:1**.
Removing the tint was not enough — on `--kub-surface-3` the tone as a label still
measures **4.05:1** (cyan), **4.18:1** (pink), **3.82:1** (danger). So the label
takes `--kub-text` and the tone moved to the dot and the border, where the
requirement is 3:1. The dot is therefore load-bearing, not decorative, and status
is never signalled by colour alone. Held by
`tests/unit/status-badge-contrast.test.mjs`, which reads the tones and tokens out
of the source so a new tone is covered automatically.

### 1.5 What renders any of this today

| Surface | File | Global role | Chat role | Achievement |
| --- | --- | --- | --- | --- |
| Contact card, private chat | `ChatInfoPanel.tsx:1426-1436` → `ProfileRoleSummary compact` | **admins only** | — | no |
| Admin users tab | `pages/admin/UsersTab.tsx:1223` → `ProfileRoleSummary` | yes | — | no |
| Roles editor | `pages/admin/RolesPermissionsTab.tsx` | yes, with colour | — | no |
| Group member row | `ChatInfoPanel.tsx:2214-2284` | no | crown/shield + caption, owner and admin only | avatar ring only |
| Message author line | `MessageBubble.tsx:1247-1256` | no | no | no |
| Own settings | `ProfileDecorationSection.tsx` | no | — | **yes, only here** |

`artifacts/kub/src/components/profile/ProfileRoleSummary.tsx` is the component the
badge design is going to reuse, and its gate is the defect:

```ts
const canReadDynamicRoles = dynamicRolesEnabled && access.isAdmin;   // :24
const canReadLocationSummaries = access.isStaff;                     // :25
```

For an admin it renders each global role as a `KubBadge` pill (`:89-108` compact,
`:124-150` full) with an `InfoHint` explaining what the role can do
(`ROLE_ACCESS_NOTE` :225-231), plus location memberships. For everybody else
`hasDynamicContent` is false and it falls back to `LEGACY_APP_ROLE_LABEL[user.role]`
(`:97-99`) — that is `profiles.role`, which is `user` for almost everyone, so an
ordinary member opening a contact card sees the word «Пользователь» and nothing
else.

Two further facts about it that the design has to correct rather than inherit:

- it hard-codes its own ladder, `roleRank()` at `:234-241`
  (`owner 0, tech_admin 1, admin 2, manager 3, user 4`), duplicating
  `roles.priority`; and its own two-colour map, `roleTone()` at `:243-245`, which
  never reads `roles.colour`. **`roles.colour` is not read as data anywhere in the
  client outside the admin editor.**
- it is behind a second gate, `dynamicRolesEnabled`, a `localStorage` preference
  (`rolePermissions.ts:5` `kub.dynamicRoles.enabled`).

Two more facts, both relevant and both recorded here so they are not rediscovered:

- **`achievements_sync()` runs in exactly one place**: `lib/achievements.ts:38`,
  inside `loadAchievementState()`, which runs when the «Оформление» disclosure is
  opened (`ProfileDecorationSection.tsx:38`). So an achievement is only awarded
  when its holder opens that one settings section. Anyone who has never opened it
  holds nothing, and a badge strip would be empty for them for no reason a reader
  could guess.
- **`profile_background` is never painted anywhere except the settings preview**,
  although the copy at `ProfileDecorationSection.tsx:206` promises «Подложка
  карточки профиля — той, что открывается, когда на вас нажимают в чате.»
  `MessageActorAvatar` (`ChatAvatar.tsx:314-363`) and `ChatAvatar` (`:154-207`)
  have no frame support either; only `UserAvatar` (`:249-312`) draws the ring, so
  the frame shows in the member list and not on the card.

---

## 2. What is missing

**(a) Per-group configurable roles — everything.**

1. No table holds a role that belongs to a chat. `chat_roles` does not exist;
   `roles` has no `chat_id`, and its three chat-scope rows are deactivated and
   assigned to nobody.
2. No table assigns anything to a (chat, person) pair beyond
   `chat_members.role`, which is a three-value enum with no name, colour, icon or
   order.
3. No RPC a group owner may call. Every role RPC is gated on `roles.manage` or
   `users.assign_roles`, which are global administrator permissions.
4. No surface. `ChatInfoPanel` has two tabs, `info` and `members` (`:1201`).
5. The five `chats.*` permission keys exist and are evaluated by nothing.

**(b) The global badge display — one thing, and it is a read path.**

1. An ordinary account cannot read anybody else's global role. Both `roles` and
   `user_global_roles` refuse it (section 1.1), and `location_members` refuses the
   location half. This is the single blocker; everything else in part 2 of the
   request is presentation.
2. `roles` has no icon and no notion of "this role is shown to everyone" — a badge
   ladder keyed to `priority` would otherwise badge `user`, which everybody holds.
3. No component reads `roles.colour`, and `ProfileRoleSummary` carries a second,
   hard-coded ladder that would have to be deleted rather than extended.

**(c) What the achievements system cannot already express.**

1. **A subscription purchase.** Every `subscription` in this repository is a Web
   Push one (`20260427_push_subscriptions.sql:4`,
   `artifacts/kub/src/lib/browserPushSubscription.ts`). There is no payment, no
   entitlement, no period. Queue item 24 of the tracker (`:414`) is where it
   belongs and it is explicitly «later, not now».
2. **Premium standing.** Zero occurrences of `premium` or «премиум» in the client,
   the API server or the migrations. A medal saying so would have nothing behind
   it.
3. **A medal that expires or renews.** `user_achievements` has `granted_at` and no
   `expires_at`; `achievement_grant` is a boolean grant/revoke. A subscription
   badge needs a period, which is a schema change, not a seed.
4. **A medal earned by anything other than the four criteria kinds.** `manual`,
   `registered_before_milestone`, `account_age_days`, `messages_sent`. Nothing
   counts reactions, media, invitations, or days active.
5. **A medal awarded without its holder opening the settings screen** — see the
   `achievements_sync` note above.

Everything else part 2 asks for — a medal, its title, its reason in words, its
icon, its rarity, who holds it, readable by any signed-in account — **exists**.

---

## 3. Discord's model, stated, then mapped

Stated plainly, because the design is judged against it:

- **A role belongs to a guild, not to the product.** Every guild has its own set;
  `@everyone` is the implicit bottom role every member holds.
- **Roles are an ordered list.** The order is the hierarchy: a member may only
  manage roles below their own highest role, and may only act on members whose
  highest role is below theirs.
- **A role carries a colour, a name, an optional icon, and a permission
  bitfield.** Permissions are a union across all of a member's roles, with
  channel-level overwrites on top.
- **A member holds several roles at once.** The **highest role that has a colour**
  paints the member's name in the member list and in messages; roles without a
  colour are skipped for that purpose. The member list can be grouped by role
  ("hoisting").
- **Badges are account-level, not guild-level.** They sit on the profile card —
  Nitro, boosting, developer, early supporter, HypeSquad house, verified bot — and
  each has a tooltip naming it. The house ("Squad") is one such account-level mark
  with its own coloured crest.

The mapping onto this product, with what it costs:

| Discord | Here | Note |
| --- | --- | --- |
| Guild | A group chat (`chats` where `type = 'group'`) | Channels are the same row with `type='channel'`; D-169 records that they wrongly render the group panel |
| `@everyone` | `chat_members.role = 'member'` | Already exists; no row needed |
| Role order | `priority`, higher first, ties meaningful | The semantics and the whole client module already exist and are reusable unchanged |
| Role colour | A hex constrained to six digits | Constraint, validator and swatch already exist — but see 4.5, the colour cannot paint a name here |
| Role permissions | `public.permissions` keys, reused | **One vocabulary, not two.** `chats.invite`, `chats.manage_invites`, `chats.moderate`, `chats.manage_roles` already exist and are evaluated by nothing |
| "Manage roles below your own" | `enforce_chat_member_update`'s shape: owner full control, admin a named narrow set | Simpler and already reviewed; a second hierarchy inside a chat is not worth its failure modes in v1 |
| Account-level badges | Global role + achievements | Global role needs a read path; achievements need none |
| Squad crest | The global role's icon and colour, one chip | The «в зависимости от локации работника» half needs a second read path and an owner decision — see 7.2 |

**What is deliberately not copied.** Channel-level permission overwrites; role
hoisting (grouping the member list by role); a per-member role hierarchy check on
assignment; and a permission bitfield — this product has string keys with a
foreign key to a catalogue, which is better here and already gated everywhere.

---

## 4. The design

### 4.1 The principles it is held to

1. **One permission vocabulary.** A chat role's permissions are rows in
   `public.permissions`, by foreign key. No bitfield, no second catalogue, no new
   `has_*` tier that a reader has to learn.
2. **Presentation never grants.** `priority`, `colour`, `icon` and `badge` decide
   order and pixels and nothing else, and every column comment and module header
   says so — the rule `20260904080000` established and `roleHierarchy.ts:14-20`
   repeats.
3. **Two ladders that are never compared.** The global ladder and a chat's ladder
   are separate, exactly as `roles.scope` already separates global from location.
4. **A face, not a table.** What a badge shows is a small public projection —
   name, colour, icon, rank — and never a permission, an assignment date or who
   assigned it.
5. **An unknown value renders plain.** The `canRenderCosmetic` rule
   (`profileCosmetics.ts:89-95`) and the achievements header's «a decoration the
   running build does not recognise simply renders plain» apply to icon names
   too, so the database and the build can move independently.

### 4.2 Migration A — the public face of a global role

Follows the conventions of the two migrations read for this document —
`20260904080000_roles_priority_and_colour.sql` (additive columns, a check
constraint, a seeded ladder, a column comment stating that it grants nothing, and
the RPC re-created rather than overloaded) and
`20260911151000_user_achievements_signed_in_only.sql` (one transaction,
`set local lock_timeout = '5s'`, a `do $$ … raise exception` self-check that
refuses a half-applied state, a policy comment, a matching `.rollback.sql`).

```sql
alter table public.roles
  add column if not exists badge_icon text,
  add column if not exists badge_public boolean not null default false;

alter table public.roles
  drop constraint if exists roles_badge_icon_format_check;
alter table public.roles
  add constraint roles_badge_icon_format_check
  check (badge_icon is null or badge_icon ~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$');
```

`badge_icon` is a `KubIcon` name. It cannot be constrained to the union in SQL, so
the regex bounds it to something safe to put in a lookup and the client renders
plain when the build does not know the name.

`badge_public` is the answer to "which roles are badges". It defaults to **false**,
so nothing changes until it is set, and `user` — which everybody holds — stays off
the strip, the way Discord does not badge `@everyone`.

Seed, global scope only:

| key | name | badge_icon | colour (already seeded) | priority |
| --- | --- | --- | --- | --- |
| `owner` | Владелец | `crown` | `#F5B50A` | 100 |
| `tech_admin` | Тех. администратор | `admin` | `#4d8bd0` | 100 |
| `admin` | Администратор | `shield` | `#f04a92` | 80 |
| `manager` | Менеджер | `manager` | `#4DCD5E` | 60 |
| `user` | Пользователь | — | null | 10 |

The «чем выше статус тем красивее иконка» ladder is the icon **plus its weight**,
which `KubIcon` already takes as a prop: priority ≥ 100 renders `weight="fill"`,
80–99 `"bold"`, below that `"regular"`. That is a ladder inside the existing icon
system with no new asset pipeline, and it degrades to a legible glyph if the rule
is ever removed.

**The read path — one RPC, not a policy change.**

```sql
create or replace function public.profile_badges(p_user_ids uuid[])
returns table (
  user_id uuid,
  kind text,        -- 'global_role' | 'achievement'
  key text,
  title text,
  detail text,
  icon text,
  colour text,
  rank integer
)
language sql
security definer
stable
set search_path = public
```

Why an RPC rather than widening the policies on `roles` and `user_global_roles`:

- it returns **exactly** the six presentation fields and can never return a
  `role_permissions` row, an `assigned_by` or an `assigned_at`;
- `roles.view` keeps meaning what it means today, so nothing about the admin panel
  or the 24 policies that read `has_permission` moves;
- it keeps the invariant the 2026-09-11 security audit recorded and CLAUDE.md
  quotes — «no view readable without `security_invoker`» — because it adds no
  view;
- one round trip for a whole member list, which is the same argument
  `20260710_current_user_access_snapshot.sql` already made for the current user.

Its own guards, each for a named reason:

- `auth.uid() is null` → returns nothing. Badges are for people in the product
  (the D-107 rule, restated).
- `array_length(p_user_ids, 1) > 200` → raises `too_many_ids`. Without a cap a
  `security definer` function that bypasses RLS is an enumeration tool.
- `is_banned(auth.uid())` → returns nothing, matching the restrictive ban read
  policies the rest of the product carries.
- only `roles` rows with `scope = 'global' and is_active and badge_public`.
- only `achievements` rows with `active`, and only for profiles where
  `not is_test_account` — the same exclusion
  `20260904030000_achievement_recipients_exclude_test.sql` already applies.
- `revoke all … from public, anon; grant execute … to authenticated;` — the
  pattern every function in `20260514…:419-427` uses.

`rank` is `roles.priority` for a role and `100000 - achievements.sort_order` for a
medal, so one sort orders the whole strip with roles first and the catalogue's own
order preserved inside the medals.

**`role_update` gains the two parameters, and the old signature is dropped first.**
`20260904080000…:86-93` records the trap in detail and it applies again: adding
parameters with defaults creates an **overload**, and the existing six-argument
call from `RolesPermissionsTab.tsx:343-344` would then match both and fail as
ambiguous. `drop function if exists public.role_update(uuid, text, text, boolean,
integer, text);` comes first, and the new eight-argument function keeps the
permission check, the system-role protection and the last-owner guard verbatim.

### 4.3 Migration B — roles inside a group

```sql
create table if not exists public.chat_roles (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  name text not null,
  colour text,
  icon text,
  priority integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_roles_name_length check (length(btrim(name)) between 1 and 32),
  constraint chat_roles_colour_format check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$'),
  constraint chat_roles_icon_format check (icon is null or icon ~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$')
);

create unique index if not exists chat_roles_chat_name_idx
  on public.chat_roles (chat_id, lower(btrim(name)));

create index if not exists chat_roles_chat_priority_idx
  on public.chat_roles (chat_id, priority desc, name);

create table if not exists public.chat_member_roles (
  chat_id uuid not null,
  user_id uuid not null,
  role_id uuid not null references public.chat_roles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (chat_id, user_id, role_id),
  foreign key (chat_id, user_id)
    references public.chat_members (chat_id, user_id) on delete cascade
);
```

The composite foreign key is the point: `chat_members`' primary key is
`(chat_id, user_id)`, so **leaving a chat drops the tags with the membership**, and
a tag can never name somebody who is not a member. No trigger, no cleanup job.

The colour constraint is byte-identical to `roles_colour_format_check`
(`20260904080000…:47-49`) so `normalizeRoleColour` and `roleSwatchColour` keep
being the one validator on the client. This is reuse of a **primitive**, not of a
role: D-168 is explicit that `roles.colour` itself «belongs to a global role
definition — one colour shared by everyone holding that role — so it cannot
express one person's tag in one group. Do not reach for it as if it could.» The
new table is why.

**Bounds, enforced by a trigger rather than hoped for**: at most 25 roles per
chat and at most 5 roles per member. Both are what the strip can draw and what the
RLS can join cheaply; both raise a named error (`chat_roles_limit`,
`chat_member_roles_limit`) rather than truncating.

**RLS.** Reads are for the chat's members; writes are blocked and go through RPCs,
the shape `20260514…` already established for `roles`:

```sql
create policy "chat roles visible to members"
  on public.chat_roles for select to authenticated
  using (public.is_chat_member(chat_id));
create policy "chat roles insert blocked" on public.chat_roles
  for insert to authenticated with check (false);
-- update, delete: the same, using (false)
```

and identically for `chat_member_roles`. The four restrictive ban vetoes that
every other table carries (`20260504_roles_admin.sql:410-449`) are generated for
both.

**Who may edit what**, mirroring `enforce_chat_member_update`'s shape rather than
inventing a second hierarchy:

| Action | Who | RPC |
| --- | --- | --- |
| create, rename, recolour, reorder, delete a role | `is_chat_owner(chat_id)` | `chat_role_create`, `chat_role_update`, `chat_role_delete` |
| assign or remove a role that carries **no** permission | `is_chat_admin(chat_id)` | `chat_member_role_set` |
| assign or remove a role that carries any permission | `is_chat_owner(chat_id)` | the same RPC, stricter branch |

A global moderator holding `chats.moderate` is **deliberately not** given these.
Moderating a conversation and rewriting a group's own vocabulary are different
powers, and the first does not imply the second; if the owner wants it, it is one
`or has_permission(auth.uid(),'chats.moderate')` and an owner decision, not a
default.

Every RPC is `security definer`, `set search_path = public`, refuses a banned
actor through `_require_permission`'s shape, and writes an `audit_logs` row —
`chat_role_created`, `chat_role_updated`, `chat_role_deleted`,
`chat_member_role_set` — because `20260505_audit_logs.sql:278-281` already audits
`chat_member_role_changed` and a tag that confers a permission deserves the same.

**Realtime.** Both tables must be added to the `supabase_realtime` publication or
the member list will never update itself. This is the exact defect
`20260906130000_publish_permissions_table.sql` records: the roles screen «has
never updated itself, and the reason was one binding out of four». The migration
adds them and its self-check asserts the publication and that RLS is on, which is
what makes the publication safe — realtime applies the read policy per subscriber.

**Permissions on a chat role** are *not* in this migration. A table nothing
evaluates is the thing `20260904060000` had to clean up. They arrive in slice 7
with the function that reads them.

### 4.4 How a colour and an icon reach the message list without a query per message

Three facts decide this, all measured rather than assumed:

1. **Every message row already carries its sender's whole profile.**
   `artifacts/kub/src/lib/messageProjection.ts:7-8` — `MESSAGE_SELECT_WITH_JOINS`
   selects `sender:profiles!user_id(*)`, so `MessageBubble` reads
   `message.sender` with no lookup (`MessageBubble.tsx:842`, via
   `lib/messageActor.ts:16-49`). There is no profile cache the bubbles consult.
2. **A per-chat member map already exists.** `MessageList.tsx:508-525` builds
   `people: Map<userId, Profile>` from the `chatMembers` prop (`:76`), fed from
   `chat?.members` in `ChatWindow.tsx:1131` and loaded by `useChats.ts:162-165`.
   Today it is passed only to `MessageActionLayer` (`MessageList.tsx:1308`).
3. **Bubbles are memoized and the memo is a contract.** `MessageList.tsx:1479-1487`
   and the comment at `MessageBubble.tsx:836-840`: any new prop must be
   `Object.is`-stable, and a new `useAppStore` subscription inside the bubble
   defeats the memo for every message on screen.
   `tests/e2e/chat-list-event-cost.spec.ts` counts renders on the neighbouring
   list and is the template for proving it.

The design, therefore:

- **One badge cache, keyed by user id, at module level**, exactly the shape
  `useRole.ts:26-27` already uses for `accessCache` and `permissionCache`. A hook
  `useProfileBadges(userIds)` calls `profile_badges` once for the ids it does not
  hold and returns a `Map<string, BadgeFace[]>`.
- **The senders in a conversation are its members**, so one call per chat open
  covers the whole scrollback, and a private chat is two ids. It is not a call per
  message, per bubble, or per render.
- **The map is threaded down the existing `chatMembers` path** into
  `MessageList`'s `people` map and then to `MessageRow`, as one stable reference
  per chat. It changes identity once, when the fetch resolves, which costs one
  re-render of the visible bubbles — and that is the number the slice's gate
  measures.
- **A chat role's colour costs nothing extra**: it is fetched with the members,
  because `useChats.ts:162-165` already selects `members:chat_members(…)` and
  gains `roles:chat_member_roles(role_id)` plus the chat's `chat_roles` rows in
  the same statement.

**The fallback, if the render count refuses.** Denormalise the face onto
`profiles` as a trigger-maintained presentation column, which is free per message
because `sender:profiles!user_id(*)` already fetches it. It is written here as the
second choice, not the first, because it is a cache in a table its owner may
update: it would need its own `profiles_validate_*` guard, in the shape
`profiles_validate_cosmetics` (`20260903210000…:86-134`) already provides, and a
fan-out trigger on `roles` and `user_global_roles`. Do not reach for it before
slice 4's measurement says the map is too expensive.

### 4.5 The badge vocabulary

Three families, told apart by shape before colour, so that colour is never the
only carrier of meaning — `KubBadge`'s existing rule.

**Family 1 — the standing (the «Squad» slot).** At most one chip. Filled icon,
role colour on the icon and the border, label in `--kub-text`.

| Role | Chip | Tooltip | Icon |
| --- | --- | --- | --- |
| `owner` | «Владелец» | «Полный доступ: все разделы и настройки приложения.» | `crown`, fill |
| `tech_admin` | «Тех. администратор» | «Технические разделы: обновления, боты, диагностика.» | `admin`, fill |
| `admin` | «Администратор» | «Управление людьми: пользователи, приглашения, баны.» | `shield`, bold |
| `manager` | «Менеджер» | «Рабочие разделы и задачи закреплённых локаций.» | `manager`, regular |

The tooltips are already written: `ROLE_ACCESS_NOTE` in
`ProfileRoleSummary.tsx:225-231`. Reuse them; do not write a second set.

**Family 2 — the medals.** Outline icon, neutral tone, the catalogue's own title
as the label and its own description as the tooltip, plus the rarity line
`describeAchievementShare` already produces.

| Key | Chip | Tooltip | Icon today |
| --- | --- | --- | --- |
| `tester` | «Тестировщик» | «Был с LETSCUBE во время альфа-тестирования» | `shield` |
| `alpha_tester` | «Альфа-тестер» | «Был с LETSCUBE во время альфа-тестирования» | `shield` |
| `beta_tester` | «Бета-тестер» | «Был с LETSCUBE до выхода 1.0» | `zap` |
| `settled_in` | «Освоился» | «В LETSCUBE больше месяца» | `check` |
| `veteran` | «Ветеран» | «В LETSCUBE больше года» | `crown` |
| `conversationalist` | «Собеседник» | «Отправил 100 сообщений» | `chats` |
| `storyteller` | «Рассказчик» | «Отправил 1000 сообщений» | `chatRect` |

**Two icon collisions have to be resolved before this ships, and they are data,
not schema.** `crown` would mean both «Владелец» and «Ветеран»; `shield` would
mean «Администратор», «Тестировщик» and «Альфа-тестер» — and the last two collide
with each other already, today, inside the settings screen. Proposed, one `update`
per row against `public.achievements.icon`, all names from the existing 106:

- `veteran` : `crown` → `clock` — a year is time, not rank;
- `tester` : `shield` → `key` — the first people let in;
- `alpha_tester` : `shield` → `zap`, and `beta_tester` : `zap` → `bookmark`.

This changes a badge somebody already holds, so it is an owner decision and its
own step, shown as pixels before it is applied.

**Family 3 — the subscription and premium.** Designed and **not built**. The RPC's
`kind` column leaves room for `'subscription'`, the strip's ordering leaves it the
slot right after the standing, and nothing else is written, because section 2(c)
shows there is no data behind either. The honest sequence is queue item 24 of the
tracker first, this second.

---

## 5. The surfaces

All four are governed by `docs/operations/interface-material.md`. Four of its
rules bite here, and each is cited where it applies rather than restated in the
abstract.

### 5.1 The member list in the group information panel

`ChatInfoPanel.tsx:2214-2284`, `GroupMemberRow`.

The second line, today «Владелец» or «Администратор» in plain accent text for two
roles out of three and empty for everyone else, becomes the tag strip: the chat
roles first, in `priority` order, then the standing chip, then at most two medals
and a «+N» for the rest. The crown and shield icons on the name line stay — they
say something the strip does not, namely who runs this conversation.

**Rule 6, «nothing that scrolls or repeats».** A member row repeats, so no chip in
it may be glass. They are flat fills with a border — which is what `KubBadge`
already is, and it is listed under rule 11's «a line that means something» as one
of the four things that keep a perimeter. Reuse `KubBadge`; do not write a chip.

**Rule 11.** The row itself gains no perimeter; the strip separates from the name
by the line above it, not by a box.

Copy: the strip has no heading. An empty strip renders nothing — not «Без роли»,
which would be a claim where there is a gap.

### 5.2 The contact card

`ChatInfoPanel.tsx:1426-1436`, which already mounts
`<ProfileRoleSummary user={otherUser} compact />`. This is the slot; the work is
to make it true for everyone.

- delete `canReadDynamicRoles` (`:24`) and the `LEGACY_APP_ROLE_LABEL` fallback
  (`:97-99`), and read from `useProfileBadges` instead;
- delete `roleRank` (`:234-241`) and sort by the `rank` the RPC returns, so there
  is one ladder in the product and it is `roles.priority`;
- delete `roleTone` (`:243-245`) and take the colour from the face;
- keep `ROLE_ACCESS_NOTE` (`:225-231`) and the `InfoHint` wrapper (`:137-150`) —
  the «за что» half of the request is already written there.

In the full (non-compact) form, a second section under «Глобальные роли»:

```
Достижения
[icon] Ветеран      В LETSCUBE больше года · у 12% участников
[icon] Собеседник   Отправил 100 сообщений · у 40% участников
```

Heading «Достижения», matching the word the settings screen already uses; the
rarity clause from `describeAchievementShare` (`achievementRules.ts:135`). When a
person holds none, the section is absent — not «Достижений нет».

**Rule 3.** The card is `kub-glass-strong` and its `backdrop-filter` is the
containing block for every fixed descendant — measured in D-168's own table
(`INTERFACE_DEFECT_REGISTER.md:8274-8285`). Any tooltip or menu the strip opens is
portalled unconditionally, at a layer above the panel's `z-[60]`
(`lib/profileWindow.ts:74, :87`). `InfoHint` must be checked against this before
it is reused inside the card, not after.

### 5.3 The message bubble's author line

`MessageBubble.tsx:1247-1256`. The line is already a flex row with `gap-1.5`, a
truncating name, and exactly one decoration — the «Бот» pill:

```tsx
<span className="ml-3 mb-0.5 inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[color:var(--kub-accent-text)]">
  <span className="truncate">{actorName}</span>
  {actor.kind === "bot" && ( … Бот … )}
</span>
```

**One chip, never a strip.** The highest-ranked tag the sender holds in this chat,
falling back to the standing when they hold no chat role, and nothing at all for
an ordinary member. Discord shows a colour here, not a list, and a conversation is
the one place where a second line of ornament costs reading.

Shape: the «Бот» pill's, so the conversation has one idiom rather than two —
`text-[9px] font-semibold uppercase`, a flat tinted fill, no border, no blur.
**Rule 6** again, and the chat screen's own note that chips in the conversation
take `--kub-chat-chip`, a flat token fill, because «over a patterned ground a word
needs a ground of its own». The «Бот» pill's hand-mixed
`color-mix(in_srgb,var(--kub-cyan)_14%,transparent)` predates that token; moving
both onto `--kub-chat-chip` is the right cleanup and belongs to this slice.

The author line is rendered in private chats too — `MessageBubble` has no
`chatType` prop at all — so the chip must be gated on the chat being a group, or
every private conversation grows a tag beside a name the reader already knows.

### 5.4 The group owner's role editor

**It has a home already, and it is not a new tab.** D-164's group settings screen
landed in this worktree while this document was being written:
`artifacts/kub/src/lib/chatSettings.ts` is a pure row model — free of React and of
every browser API, so `node --test` reads it — and
`artifacts/kub/src/components/chat/ChatSettingsView.tsx` draws it. A row is
`{ id, label, value, kind: "choice" | "toggle" | "navigate" | "danger", editable }`
with **the current value on the right**, and the module's header states the rule
this design has to respect: «Only rows that exist. A row is here when the product
can really change or really show the thing it names.»

So the editor is reached by one new row, added to `ChatSettingsRowId` and to the
builder beside `administrators` and `members`:

```
Роли                                          4 роли  ›
```

`kind: "navigate"`, `value` from a plural helper in the shape of
`memberCountValue` («1 роль», «2 роли», «5 ролей»), `editable: isOwner`. A group
with no roles yet still shows the row with «Нет ролей», because the screen's own
rule is that a row a person may only read still shows its value. The row is
absent for a private conversation, which has no settings screen at all.

This also settles the ordering question: **slice 5 must not start before that
work is committed**, or the two will collide in the same two files.

Shape of the editor itself: `RolesPermissionsTab.tsx`'s, not its code — that component is bound to the
global tables and to `roles.manage`. What is reused literally is
`lib/roleHierarchy.ts`: `sortRolesByHierarchy`, `planPriorityMove`,
`normalizeRoleColour` and `roleFormSignature` all take structural arguments, so a
chat role passed as `{ id, key: id, name, scope: "chat", priority }` uses the
module unchanged. If that reads badly in review, widen `RoleRankFields` to make
`key` optional — two lines, with `tests/unit/role-hierarchy.test.mts` as the gate.

Russian copy, complete:

| Element | String |
| --- | --- |
| Settings row | «Роли», value «4 роли» / «Нет ролей» |
| Screen title | «Роли группы» |
| Empty state | «В этой группе пока нет ролей» + «Роль — это подпись рядом с именем: название, цвет и значок.» |
| Create | «Новая роль» |
| Name field | «Название» / placeholder «Например: Модератор» |
| Colour field | «Цвет» / hint «Цвет отвечает за значок и рамку подписи, не за цвет имени.» |
| Icon field | «Значок» |
| Order | «Старшинство» / hint «Старшинство решает только порядок в списке. Права оно не выдаёт.» |
| Move controls | «Поднять» / «Опустить» |
| Save | «Сохранить» |
| Delete | «Удалить роль» / confirm «Удалить роль «{name}»? Она пропадёт у всех участников группы.» |
| Assignment, in the member action menu | «Роли участника» |
| Assignment sheet title | «Роли в группе» |
| Limit reached | «В группе уже 25 ролей» / «У участника уже 5 ролей» |
| Denied | «Менять роли группы может только владелец» |
| Name taken | «Роль с таким названием уже есть» |

The hint under «Старшинство» is not decoration. It is the same sentence
`20260904080000…:29-33` and `roleHierarchy.ts:14-20` both insist on, and it is the
one thing a visible hierarchy reliably makes a reader believe the opposite of.

The assignment control hangs off the member row's «ещё» menu, which already exists
and is already portalled and finger-reachable
(`ChatInfoPanel.tsx:1008-1048, :2256-2281`, fixed 2026-09-13). Its actions come
from `chatMemberRules.ts`; the new one is gated the same way, from a pure function
beside the others so the interface never offers what the server refuses — the
D-142 rule the register states.

### 5.5 The colour, and where it may and may not go

This is the one place where Discord's model and this product's measured contract
disagree, so it is stated as a rule rather than left to a component:

**A role colour may paint**: the chip's icon, the chip's border, a swatch, a dot.
Those need 3:1 and every seeded colour clears it — the same argument
`KubBadge.tsx:22-31` already makes.

**A role colour may not paint**: the label inside the chip, the member's name in
the list, or the sender's name in the conversation. Measured: a tone as a label on
`--kub-surface-3` gives 4.05:1, 4.18:1 and 3.82:1 against a floor of 4.5:1, and
the audit caught a real chip at 2.62:1. In the conversation it is worse — the
sender's name sits over the wallpaper, where the light theme's accent had to be
darkened twice, from `#2B45A3` at 4.52:1 to `#213A94` at 5.15:1, to clear the
floor at all (`interface-material.md`, «Measured»). An arbitrary `#rrggbb` chosen
by a group owner has no such guarantee in either theme.

If the owner wants the name itself coloured, the way to get it is a **curated
palette**: eight to twelve role colours, each photographed once on the wallpaper
and on both panel grounds in both themes, stored as a key rather than a hex. That
is a real option and it is the one Discord's freedom cannot be had honestly
without. It is not in the slices below; it is the decision that would add one.

---

## 6. The slices

Each is independently shippable, independently valuable, and has a gate that can
fail. Every slice's gate includes the standing ones — `pnpm.cmd --filter
@workspace/kub run typecheck`, the unit suite, the production build proved by its
own `sw.js build` and `built in Ns` lines rather than by its exit code, and
`git diff --check` — so only the slice-specific gates are listed. Every Playwright
run starts with `KUB_QA_ALLOW_MUTATIONS=0`.

**Slice 1 — a real global-role badge, on a real card, for an ordinary account.**

The smallest thing that shows the owner what he asked for. Migration A
(`badge_icon`, `badge_public`, the seed, `profile_badges`, `role_update`
re-created), a `useProfileBadges` hook with a module-level cache, and
`ProfileRoleSummary`'s compact form switched off `access.isAdmin` and onto it —
so an ordinary member opening a private chat's contact card sees «Владелец» with a
gold crown instead of the word «Пользователь».

Gate:
- `tests/unit/profile-badges.test.mts` — the projection from RPC rows to the
  strip: order by `rank`, the weight ladder, an unknown icon name rendering plain,
  an empty result rendering nothing.
- **Mutation, each proved separately**: set `badge_public = false` in the fixture
  and the strip must go empty; remove the `rank` sort and the order must go red;
  remove the unknown-icon guard and the test must throw rather than pass.
- The migration's own `do $$ … raise exception` block: the constraint exists, the
  four roles are public and `user` is not, `anon` holds no execute on
  `profile_badges`, and `authenticated` does.
- A read-only proof, on production, before applying: that a non-admin session
  reading `roles` still gets exactly one row, so the RPC is the only new door.
- `tests/e2e/profile-badges.spec.ts` — signed in as a non-admin QA account, open a
  contact card, assert the chip's text and that no permission string appears
  anywhere in the response.
- **Pixels**: both themes, desktop and 390, shown to the owner before it ships.

**Slice 2 — the medals on the same card.** The `achievement` half of
`profile_badges`, the «Достижения» section in `ProfileRoleSummary`'s full form,
and the icon-collision fix as its own reviewed step. Includes moving
`achievements_sync()` off «opens the settings screen» — one call per session at
sign-in, measured for cost — or the strip will be empty for people who have
earned things.
Gate: a unit test pinning the seven-row vocabulary and the two resolved
collisions; a spec that a second account's medals appear on the first account's
screen; a mutation that deactivates an achievement and watches the chip go.

**Slice 3 — the badge in the group member list.** `GroupMemberRow`'s second line.
No new query: the member ids are already in hand at `ChatInfoPanel.tsx:414-428`.
Gate: `member-actions-reachable.spec.ts` still green (the row's testids and the
«ещё» control must not move); a new assertion that a member with no tags renders
no empty strip; contrast photographed on the panel in both themes.

**Slice 4 — the badge in the message author line.** The per-chat map threaded
through `MessageList`'s existing `people` path, one chip, gated on the chat being
a group.
Gate: a render-count spec in the shape of `chat-list-event-cost.spec.ts` proving
the badge map costs **one** extra render of the visible bubbles and not one per
message; a mutation that subscribes the bubble to the store instead and watches
the count explode; contrast photographed over the wallpaper in both themes, since
that is the worst ground in the product.

**Slice 5 — per-group roles, cosmetic only.** Migration B without
`chat_role_permissions`, the three owner RPCs, the assignment RPC, the «Роли» row
in `lib/chatSettings.ts` with its screen, and the «Роли участника» action.
**Blocked until D-164's group settings work is committed** — it owns
`chatSettings.ts` and `ChatInfoPanel.tsx`, the same two files.
Gate: the migration's self-check (both tables published to `supabase_realtime`,
RLS on, the composite FK present); a rehearsal proving that deleting a membership
deletes its tags; `tests/unit/chat-role-rules.test.mts` written from the RPCs the
way `chat-member-rules.test.mts` was written from the trigger; mutations that an
admin cannot create a role and a member cannot assign one.

**Slice 6 — a group's colour on the member list and the author line.** The chat
role outranks the standing in both places; colour on the icon and the border only.
Gate: `status-badge-contrast.test.mjs` extended to the new chip, and a test that
asserts no code path puts a role colour on a text node.

**Slice 7 — permissions on a group's roles.** `chat_role_permissions` with its
foreign key to `public.permissions`, and `has_chat_permission(user, chat, key)`
that ORs `is_chat_admin` with the role's keys — reusing the four `chats.*` keys
seeded in 2026-05-14 and evaluated by nothing since.
Gate: a mutation per permission proving the interface and the server agree, in the
D-142 shape; an audit row per assignment.

**Slice 8 — the subscription and premium medals.** Blocked on tracker queue item
24. Not designed further here on purpose: a medal with no data behind it is the
one thing in this document that would be a relabelling.

---

## 7. Where the request meets something the product already does

**7.1 The role colour cannot paint a name.** The owner's reference is Discord,
where the highest coloured role paints the member's name. Here that is refused by
a measurement, not by a preference: `KubBadge.tsx:14-32` records a tone as a label
at 4.05:1, 4.18:1 and 3.82:1 against a 4.5:1 floor, and `status-badge-contrast.test.mjs`
holds it. Section 5.5 gives the two honest answers — colour on the icon and the
border, or a curated palette measured once. **This needs the owner's choice.**

**7.2 The «значок … в зависимости от локации работника» half re-opens a word the
product removed.** The location concept is the club one; CLAUDE.md section 7 says
to remove user-facing «компьютерный клуб» and gaming-club positioning, and
`20260904060000_roles_retire_dead_tiers_and_club_naming.sql` renamed the location
roles for exactly that reason. Showing «Сотрудник · <локация>» to every member of
every group puts it back in front of every user. It also needs a second read path:
`location_members` is readable only by an admin, the member themself, or that
location's admin (`20260513_locations_task_routing.sql:172-178`). **This needs the
owner's decision before it is built**; the standing chip in slice 1 works without
it.

**7.3 Making the standing public names the two highest-value accounts.** Today
only an administrator can learn who is `owner` or `tech_admin`. A badge tells
everyone which two accounts to attack. Discord accepts that trade; this product
has not been asked yet. It is a deliberate choice, and `badge_public` defaulting
to `false` is what keeps it one.

**7.4 Two of the three things a medal should "say" do not exist.** «покупка
подписки» and «статус условно премиум» have no table, no column and no occurrence
anywhere in the client, the API server or the migrations. Slice 8 is where they
go, after tracker item 24.

**7.5 `user` must not be badged.** Everybody holds it, so a chip reading
«Пользователь» is noise on every row — and it is what `ProfileRoleSummary` shows
today, which is why the contact card currently looks as though the feature is
missing rather than gated.

**7.6 The catalogue has icon collisions.** `crown` would mean both «Владелец» and
«Ветеран»; `shield` would mean «Администратор», «Тестировщик» and «Альфа-тестер»
— and the last two already collide with each other in the settings screen today.
Section 4.5 proposes the four-row fix; it changes a badge somebody holds, so it is
the owner's call.

**7.7 D-168's reading of the tag is not Discord's.** The register describes the
reference pack's tag as «per person in one chat, with its own text and colour, and
the holder can change their own» (`INTERFACE_DEFECT_REGISTER.md:8464-8466`). Discord
has no such object; its nearest equivalent is a per-guild **nickname**, which the
holder may change, while roles are assigned by the group and never self-chosen.
The owner's own sentence says «по типу ролей в дискорде», so this document designs
roles. A self-editable per-guild nickname is a separate, much smaller thing — one
nullable column on `chat_members` and an update policy on your own row — and it
can be added later without touching any of the above. **Worth confirming which he
meant.**

**7.8 The chat-scope rows in `roles` must stay dead.** `chat_owner`, `chat_admin`
and `chat_member` were deactivated by `20260904060000` because nothing evaluates
them and they cannot name a chat. Reviving them instead of adding `chat_roles`
would be exactly the relabelling the owner ruled out, and D-168 says so in as many
words.

**7.9 There are two role ladders in the client and one has to go.**
`roles.priority` is the data; `roleRank()` in `ProfileRoleSummary.tsx:234-241` is a
hard-coded copy of it. Slice 1 deletes the copy. Leaving both is how the two
disagree the first time a role is added.

**7.10 A medal is only awarded when its holder opens one settings screen.**
`achievements_sync()` has one call site (`lib/achievements.ts:38`, from
`ProfileDecorationSection.tsx:38`). Until slice 2 moves it, a badge strip is
correct and empty for anybody who has never opened «Оформление», which reads as a
broken feature rather than an unearned badge.
