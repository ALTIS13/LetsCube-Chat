# QA Results

Снимок аудита: 2026-05-05. Test domain: `https://kub.apollot.ru` временный; домен нельзя хардкодить в source code.

## Passed

- Supabase MCP read-only подключение работает для проекта `nhogbeojfnbjcfipitrh`.
- В `public` найдено 17 таблиц, RLS включен на user-facing таблицах.
- Realtime publication содержит `bans`, `chat_members`, `chats`, `folder_chats`, `folders`, `messages`, `mutes`, `notifications`, `profiles`, `reactions`, `task_events`, `tasks`, `topics`.
- `tasks` и `task_events` используют direct write block policies; mutations идут через SECURITY DEFINER RPC.
- Sidebar source уже содержит `min-w-0`, fixed 36px icon buttons и profile menu с admin entry.
- Auth callback в frontend доменно-агностичный: redirect строится от текущего origin, не от hardcoded `kub.apollot.ru`.
- Heartbeat source использует singleton/refcount и throttle; `useChats`, `useTasks`, `useNotifications` уже имеют стабильные channel names и debounced refetch.

## Failed

- Auth logs за последние 24 часа все еще показывают `referer=tg.letscube.ru`. Это не доказывает hardcode в source code, но означает, что Supabase Auth URL/settings нужно держать под контролем при смене домена.
- Supabase Auth logs показывают ошибки `missing Twilio account SID` на `/user` при phone update. Это отдельный Supabase Auth/SMS configuration вопрос, не frontend service_role проблема.

## Applied In Production Supabase

- Task privacy/assignment уже применены: `tasks.visibility`, `tasks.assignment_scope`, `task_create_v2`, `task_update_v2`, `task_claim`, RLS `tasks select with visibility`.
- Storage `media` уже переведен на scoped policies: `media authenticated scoped read`, `insert`, `update`, `delete`.
- Folders policy cleanup уже применен: legacy `folders`/`folder_chats` `*_own` policies отсутствуют, остались scope-aware policies и restrictive banned-user guards.
- User manually applied `.migration-backup/supabase/migrations/20260507_message_hide_for_me.sql`; read-only MCP confirmed `message_hidden_for_users`, authenticated-only RLS policies and `hide_message_for_me` / `unhide_message_for_me` RPC.
- User manually applied `.migration-backup/supabase/migrations/20260507_message_hide_for_me_grants_hardening.sql`; read-only MCP confirmed `anon`/`PUBLIC` table/function grants are absent and authenticated access remains.
- User manually applied `.migration-backup/supabase/migrations/20260508_messages_client_message_id.sql`; read-only MCP confirmed `messages.client_message_id`, `messages.client_sent_at`, server `created_at default now()` and the idempotency lookup/unique indexes.

## Needs Manual Verification

- Browser QA на `https://kub.apollot.ru`:
  - login/logout/session restore;
  - direct refresh `/admin`, `/tasks`, `/auth/callback`;
  - sidebar profile menu на desktop и admin panel entry;
  - notifications popover;
  - tasks page/admin/audit;
  - folders create/edit/delete/add/remove chat;
  - voice recording/send/playback;
  - themes light/dark/system;
  - responsive 390px, 768px, 1280px.
- Network QA:
  - idle 2 минуты без request storm;
  - heartbeat примерно не чаще штатного интервала;
  - realtime websocket остается подключенным;
  - нет повторяющихся `Failed to fetch` / `ERR_INSUFFICIENT_RESOURCES`.
- Email confirmation UX:
  - успешная ссылка ведет на текущий `/auth/callback`;
  - expired/invalid link показывает дружелюбное сообщение, а не raw Supabase JSON.

## Needs DB Migration

- No pending DB migration for message hide-for-me or delivery receipts after the user's 2026-05-07 manual applies. Future group read-count/all-delivered UX would need a separate schema design.

## Needs UX Polish

- Chat list search сейчас ищет по названию чата и last message text, но не по всем сообщениям.
- In-chat search работает только по загруженным сообщениям текущего чата, не по всей истории.
- Нет глобальной search/command palette.
- Task filters пока не знают о pool/unassigned/visibility; SQL уже применен, следующий этап - frontend alignment на `task_create_v2`, `task_update_v2`, `task_claim`.
- Chat overview в `useChats` все еще делает per-chat last-message/unread enrichment; при росте количества чатов стоит вынести это в RLS-safe RPC/view отдельной миграцией.

## Browser QA Notes

Safe QA note: Live QA should use the Codex/QA browser session or QA credentials from a secure environment; never store secrets in the repo and do not depend on the user's mouse/manual browser.

2026-05-09 notifications/group-invites stage note:

- Live/authenticated QA must use the Codex/QA browser session or local QA credentials kept outside the repo.
- Do not store QA passwords, auth tokens, cookies or service-role keys in docs, `.env.example`, README or committed source.
- Group invites required manual application of `.migration-backup/supabase/migrations/20260509_group_invites.sql`; the user later applied it on 2026-05-10, while the frontend keeps the migration-required fallback for other environments.
- SQL was not applied automatically during this stage.

2026-05-05 logged-in Browser QA на `https://kub.apollot.ru`:

- Sidebar/profile menu на desktop работает; пункт `Админ-панель` доступен из меню профиля.
- Sidebar search/notification/new chat icons проверены на 390px, 768px и 1280px; document horizontal overflow не обнаружен.
- Notification bell открывается и не выталкивает layout за пределы sidebar.
- Direct refresh `/admin` проходит, dashboard и audit tab открываются без console errors.
- `/tasks` открывается, текущий task UI еще не выровнен под `visibility`/`assignment_scope`/`task_claim`.
- Network на admin dashboard показал лишние повторные metric count-запросы от realtime `profiles` updates; frontend fix убрал `profiles` realtime trigger для dashboard и добавил overlapping-load guard.
- Скриншоты не коммитить; локальные browser artifacts остаются untracked.
- Replit overlay/banners checked: production `kub.apollot.ru` не должен показывать Replit preview UI; `IframeAuthBanner` ограничен Replit iframe-контекстом, а Replit runtime overlay отключен для production build.

## Phase 2 Task V2 Inspection

2026-05-05 Supabase MCP read-only подтвердил, что production Supabase уже готов для task v2:

- `tasks.visibility task_visibility not null default 'staff'`.
- `tasks.assignment_scope task_assignment_scope not null default 'user'`.
- enums `task_visibility = staff/private/chat` и `task_assignment_scope = user/manager_pool/staff_pool`.
- RPC `task_create_v2`, `task_update_v2`, `task_claim`.
- RLS `tasks select with visibility` и `task_events select with visibility`.
- Direct writes to `tasks` / `task_events` blocked; mutations go through RPC.
- Realtime publication includes `tasks` and `task_events`.

Repo state:

- `artifacts/kub/src/types/database.ts` already contains task v2 columns, enums and RPC types.
- `docs/SUPABASE_SCHEMA_MAP.md` and `docs/SUPABASE_CURRENT_STATE.md` already describe task v2 as applied.
- `docs/SUPABASE_MIGRATION_RULES.md` was updated so the 20260505 task/storage/folders SQL files are no longer marked as pending.

Frontend gap:

- `TaskFormModal` still calls compatible old RPC `task_create` / `task_update`.
- `TaskAssignModal` still calls `task_assign`.
- `task_claim` is not used in UI yet.
- Task cards/details do not yet show `visibility` / `assignment_scope` badges.
- Task filters do not yet expose pool/private/staff/chat views.

Next safe task UI alignment:

1. Read-only UI badges for task `visibility` and `assignment_scope`.
2. Add `task_claim` button for eligible staff pool tasks.
3. Add staff-friendly task filters for my/available/waiting/all/private/chat.
4. Move create/edit to `task_create_v2` / `task_update_v2` with client-side guards while keeping RLS/RPC as source of truth.

## Phase 3 Task Claim And Replit Overlay

- `task_claim` frontend action added for eligible pool tasks: staff/admin/manager role, `status = new`, `assignment_scope != user`, no `assignee_id`.
- Backend RPC/RLS remain the source of truth; SQL was not changed or applied.
- Existing create/edit/assign workflow remains on compatible `task_create`, `task_update`, `task_assign` in this phase.
- Browser QA on current data needs a real pool task to click the claim path. Existing visible tasks may not include pool tasks.
- Replit overlay/banners checked in source: production build should not include Replit runtime overlay, and iframe auth banner should only show in Replit iframe context.

## Phase 4 Task Notification UX

- Supabase read-only inspection confirmed task notification payload already contains `task_id`; no migration is required for task deep links.
- Current issue reproduced in browser: clicking a task notification opened `/tasks` only, leaving the user on the default tab instead of opening the task.
- Frontend now uses `/tasks?task=<task_id>` for task notifications, and `/tasks?task=<id>` opens `TaskDetailModal` directly after refresh.
- If RLS hides the task or the task was deleted, the modal shows: `Задача недоступна или была удалена.`
- Non-staff users no longer see the task cancel action in `TaskDetailModal`; RPC/RLS remain the source of truth.
- Staff task tabs now include `Доступные` for unassigned `manager_pool` / `staff_pool` tasks with `status = new`.

## Roles And Permissions Foundation

- Supabase read-only audit confirmed current authorization is still based on `profiles.role`, `app_role`, `is_admin()` and `is_manager_or_admin()`.
- Dynamic roles should be introduced as a staged compatibility layer, not by replacing existing RLS/RPC at once.
- Added planning docs and SQL proposal only; production DB was not changed.
- Manual SQL proposal: `.migration-backup/supabase/migrations/20260505_roles_permissions_foundation.sql`.

## Production UI Consistency Audit

2026-05-05 Browser QA checked the live UI on `https://kub.apollot.ru` without hardcoding the domain in source code.

- Viewports checked: 390x844, 768x1024, 1280x720, 1920x1080, 3840x2160.
- Routes checked: `/`, `/tasks`, `/admin`, `/admin/users`, `/admin/bans`, `/admin/audit`; logged-in `/login` and `/register` redirect back to the app as expected.
- Areas checked: sidebar, chat list/search, notification bell, profile/settings modal, chat window/message input, task cards/detail modal/actions, admin dashboard, users, bans/mutes, audit expanded details.
- Automated viewport audit found no document-level horizontal overflow on the checked routes.
- Notification popover, profile menu, task detail modal and admin user action menu stay inside the mobile viewport.
- Mobile audit expanded details were visually too narrow because the desktop left offset and label/value row layout were reused on 390px. The audit detail panel is now full-width on mobile, while desktop keeps the indented layout.
- Screenshots are stored under `output/playwright/` and are not intended for commit.

## Task UX Hardening

2026-05-05 frontend-only task UX pass:

- SQL/RLS/RPC were not changed.
- Task detail now shows contextual callouts for `waiting_confirmation`, rejected reason from `task_events.payload.reason`, and available pool tasks.
- Task actions are visually grouped into a bordered action area; assignment/edit remain secondary, and cancel is styled as a destructive action instead of competing with the primary CTA.
- The comment send icon-only button now has an explicit `aria-label`.
- Task cards wrap assignee/update/due metadata safely on mobile instead of forcing a single crowded row.

## Messenger Keyboard And Search UX

2026-05-05 frontend-only messenger UX pass:

- SQL/RLS/RPC were not changed.
- `Ctrl+K` / `Cmd+K` focuses the existing chat search; on mobile it first returns from the open chat to the chat list.
- `Escape` closes the profile menu and notification popover; on mobile it returns from an open chat to the chat list when focus is not inside an input/textarea.
- Message input keeps Enter-to-send and Shift+Enter newline behavior, but now avoids sending while IME composition is active and does not send while upload is in progress.
- Message input `Escape` closes emoji/attachment popovers without clearing typed text.
- Chat notifications already navigate to the target chat when payload contains `chat_id`; task notifications continue to use `/tasks?task=<id>`.

## Supabase Password Recovery Flow

2026-05-06 frontend-only hotfix:

- Supabase recovery links intentionally create a temporary authenticated session.
- The app must not treat `PASSWORD_RECOVERY` as a normal login; it must show the password update form first.
- Recovery is now detected by `/auth/callback?type=recovery`, `#type=recovery`, and the Supabase `PASSWORD_RECOVERY` auth event.
- While recovery state is active, the user stays on the password update screen even if Supabase has already established a session.
- After successful `supabase.auth.updateUser({ password })`, the app clears recovery state, signs the user out, and returns to `/login?password_reset=1`.
- Invalid/expired recovery links show a friendly Russian message instead of raw Supabase output.
- Confirmation email flow remains separate: non-recovery auth callback can still complete login/confirmation normally.

## Chat Safety And Task Roadmap Notes

2026-05-06 avatar/profile and chat safety pass:

- Own avatar/profile editing remains in `SettingsModal`; other users' avatars are not edited from normal user profile surfaces.
- Group/channel avatar editing is only shown for chat owner/admin; private chats and `Избранное` do not show chat avatar/name edit controls.
- Direct global `Очистить историю` was removed from chat header/info UI because production DB does not yet have a safe per-user clear/hide model.
- Manual SQL proposal prepared, not applied: `.migration-backup/supabase/migrations/20260506_chat_history_private_hide_permissions.sql`.
- Manual SQL proposal prepared, not applied: `.migration-backup/supabase/migrations/20260506_chat_pins.sql`.
- Until those proposals are applied and frontend-aligned, private chat deletion is intentionally not exposed as a destructive global delete.
- `Избранное` is sorted above regular chats in frontend as a system-like saved space.

2026-05-06 follow-up:

- User manually applied `.migration-backup/supabase/migrations/20260506_chat_history_private_hide_permissions.sql`.
- User manually applied `.migration-backup/supabase/migrations/20260506_chat_pins.sql`.
- Supabase read-only check confirmed `chat_members.hidden_at`, `chat_members.cleared_at`, `chat_members.pinned`, `chat_members.pinned_at` and RPC `clear_chat_for_me`, `hide_private_chat`, `unhide_private_chat`, `pin_chat`, `unpin_chat`.
- Frontend alignment is enabled for local chat clear, private chat hide, and per-user chat pin/unpin.
- User manually applied `.migration-backup/supabase/migrations/20260506_admin_avatar_management.sql`.
- Supabase read-only check confirmed `_kub_media_path_allowed` now permits admin-managed uploads to `avatars/{target_user_id}/...` for non-admin profile rows, while users keep only their own avatar path.
- Frontend admin profile preview now exposes upload/reset avatar controls for ordinary users only. Manager/admin-to-admin avatar management remains hidden and backend-controlled.
- `Очистить историю у себя` is documented and worded as a local hide: messages and attachments disappear only for the current user; Storage files are not deleted.
- Destructive "delete my media from chat" remains planned only. It needs a separate RPC design because one participant must not delete media still visible to another participant.
- Chat media panel now renders gallery media lazily in small batches with lazy images and non-preloaded video previews.

2026-05-06 production bugfix follow-up:

- Hidden private chats are reactivated from the frontend via existing `unhide_private_chat` RPC when a new message makes them visible again or when the user starts the same private chat again.
- Media gallery clicks now use the in-app `MediaViewer`; video previews stay lightweight and do not preload the video file in the grid.
- Avatar uploads are limited in frontend validation to JPG, PNG, WebP and GIF up to 2 MB. The shared `media` bucket currently has no global `file_size_limit`; do not set a bucket-wide 2 MB limit because the bucket also stores voice/messages/files.
- Profile bootstrap now keeps the app on the loading screen until the authenticated user's `profiles` row is loaded or created, avoiding a half-broken UI with `currentUser = null`.
- Message pin/unpin actions are exposed to authenticated chat viewers and backend RPC remains the source of truth; this avoids hiding pin controls while membership role data is still catching up.

Recurring tasks roadmap note:

- Future task-system phase should add recurring tasks: daily, weekly, monthly, yearly, custom interval, `next_run_at`, auto-create next occurrence, stop recurrence, reuse `visibility` / `assignment_scope`, and history of occurrences.

2026-05-06 production data consistency follow-up:

- Supabase read-only audit confirmed the current `media` Storage bucket is public. This is acceptable only for avatars, not for private/group chat media.
- Added `docs/MEDIA_SECURITY_PLAN.md` and migration proposal `.migration-backup/supabase/migrations/20260506_secure_chat_media_access.sql` for a private `chat-media` bucket and `messages.media_bucket` / `messages.media_path` rollout.
- Message timeline initial fetch now loads the newest 100 visible messages, then sorts them ascending in the store. This fixes the case where a just-sent message appeared realtime/sidebar but disappeared from the active chat after refresh in long chats.
- Pinned messages and media gallery now re-check current `chat_members.cleared_at` before rendering local cleared history, so old pinned/media entries should not flash back after local clear/hide.
- Media gallery now fetches media from DB in pages and filters by `cleared_at`; image/video clicks still use the in-app viewer.
- Added a non-destructive app update banner that detects a new Vite entry bundle on interval/visibility return and asks the user to refresh instead of forcing a full page reload.

2026-05-06 chat consistency follow-up:

- User manually applied `.migration-backup/supabase/migrations/20260506_secure_chat_media_access.sql`; Supabase read-only check confirmed private `chat-media`, chat media policies and `messages.media_bucket` / `messages.media_path`.
- Legacy `media` bucket remains public for avatars/old media compatibility. Full security still requires moving new message uploads and legacy media reads to `chat-media` signed URLs.
- Chat preview now filters last message/unread counts by current user's `chat_members.cleared_at`.
- Chat search ignores soft-deleted message placeholders.
- Topic-aware text/media/voice sends now include `topic_id`; when topics are disabled the message hook no longer filters out topic messages.
- Frontend name limits were added for group/chat/folder/topic names. `.migration-backup/supabase/migrations/20260506_entity_name_constraints.sql` was applied manually on 2026-05-06; read-only MCP confirmed active checks on `chats.name`, `folders.name` and `topics.name`.

2026-05-06 messenger polish follow-up:

- `rg` is installed and available in PATH (`ripgrep 15.1.0`); use it as the primary project search tool.
- Forum chats now expose a frontend pseudo-topic `Общие` for legacy/general messages with `messages.topic_id IS NULL`; database `topics.is_general` rows are treated as part of that general stream for compatibility.
- Bulk message selection is entered from the message action menu (`Выбрать сообщения`) instead of a persistent toolbar button.
- Media gallery uses lightweight placeholder tiles for image/GIF/video batches; full media is loaded only when opened in the in-app viewer. Real thumbnail generation remains a future media pipeline task.
- App update prompt no longer has a permanent skip action. `Напомнить позже` snoozes briefly; fatal chunk-load errors show a blocking reload prompt.

2026-05-06 production stability follow-up:

- Mobile bulk delete selection was adjusted: selection starts from the message action menu, the action menu closes immediately, and deletion uses an in-app two-step toolbar confirmation instead of a native browser confirm.
- Long text messages and long URLs now use `overflow-wrap:anywhere` / `break-word` so message bubbles do not stretch the chat horizontally.
- Typing broadcasts are scoped by active chat/topic and cleared on chat/topic switch to prevent stale typing indicators from leaking into another chat.
- Profile bootstrap now exposes a retryable loading error state instead of leaving users on an unexplained spinner forever.
- Media gallery now shows lazy real previews for static image items on the current page; GIF/video remain lightweight placeholders until opened in the in-app viewer.
- Root `docker-compose.yml` now has an nginx healthcheck for Coolify/container readiness; docs deploy compose files already had healthchecks.
- App update banner now also reports temporary server connection instability, which can happen during redeploy, without forcing an automatic reload.

2026-05-06 message layout / realtime follow-up:

- Native browser `confirm` / `alert` / `prompt` scan remains clean in `artifacts/kub/src`.
- Chat list media previews now use semantic labels (`Фото`, `GIF`, `Видео`, `Голосовое`, `Файл`) instead of raw media URLs.
- Muted chat state is still local per-device (`ng_muted` in localStorage); the UI now uses a larger bell-off indicator. A DB-backed per-user preference can be added later if cross-device mute sync is required.
- Active chat message sync has a fallback: sidebar message realtime events dispatch a debounced active-chat refetch/merge event so the open MessageList does not miss rows that already appeared in the chat preview.

2026-05-07 message hide-for-me frontend follow-up:

- Frontend now exposes `Удалить у себя` for visible messages and keeps `Удалить для всех` separate for own non-saved-chat messages.
- Bulk selection can hide any selected visible messages locally; global bulk delete is offered only when all selected messages are own messages in a non-saved chat.
- Active MessageList, pinned messages, in-chat search, media gallery and chat preview now filter out rows present in `message_hidden_for_users` for the current user.
- `20260507_message_hide_for_me.sql` and `20260507_message_hide_for_me_grants_hardening.sql` are no longer pending.

2026-05-07 message receipts / reactions follow-up:

- Bubble and chat-list preview both use `getMessageDeliveryState`. Current honest states are: sending, sent, failed and private-chat read via the other member's `last_read_at`; saved chats show no checkmarks and group chats do not show fake read state.
- `20260507_message_delivery_receipts.sql` is now applied. Read-only MCP confirmed `chat_members.last_delivered_at`, `mark_chat_delivered(p_chat_id uuid)` and `mark_chat_read(p_chat_id uuid)` with authenticated-only execute grants.
- Bubble and chat-list preview now support private-chat delivered state via the other member's `last_delivered_at`; saved chats still show no checkmarks and group chats still do not show fake read/delivered state.
- Desktop message action menu now includes the same quick reaction row as the mobile long-press sheet.

2026-05-07 receipt sync / bubble rhythm follow-up:

- Sender-side receipt sync now uses one stable `chat-members:receipts:{userId}` subscription in `useChats` for RLS-visible `chat_members` UPDATE rows. It patches affected chat members in store instead of refetching all chats, so inactive chat preview can move from sent to delivered/read.
- The older active-chat-only receipt path was the reason sender checkmarks updated after entering the chat; active bubbles and preview now read the same store member receipt state.
- Text bubbles without reactions render footer meta inline at the end of the text flow; reaction bubbles keep the compact bottom meta row.
- Link bubbles no longer force a wide desktop width; they use fit-content with responsive max-width and URL wrapping.

2026-05-08 reliable send follow-up:

- Text, location, media, voice and forwarded message inserts now include `client_message_id` and `client_sent_at`, but do not send client `created_at`.
- Message bubbles stay pending until the DB insert returns/fetches the server row; the server `created_at` replaces the local pending timestamp after acknowledgement.
- Retry reuses the same `client_message_id` and fetches an existing row on duplicate/unknown responses, preventing duplicate messages after network timeouts.

2026-05-08 chat actions/profile/group receipts follow-up:

- Chat list `Открыть профиль` / group info actions now open a separate preview modal/sheet without changing `selectedChatId`; the chat opens only from the explicit `Открыть чат` button.
- Mobile chat long-press suppresses the touch `contextmenu` path, so only the bottom action sheet should appear.
- Supabase read-only check confirmed `chat_members.last_read_at` is visible to chat members through existing RLS and `chat_members` is in realtime; group own-message read counts and the `Кто прочитал` modal use that data without faking private receipt states.
- User manually applied `.migration-backup/supabase/migrations/20260508_chat_pinned_order.sql`; read-only MCP confirmed `chat_members.pinned_order`, `set_pinned_chat_order(uuid[])`, authenticated-only execute grants and no anon/PUBLIC execute access.

2026-05-08 pinned/profile/group receipt polish:

- Group own-message footer now uses a compact `✓ count/total` read indicator instead of appending a second loose read badge after the sent check; full names remain in the `Кто прочитал` modal.
- Pinned chat order UI is enabled through context menu / mobile sheet `Переместить выше` and `Переместить ниже`; saved chat remains above all pinned chats.
- Mini-profile preview no longer shows service copy about preview mode and now displays profile `bio` plus a localized app role label when available.

2026-05-08 bubble/footer/group preview/pinned drag polish:

- Message bubble meta now uses measured Telegram-like placement for text/link/reply cases: meta stays inline when it fits the measured last text line and falls back to a compact next-line-end row only when needed. Reactions render below the text+meta group, while float/absolute text footer, artificial spacer/wbr, and large padding reserve are not used for ordinary text bubbles.
- Chat-list preview now derives own group-message read count from the same `chat_members.last_read_at` member data as in-chat receipts; online status is not used as read state.
- Desktop pinned chat drag reorder is enabled through a lightweight handle and still persists through `set_pinned_chat_order(uuid[])`; context-menu and mobile sheet move up/down actions remain the fallback.

2026-05-08 anchored bubble meta / compact reactions follow-up:

- Text meta no longer uses "fits last line" as the only Telegram-like rule. Inline meta is limited to simple single-line text; wrapped multiline text, long URLs/tokens and reply/compound bubbles use anchored bottom-right meta inside the bubble.
- Anchored meta uses a measured final-line tail reserve only when the last text line would run under the footer; it does not apply global right/bottom padding and reactions do not participate in the text/meta placement decision.
- Reactions are rendered as a secondary compact layer below text+meta: the default row shows up to two reaction chips plus `+N`, with the overflow list shown as an overlay on hover/focus or by tapping `+N`.

2026-05-09 final message bubble polish:

- Anchored text meta no longer inserts an inline tail spacer for long CAPS / long-token messages. If the final text line would collide with the footer, the footer uses a compact bottom-end flow row; otherwise it stays anchored over the natural free corner.
- Location messages that match `📍 Местоположение: https://maps.google.com/?q=lat,lng` are displayed as rounded coordinates while preserving the original map href; ordinary Google and non-map URLs still use the regular formatter.
- Very short messages with multiple reactions now default to one visible reaction chip plus `+N`, so the reaction layer does not widen the core text+meta bubble.

2026-05-09 final bubble geometry follow-up:

- `+N` reaction overflow now opens in a fixed portal popover anchored to the `+N` chip instead of expanding inline inside the bubble, so hidden reactions do not shift message geometry or render under neighboring messages.
- Location messages are classified as compact short text before URL layout is chosen. Desktop keeps the full `📍 Местоположение:` label, while narrow/mobile viewports use the shorter `📍` label; both preserve the original Google Maps href.
- Anchored multiline/long-token text meta keeps Telegram-like behavior: it remains bottom-right when the final text line leaves room, and uses a compact measured bottom-end slot only when the final line would collide with the footer.

2026-05-10 notifications bounds / group invites follow-up:

- User manually applied `.migration-backup/supabase/migrations/20260509_group_invites.sql`.
- Read-only Supabase MCP confirmed `public.group_invites` exists with RLS enabled and expected FKs to `chats`/`profiles`; available MCP table introspection does not expose RPC definitions, so RPC behavior is verified through authenticated app QA.
- Notification popover QA should use the Codex/QA browser session or secure local QA credentials; never store secrets in repo/docs and do not depend on the user's mouse.

2026-05-10 group invite status/live update follow-up:

- Group info now has an owner/admin invite-status section backed by `public.group_invites`.
- The invite modal reads all latest invite statuses for the current chat: pending users are disabled, members are disabled, declined/cancelled/expired users can be invited again.
- Chat info subscribes to current-chat `chat_members` and `group_invites` realtime changes and refetches both lists after changes; action handlers also refetch after invite/cancel/remove/role changes.
- No SQL was applied automatically. Manual proposal pending: `.migration-backup/supabase/migrations/20260510_group_invite_join_system_messages.sql` for persistent join system messages after invite accept.

2026-05-10 invite unread / role / system notice follow-up:

- Frontend chat unread calculation now uses an effective baseline from `last_read_at`, `joined_at` and `cleared_at`, so accepted invitees do not inherit unread counts from pre-join history when `last_read_at` is still null.
- Chat list/store comparison now includes `chat_members.role`, allowing current-user admin/owner role changes to update role-gated UI after realtime/refetch without a full page refresh.
- System messages render as centered micro-notices outside `MessageBubble`; they do not show avatar, delivery checks, reactions, reply controls or normal user bubble styling.
- No SQL was applied automatically. New manual proposal pending: `.migration-backup/supabase/migrations/20260511_invite_accept_read_baseline_and_system_notice.sql`.

2026-05-10 reinvite / invite policy follow-up:

- Historical accepted invites are now treated as history unless the invitee is still present in `chat_members`; removed ex-members become inviteable again in both the invite modal and owner/admin invite status list.
- Invite UI uses friendly status/error copy only. Technical RPC names, raw payloads, UUIDs, PostgreSQL codes and stack details remain console-only diagnostics.
- Group info includes a gated "Кто может приглашать" setting. Until the manual DB proposal is applied, the UI falls back to `owner_admin_only` and shows a friendly migration-required note instead of breaking.
- No SQL was applied automatically. New manual proposal pending: `.migration-backup/supabase/migrations/20260512_group_invite_reinvite_and_policy.sql`.

2026-05-10 microphone self-monitoring follow-up:

- Mic test lives in `artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx`; voice-message recording remains isolated in `artifacts/kub/src/hooks/useVoiceRecorder.ts` and `artifacts/kub/src/components/chat/VoiceRecorder.tsx`.
- Mic test now has an explicit "Прослушивать себя" toggle. It is off by default, enabled only while the mic test is active, and creates a local-only `AudioContext -> MediaStreamSource -> GainNode -> destination` monitoring path.
- Stopping the mic test, closing settings, disabling the toggle, or losing the mic stream disconnects monitoring nodes and closes the owned AudioContext. The mic test stream remains separate from normal voice-message recording and is not sent to chat.

2026-05-10 microphone self-monitoring quality follow-up:

- Mic test adds a local-only processing mode selector: "Чистый голос" requests browser echo cancellation, noise suppression, auto gain, mono input and 48 kHz / 16-bit ideals; "Без обработки" requests those processing constraints off.
- If advanced constraints are not supported, mic test falls back to simpler constraints and then `{ audio: true }`, showing friendly fallback copy instead of raw DOM errors.
- Self-monitoring has an app-only "Громкость прослушивания" GainNode control with 80% default; it does not change system volume and does not affect voice-message recording.

2026-05-10 staged attachments follow-up:

- The chat composer/send pipeline is split between `artifacts/kub/src/components/chat/MessageInput.tsx`, `artifacts/kub/src/components/chat/ChatWindow.tsx` and `artifacts/kub/src/hooks/useMessages.ts`.
- Existing media messages use the single-row `messages.media_url` model, so staged multi-file sends are sent sequentially as separate `image` / `video` / `audio` / `file` messages. No multi-attachment schema migration was added.
- File picker, drag-and-drop and clipboard files now create local staged attachments first. Upload to the existing `media` storage bucket starts only after Send; successful attachments are removed from the tray only after `sendMediaMessage` returns the DB-acknowledged row through the existing `client_message_id` path.

2026-05-10 staged voice follow-up:

- Voice recording now uses the staged attachment model: stopping the recorder creates a local `voice` preview item with an object URL, duration and stable `clientMessageId`; upload and message insert still happen only after Send.
- Recorded voice is sent as the existing `audio` message type through the same media bucket and `sendMediaMessage` DB-ack path. Typed text with a staged voice is sent as a separate text message first, so the voice bubble keeps the existing voice/audio rendering.
- The recorder and mic self-monitoring remain separate. Voice recording does not enable live monitoring, and deleting/sending a staged voice revokes the local preview URL.

2026-05-10 locations / task routing foundation:

- Read-only Supabase MCP confirmed that `locations`, `location_members` and the routing columns on `tasks` are not yet present in the live schema.
- New SQL was not applied automatically. Manual proposal: `.migration-backup/supabase/migrations/20260513_locations_task_routing.sql`.
- Frontend fallback expectation: `/admin/locations` must show “Локации требуют обновления базы данных.” until the migration is applied, while existing task create/update flows continue to work through the current task RPC.
- After applying the migration manually, QA should cover location creation, location member assignment, primary admin routing, owner-to-admin tasks, staff-only visibility, location filters and task notifications.
- Live QA should use the Codex/QA browser session or QA credentials from secure environment; do not rely on user mouse/manual browser.

2026-05-10 dynamic roles / permissions foundation:

- User manually applied `.migration-backup/supabase/migrations/20260513_locations_task_routing.sql`; read-only Supabase MCP confirmed the locations/task routing schema and RPC are present.
- Dynamic roles schema is not applied yet: `roles`, `permissions`, `role_permissions`, `user_global_roles` and `location_members.role_id` are absent.
- New SQL was not applied automatically. Manual proposal: `.migration-backup/supabase/migrations/20260514_dynamic_roles_permissions.sql`.
- Frontend fallback expectation: `/admin/roles` must show “Роли и права требуют обновления базы данных.” until the migration is applied. Existing profiles, locations and tasks must keep working through legacy `profiles.role` / `location_members.role`.
- After applying the migration manually, QA should cover custom role create/edit, permission assignment, global role assignment/removal, location dynamic role assignment, profile/mini-profile role display, last owner/tech_admin protection, admin-only task visibility and group invite permissions.
- Authenticated local Playwright QA covered `/admin/roles` fallback at desktop and mobile widths, `/admin/locations` after the applied routing migration, admin user profile role summary, private chat profile role summary, and the main chat shell. With the dynamic roles probe disabled while migration is absent, normal fallback pages produced no console errors.
