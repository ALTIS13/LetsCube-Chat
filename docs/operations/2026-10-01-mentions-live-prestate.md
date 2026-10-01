# D-331 mentions: live metadata prestate

Date: 2026-10-01. Owner: bounded SQL/source audit sidecar.
Stage: read audit complete; no implementation or deployment in this slice.
Source: [member mentions contract](2026-10-01-member-mentions-contract.md), local main HEAD `29176d72e6b1686a61bd91ef322d592f115e40e6`, and current production catalogs.
Contract file SHA-256 at read: `acf5e55e0b0d5ecb77a0774cb7ed6b6ce6378958b0e126651b031ca06a26afec`.
Main advanced externally to `69d3dcbee5f754e1f2d7080037a4ef18b0982aa7` during the audit; all 23 recorded dependency blobs also match that revision exactly. This audit made no commit.
Blocker: none for metadata handoff. Next: coordinator uses these guards for D-331 migration/rehearsal.

## Evidence boundary

- SSH only: approved key, `root@ms.letscube.ru`, `docker exec -i supabase-db psql -X -qAt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres`.
- Every SQL inspection used `BEGIN READ ONLY; ... COMMIT;`. Queries read catalogs/function definitions, never application rows, dumps, tokens, previews or message bodies.
- PostgreSQL `17.6`; first inventory `2026-10-01T13:49:45.546527Z`; final function/trigger inventory `2026-10-01T13:52:52.165222Z`.
- Inspection session search_path was exactly `"\$user", public, auth, extensions`. Definition hashes below are under that context. Body hashes are search_path-independent.
- 36 selected functions: 34 exact body matches to tracked forward migration SQL; 2 exact after reconstructing the five tracked epoch replacements. No unexplained body difference.
- Repeated metadata capture found zero drift in definition/body hashes, owners, definer flag, volatility, config or ACL for the 34 functions already captured in full. The two additional dependency bodies also exactly match tracked SQL.
- Definitions stayed in tool-session memory. No private source files were needed or written. Report contains only catalog metadata and allowlisted code conditions, not live values.
- This proves installed metadata/source, not successful delivery, worker invocation, authenticated behavior or transport acceptance. No callable business functions were executed.

## Actual live boundaries

| Path | Checks already installed | Concrete D-331 delta / caution |
| --- | --- | --- |
| Message storage | Sender-shape constraint; insert sender normalization; immutable sender/type update guard; content edit timestamp guard; bot epoch locks/stamping; forward-origin snapshot guard; final deletion scrubber | `mention_entities` column and mention validator are absent. Add validation before AFTER fanout, without replacing existing guards. |
| `enqueue_message_notifications` | Skips system/senderless; current human chat_members; human author exclusion; hidden chat, cleared history and message-hidden exclusion; ordinary `kind=message`; conflict suppression; recipient-specific micro-group name | No entity marker, ban, joined_at epoch, recipient-block-human-author or topic/chat consistency check in this live body. No deleted_at check in this INSERT fanout body. Bot owners are not joined as recipients, but a bot owner who is a human chat member remains an ordinary recipient. |
| Notifications SELECT | Exactly one owner-scoped permissive SELECT policy, `user_id = auth.uid()` | No restrictive source-eligibility policy is installed. Do not broaden human group-history RLS to implement notification eligibility. |
| `_notification_push_allowed` | Global push, message/task/invite preference; human sender self-exclusion; per-chat push_enabled and muted_until | No message-source reread, membership epoch, ban, directional human block or topic consistency check. Missing global preference row already fails closed for push. |
| Web claim / delivery recheck | Claim: unread, active subscription, expiry, coalescing, foreground suppression, SKIP LOCKED. Recheck: claim token/unsent/unsuppressed, unread, active subscription + subscription owner, foreground | Neither path calls source eligibility or rereads preferences. Recheck does not explicitly validate claimed_until, attempt limit or notification-owner equality. Preserve current checks while adding the bounded message condition; do not claim a lease-expiry gate already exists in recheck. |
| Native claim / delivery recheck | Claim: unread, attempt bound, lease expiry, SKIP LOCKED. Recheck: unread, notification/outbox/device owner equality, device enabled/unrevoked, attempt bound, matching claim token and unexpired lease | No source/preferences reread; no foreground check in these selected native functions. Preserve installed claim/device/read checks. |
| Album enqueue / recheck | Enqueue: source exists, undeleted image/video, payload message/chat and sender identity match, typed album shape, current member, hidden/clear/message-hidden checks, current preferences. Recheck: unread, target owner/activity, lease/attempt gate, web foreground, undeleted source, current member, message/chat payload consistency, hidden/clear/message-hidden, current preferences | This path already has real source/predelivery checks. Missing relative to D-331: joined_at epoch, ban, directional recipient block, topic belongs to source chat. Recheck does not repeat enqueue's source sender-identity comparison. |
| External message push payload | Album recheck generates generic LETSCUBE/new-message body and route | Ordinary `_notification_push_payload` still derives title/body/preview/sender fields from notification payload. Generic external output is a real additional change, not an already-installed property. Preserve task/system branches. |
| Bot receive / pending delivery | Active bot, installed/nonremoved membership and joined_at epoch; independent own-bot/private/full branches; restricted command/raw @username/reply branches; poll and webhook prepare source recheck; privacy-change pending purge | Entity addressing belongs only in restricted branch. Do not pass full/private/own-bot delivery through human notification eligibility or require an entity. Human UUID/bot-owner UUID is not bot addressing. |
| Bot viewer final recheck | Dispatch claim status/age + pending update expiry and viewer validity | `bot_viewer_delivery_recheck_internal` is callback_query/viewer-interface-only, not a universal message predelivery recheck. |

The proposed `private.message_notification_visible_to(uuid,uuid)` is absent.
Real table names are `public.topics`, `public.chat_bot_members`, `public.user_blocks` and `public.bans`, not chat_topics/chat_bots/personal_blocks/chat_bans.
`is_banned(uuid)` reads active rows in bans; `is_chat_member(uuid)` derives the caller through auth.uid() and only checks membership existence.
`blocked_from_chat(uuid,uuid)` is private-chat **write** protection, not a general recipient/group notification predicate.
A recipient-explicit private eligibility helper must query recipient membership directly rather than reuse caller-derived is_chat_member.
Topic SELECT is chat membership plus the existing ban restriction; no per-topic member ACL was observed.
The topic FK enforces topic existence, not topic.chat_id = message.chat_id.

## Column, trigger and cleanup dependencies

- Messages currently has 24 live columns and no mention_entities. Table-level INSERT/UPDATE/SELECT grants to authenticated (and anon) exist; row policies remain the authorization gate. No per-column ACL was observed on those 24 columns. The new column will inherit these table grants, so its trigger must enforce structure for direct table writes as well as RPC writes.
- AFTER INSERT notification fanout is `trg_enqueue_message_notifications_after_insert`. Bot AFTER INSERT fanout is separate; both must see canonical metadata. Bot UPDATE fanout is explicitly `UPDATE OF content, media_bucket, media_path, media_metadata, topic_id, reply_to_id, bot_reply_markup` and its body compares the same tuple. A metadata-only edit does not currently trigger or pass that comparison. Decide explicitly whether entity-only bot addressing edits require changing both the trigger column list and comparison; do not accidentally refanout unrelated pin/delivery updates.
- The new validator must cover INSERT and UPDATE of content/metadata plus deletion/forward invariants. Legacy content edits with unchanged metadata must clear it; unrelated updates and unchanged historical entities must remain stable. Validate UTF-16 boundaries, exact substring/label, revision, type/version/shape and local current human/bot target membership; privacy/mute/block decisions must stay out of canonicalization.
- `forward_message` has an explicit INSERT column list and copies content/media but not a future mention column. An empty default therefore covers ordinary forwarding; no function replacement is inherently required for that omission. Direct inserts carrying forwarded_from_id still need the mention trigger to force empty metadata even if supplied by a caller. `messages_forward_origin` is a separate existing BEFORE INSERT OR UPDATE guard; preserve its immutable origin snapshot.
- `delete_messages_for_everyone` sets deleted_at, which invokes `trg_zz_deleted_message_keeps_nothing` BEFORE every qualifying UPDATE. Its live source restores old tombstone fields, unpins, then **returns early** for a new/reviewing content report; otherwise it purges media and clears content/media/bot UI. Empty mention metadata must apply before that report early return and cannot be resurrected on later writes. A source-only catalog survey for literal `content = NULL` / `NEW.content := NULL` found this one installed function; this is not an exhaustive dynamic-SQL/data-path proof.
- `scrub_deleted_message_notifications` already removes unsent ordinary web/native outboxes, scrubs already-sent bodies/previews and marks the notification deleted. It does not remove album outbox rows; album recheck separately excludes deleted sources. D-331 must also clear recipient mentioned markers where required and retain source fail-closed reads. No UPDATE notification trigger currently enqueues push, so marker-only edits need not create new deliveries.
- Physical chat deletion cascades messages; profile deletion marks a transaction-local tombstone context and allows the sender FK's SET NULL through the immutable-sender guard. That profile path does not set message.deleted_at or clear content in the selected functions. Do not invent a new account-deletion/content-retention behavior in this slice.
- `bot_can_receive_message` and `bot_update_still_visible` have no deleted_at condition; the latter checks source existence/chat consistency then delegates. Bot payload reads a source snapshot containing text/media, with no entity projection today. Source deletion/pending bot snapshot behavior needs an isolated regression case; installed source alone is insufficient to assert leakage or to silently redesign full-read. Keep this separate from recipient-local human mention eligibility.

## Narrow tracked source differences

All 34 direct matches have an empty body diff against the referenced file/line in the inventory below.
These are **body** comparisons, not a claim that tracked SQL text equals PostgreSQL pretty-printed definition or that every catalog attribute is declared by the same file.

The two apparent differences from M06 are exactly M19's intended transformations, not unexplained runtime drift:

`public.bot_updates_poll_internal` (M06:4269 -> M19:150):
```diff
+    for share
+    and private.bot_update_still_visible(p_bot_id, queued.update_type, queued.payload)
```

`public.bot_delivery_prepare_internal` (M06:4952 -> M19:171):
```diff
+  v_update_type text;
-  select queued.payload into v_payload
+  select queued.payload, queued.update_type into v_payload, v_update_type
+  if not private.bot_update_still_visible(v_attempt.bot_id, v_update_type, v_payload) then
+    -- Exact tracked branch marks attempt dead_letter/privacy_revoked,
+    -- clears claim/epoch, acknowledges pending update and returns null.
+  end if;
```
The abbreviated branch comments above describe, rather than replace, the actual SQL. In-memory reconstruction applied the exact two poll and three prepare SQL string replacements from M19; both reconstructed full bodies equalled live prosrc byte-for-byte.
M20 subsequently replaced bot_update_still_visible and added viewer callback checks; live matches that newer body.

## Function drift guards

SHA-256 is lowercase hex of UTF-8: definition = pg_get_functiondef(oid); body = prosrc.
Attributes: D = SECURITY DEFINER, I = invoker; volatility s/v/i = stable/volatile/immutable.
EXECUTE letters are effective privileges: A = anon, U = authenticated, S = service_role; "-" means none of those three.
Every row has an explicit owner-only ACL plus the listed roles, except messages_forward_origin whose NULL ACL means default PUBLIC EXECUTE (all three true). That is an existing trigger-returning function, not evidence of a callable content-reading RPC.
Private schema USAGE is false for anon/authenticated/service_role, and all selected private functions are owner-only.
Preserve actual owners on replacement: guard_message_client_times, bot_viewer_delivery_recheck_internal and messages_forward_origin are supabase_admin; the other selected functions are postgres.
Do not silently harden unrelated ambient/public search_path functions during D-331.

| Function / identity arguments | Tracked source | Live owner; security/volatility; search_path; EXECUTE | Definition SHA-256 | Body SHA-256 |
| --- | --- | --- | --- | --- |
| `private.bot_can_receive_message(p_bot_id uuid, p_message_id uuid)` | M12:101 | postgres; D/s; `""`; - | `6e07a023da6b06b3a1b903268d5da288c6abd16e9cb91ea18f3863a67962e60f` | `5b9783f4ac32b79bda916f00fdf36513d40de6e1e0926b71c35589b5aab6dd7b` |
| `private.bot_message_update_payload(p_bot_id uuid, p_message_id uuid)` | M11:249 | postgres; D/s; `""`; - | `928fb83d16b50aaf2c31bd67a919a54acdc18840417f58d86e634b85157212e5` | `6c90f935779f4b37436764e0f5e9488e23f2b7b8bc9023ed8a013c5fc2cd6954` |
| `private.bot_update_still_visible(p_bot_id uuid, p_update_type text, p_payload jsonb)` | M20:728 | postgres; D/v; `""`; - | `1b427a15d661f064283de81a1756016bcbc222dec8e3ac11ff3c8e31a8a1ce8b` | `7c36b872154bb7f219483b39e4d7fa44b51e937c2699382d7fe2d2927ed305f6` |
| `private.deleted_message_keeps_nothing()` | M22:69 | postgres; D/v; `""`; - | `4d4f1265c83399263dfa6ed924cfa7dda39d02bc9bd5b55b7528fb94168fbcb1` | `e976c4264c2487355e45e514236ec490e8ce68f077e56274aadcf3854ad468a9` |
| `private.deleted_message_leaves_no_preview()` | M22:185 | postgres; D/v; `""`; - | `9119434689eafb0d72dc7f1d411c4ea73868b8cfc7f7a86ecf7bffa986c571cb` | `fec6c92d3d8cd4f18d2f7cc5c8a57f2d23691acca90d85f8e68df2a63b302cdf` |
| `private.enforce_message_sender_on_insert()` | M06:653 | postgres; I/v; `""`; - | `5dd2773894ec264b1eba1e5182fb05dc4d010269f979345e372d270bbd1699e7` | `5ce647fe30aed50507cbfc6870d3a0b637395f2b4be82149ec3c87a489900263` |
| `private.enforce_message_sender_on_update()` | M06:713 | postgres; I/v; `""`; - | `cb55569b507899a333f5d843eecd33c8bc5faf28090684b860eef95a3e2f48e8` | `1612fb8e78a8411c6f7cc1a0c06bb9682e516d770c4256b20af57704b0cf2797` |
| `private.enqueue_bot_message_updates_after_insert()` | M06:4099 | postgres; D/v; `""`; - | `5fe935b3a681911095ba2745c852639587dd10f70e286007e78f3fea499810e3` | `6965666e21b3f2363f38e79ea1d4dc00efc1636cdeafe0b5a2b73443ca8701d9` |
| `private.enqueue_bot_message_updates_after_update()` | M06:4142 | postgres; D/v; `""`; - | `f2d3f25b6963cb98f8eaf02801f1b08a71e0529229d53176c50d1503d2d77832` | `157a84e5e03d81eea34db30b34f2e6cba13ab06329ecfb08ed115cd29e4f9a4b` |
| `private.guard_bot_message_created_at()` | M19:199 | postgres; D/v; `""`; - | `9ebb898189b19f9047e1b47537523eb09f8b7689f2b45bb9d210770d0c116896` | `aa536a0706a3b907dc6b840315df52b3fab819d0812ced9f70a27698b939bd3e` |
| `private.guard_message_client_times()` | M09:64 | supabase_admin; D/v; `""`; - | `0c90d68b305d8745f278caa9938e6531260afb5880a7a874722e59f418dfaca6` | `898478ac736b2207d46de1b593688153145eb62bcce08d361607d939ad0ae7b1` |
| `private.lock_bot_message_epoch()` | M19:219 | postgres; D/v; `""`; - | `fd8fef233e3fec4ee47e3badd6cd9dd1d73f57f8afadeba1b75dd3d6a1fde80f` | `6e22377078025c81b8058d5dbb1ff40ae1c798babd76b13c51ac68df38bcf814` |
| `private.mark_profile_delete_message_tombstones()` | M06:678 | postgres; D/v; `""`; - | `bdce2d5f6a7a0ce1d18264e17b45e5c773bd0289626f1eac2dfaa85404e6efcc` | `b8028d4b3bc501d4872c8f478562059f3be850f07693fe349f7dba8ee06bf6ca` |
| `private.scrub_deleted_message_notifications(p_message_ids uuid[])` | M22:140 | postgres; D/v; `""`; - | `139561e4e8075ff7be46129bc73066adcb47511cb38574c47bdada4c48bcede3` | `9f0fcc7406326f109039488cafccd0ea47d64a86a43824a1057c3ff7f09b659a` |
| `public._enqueue_push_after_notification_insert()` | M18:46 | postgres; D/v; `pg_catalog`; - | `c8e1a9182122e7c929f45fd3a0739d52931a3ae6f942a049242560fce53c25ff` | `5b432162f5beab0dd3e5d9bea10cf64849937e12a6c08115ef6c7b67302a4db6` |
| `public._notification_push_allowed(p_user_id uuid, p_kind text, p_payload jsonb)` | M04:197 | postgres; I/s; `ambient`; S | `72601738dcfbf75f3b50cc99d02be78a7585990c274c2b17531ab9ad5f791034` | `53019ef87d58e4a1b0318e17dc621b72f72474a1df301932f81c8076eb247229` |
| `public._notification_push_payload(p_kind text, p_payload jsonb)` | M21:272 | postgres; I/i; `""`; S | `bfb1e8d53be077c2e012bda023c38cb2cef841173e81d2faf4b552e8bcc9d131` | `607ff23b1810e422b10728f512e7d3f8a8c69ecb56e2679a03a226e469dad26e` |
| `public.album_push_claim(p_limit integer, p_claim_token uuid)` | M17:243 | postgres; D/v; `pg_catalog`; S | `66fa6389bed3ae3bd37c11b49a76b278a0c92165c1a34ba25000a5c2b94c0bfa` | `8683099f764c799394c05af68045cc6e026b40c3dd5e526e3e473c6cfdd31fbf` |
| `public.album_push_enqueue(p_notification_id uuid)` | M17:85 | postgres; D/v; `pg_catalog`; - | `26962ac135958b683806d3150476e9a55317eb86b484b8af3cdc0a250fda3d8d` | `49da97a00d01e9d860890ea6bd8faa0c70aaa9b4108ef75017e9c23f26aa4be3` |
| `public.album_push_recheck(p_outbox_id uuid, p_claim_token uuid)` | M17:288 | postgres; D/v; `pg_catalog`; S | `d81c1ae845fd80704cfe2ad64028b98ff801cca31fe58608c3f4e023f648486b` | `75303ec9a867c71aed3b1f4d20f61e5ac8beac708affceaa7cdace4b7997b10a` |
| `public.blocked_from_chat(cid uuid, sender uuid)` | M10:115 | postgres; D/s; `public`; US | `11888c3878b622123124f7737c129f4a9c54552a846e9ef0288ec4ac6afc117a` | `3031ef31b5e022e66402933fade604e3366b9ebdb3383532a8ad93dd662b0270` |
| `public.bot_delivery_prepare_internal(p_attempt_id bigint, p_claim_token uuid, p_webhook_epoch bigint)` | M06 + M19 (reconstructed) | postgres; D/v; `""`; S | `98426e9d33fe0cd87b4f1df46b0d1fed122a2b69d7cd6079a07b561b2ab1db4d` | `6da69e1ac4601cea77e88d11d5c41d6dfca38bd4982f38a950f2f0e66ff646e1` |
| `public.bot_updates_poll_internal(p_bot_id uuid, p_offset bigint, p_limit integer, p_allowed_updates text[], p_timeout_marker uuid)` | M06 + M19 (reconstructed) | postgres; D/v; `""`; S | `3f4ee488f7a84c07cf5279cc682f83b89165f15f814211f8c0a218ea1709e5b5` | `e8bf25e59bb8c5eaec2d4b1c9f3514a0011d86d6a98e29a27896de8cf22f5166` |
| `public.bot_viewer_delivery_recheck_internal(p_attempt_id bigint, p_claim_token uuid)` | M20:785 | supabase_admin; D/v; `""`; S | `bca7f44660ff0fd65bf60537b2c4d90993d6dfd3656ee828d7f1fa6fdc7eea7b` | `5e347a6496af5da707217015ef88eb4068fff0f59cb54ae4a42d60baa08da11c` |
| `public.chat_bot_set_privacy(p_chat_id uuid, p_bot_id uuid, p_full boolean)` | M19:61 | postgres; D/v; `pg_catalog, public`; U | `222b0b484e81edef6ce4193cccc3da9e639488605039bce204fedbbeda93ad69` | `444472b3200d75341a63a10c6dc3a33808d5216518e9148755a574f11d58920e` |
| `public.delete_messages_for_everyone(p_message_ids uuid[])` | M07:101 | postgres; D/v; `""`; US | `aaafd70a8ab87c096607b1909597f73408d03ef75b15e4219ab27a1d5833d3ee` | `d415af380397fb53b88b653e704230b0727a35a709eaa7e4e558657d6bcfd16d` |
| `public.enqueue_message_notifications()` | M23:507 | postgres; D/v; `""`; - | `473c658f6881943e841668a8560b657edfdeb3c118cad88d72b5c9d36bf4a3fd` | `e8e6e3d6a9e511c072b5b300502a338154336d472b2697a0d3bd61b05e82a48e` |
| `public.forward_message(p_source_message_id uuid, p_target_chat_id uuid, p_client_message_id uuid, p_client_sent_at timestamp with time zone, p_topic_id uuid)` | M08:74 | postgres; D/v; `""`; US | `92bbead1a101304aa6cd21fdddb539245904ce921dfc38b3ad6e35e8aeacc691` | `535058cdf0cc4a973bf3356082a52d8e2e6fce4f7b58cd988c6cb1138459eec2` |
| `public.is_banned(uid uuid)` | M02:76 | postgres; D/s; `public`; US | `01a3522102e12bd88e6663813f6cfbb397ea169e97253e037833419232b1e03c` | `5039d29d12ac83ccc329448b78bf57ebdc40ce4e77104e68b2a9e9b63c7c0162` |
| `public.is_chat_member(cid uuid)` | M01:221 | postgres; D/s; `public`; US | `d7935eb8b39af7d5171be1876dad3b3fccb08719446d3c7cbae4168f545499db` | `3bd067fe18e9e93de94594e0132f5fe9bbe43838a9fabe32b60222dd9fb77ea8` |
| `public.mark_chat_delete_cascade()` | M03:25 | postgres; D/v; `public`; US | `6556c9cb5d93316de53c37dfb95d4dfc28cf0d06fb97ced0e9cf500dbd9b6a26` | `734d4c455aa67ce521ab0e5d6a5db2633e0bb722b52e080ef3a2d575d2908cad` |
| `public.messages_forward_origin()` | M13:172 | supabase_admin; D/v; `""`; AUS | `c9003177328fb085d93c4b1b56d15c75f14ddd468fb2dfdb5895166cbafc3de5` | `75cf802ac7a79e84592493334ba1e8e10990549dc66b5ef500572f1c38986dfa` |
| `public.native_push_outbox_claim(p_limit integer, p_claim_token uuid)` | M14:11 | postgres; D/v; `public, pg_temp`; S | `23452a1bfd8510d8facf71f243b70d7306357bc428c63f4804579500394b18db` | `b5263b9efd937ae54495737f21379a956491226baa0b8dd520bf54066502109f` |
| `public.native_push_outbox_delivery_recheck(p_outbox_id uuid, p_claim_token uuid)` | M15:5 | postgres; D/v; `pg_catalog`; S | `581625652f63960114130a4d5cf6fd2fed49988b2a3fe37aa3aa1d6a3f397df5` | `8432fe8214d6552b6c169e868d97085dcf33258c6a8050c5138e6501b539a017` |
| `public.push_outbox_claim(p_limit integer, p_claim_token uuid)` | M05:191 | postgres; D/v; `public, pg_temp`; S | `158f17ffed9a6663f6752d30dcc0865a4bbf221e54d2562a69d269b68310ebb7` | `cebf81044f5074a5495754fb79ec94c628c3c1413c9e25a43c26f4bf94805e23` |
| `public.push_outbox_delivery_recheck(p_outbox_id uuid, p_claim_token uuid)` | M16:6 | postgres; D/v; `public, pg_temp`; S | `439a0f5e5def1aca8061d613d525bc1bed3cfe8306801750e351da1131382980` | `0a445cad6bcf7790309ca9d6b5e62549646a875e01ce91759bb1e1fac1d65a81` |

## Triggers

All listed triggers are enabled `O`. The complete messages trigger inventory is included to make validator ordering review concrete. PostgreSQL orders same-event/same-timing triggers by name; retain the bot epoch lock/stamp and the final tombstone guard ordering.

| Table.trigger | Live pg_get_triggerdef | SHA-256 of UTF-8 definition |
| --- | --- | --- |
| `chat_bot_members.trg_bot_viewer_bot_member_revoke` | `CREATE TRIGGER trg_bot_viewer_bot_member_revoke AFTER DELETE OR UPDATE OF removed_at, joined_at ON public.chat_bot_members FOR EACH ROW EXECUTE FUNCTION private.bot_viewer_revoke_on_change()` | `3d830e352c6ece506efe6521e5155e3902b045f4823c2d4ae8c89ff11f3a05e9` |
| `chat_bot_members.trg_enqueue_bot_membership_updates` | `CREATE TRIGGER trg_enqueue_bot_membership_updates AFTER INSERT OR UPDATE OF privacy_mode, removed_at ON public.chat_bot_members FOR EACH ROW EXECUTE FUNCTION private.enqueue_bot_membership_update()` | `3d53f909b1806eb6d77287004ca543ab242ce072f9fa0ebb8b7296f8d4367f93` |
| `chats.trg_mark_chat_delete_cascade` | `CREATE TRIGGER trg_mark_chat_delete_cascade BEFORE DELETE ON public.chats FOR EACH ROW EXECUTE FUNCTION mark_chat_delete_cascade()` | `26d8e68bdd44c5dccd3e3c1334dd09bdc92680ab1b56e1aab54c94e848e9ee6b` |
| `messages.trg_a_lock_bot_message_epoch` | `CREATE TRIGGER trg_a_lock_bot_message_epoch BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.lock_bot_message_epoch()` | `6de09617b8d725b692f59304fee6bc3065a8bd064147e078a6985f1a9985099c` |
| `messages.trg_audit_messages_admin_delete` | `CREATE TRIGGER trg_audit_messages_admin_delete AFTER UPDATE OF deleted_at ON public.messages FOR EACH ROW EXECUTE FUNCTION _audit_messages_admin_delete()` | `bd41a3185a0d0f75ae2145f430793883f6acedd12e02b5dea1c0750f53bd9ea1` |
| `messages.trg_bot_input_prompt_direct_update` | `CREATE TRIGGER trg_bot_input_prompt_direct_update BEFORE UPDATE OF bot_input_field_placeholder ON public.messages FOR EACH ROW EXECUTE FUNCTION private.reject_bot_input_prompt_direct_update()` | `c589a999136eea90137fefd2baf66cfcc6a4861396776aa1ca92e3e902158de5` |
| `messages.trg_bot_input_prompt_normalize` | `CREATE TRIGGER trg_bot_input_prompt_normalize BEFORE INSERT OR UPDATE OF bot_reply_markup ON public.messages FOR EACH ROW EXECUTE FUNCTION private.normalize_bot_input_prompt()` | `124864f2cbfac9427239d9f44d76a3ebdb0f11afa754d726653c6b8a080e1c45` |
| `messages.trg_bot_viewer_source_revoke` | `CREATE TRIGGER trg_bot_viewer_source_revoke AFTER DELETE OR UPDATE OF deleted_at ON public.messages FOR EACH ROW EXECUTE FUNCTION private.bot_viewer_revoke_on_change()` | `023d15568066bf1e8a42beae3a8837bc0a38808d78d4b316dd9385399f40aa33` |
| `messages.trg_enqueue_bot_message_updates_after_insert` | `CREATE TRIGGER trg_enqueue_bot_message_updates_after_insert AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.enqueue_bot_message_updates_after_insert()` | `2f465683374f7f4788c6d72bcb2d92251b7aad872ac77634ae62d354281d14fa` |
| `messages.trg_enqueue_bot_message_updates_after_update` | `CREATE TRIGGER trg_enqueue_bot_message_updates_after_update AFTER UPDATE OF content, media_bucket, media_path, media_metadata, topic_id, reply_to_id, bot_reply_markup ON public.messages FOR EACH ROW EXECUTE FUNCTION private.enqueue_bot_message_updates_after_update()` | `ff179595a4f1b99c9f6572deeded7498cbd195e819a215686e1d152461cff3ce` |
| `messages.trg_enqueue_media_variant_job_on_insert` | `CREATE TRIGGER trg_enqueue_media_variant_job_on_insert AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.enqueue_media_variant_job_for_message()` | `b4816fb4618eee06d5d4d56b24d2d75212224c09161ec7d639bd3e739fde77f1` |
| `messages.trg_enqueue_media_variant_job_on_update` | `CREATE TRIGGER trg_enqueue_media_variant_job_on_update AFTER UPDATE OF media_bucket, media_path, media_url ON public.messages FOR EACH ROW EXECUTE FUNCTION private.enqueue_media_variant_job_for_message()` | `020926143c613a1c91db57e4f365142153e7bee9a8ade7582a14903ffc38102a` |
| `messages.trg_enqueue_message_notifications_after_insert` | `CREATE TRIGGER trg_enqueue_message_notifications_after_insert AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION enqueue_message_notifications()` | `ee06b72cd8bbd3297e6e4aed6278188120703ccf330ed7e6fac0b3ec66aa65f6` |
| `messages.trg_guard_bot_message_created_at` | `CREATE TRIGGER trg_guard_bot_message_created_at BEFORE INSERT OR UPDATE OF created_at ON public.messages FOR EACH ROW EXECUTE FUNCTION private.guard_bot_message_created_at()` | `98aefde78e00a43a32901395b674116d17cafa9ef2d7797fcecf22a4c811dd1d` |
| `messages.trg_guard_message_client_times` | `CREATE TRIGGER trg_guard_message_client_times BEFORE INSERT OR UPDATE OF client_sent_at, edited_at, content ON public.messages FOR EACH ROW EXECUTE FUNCTION private.guard_message_client_times()` | `48910f98596e681e196c9bf51aaa4beeeb32f957116f7d060d0b065f7d7b0d25` |
| `messages.trg_guard_message_media_path` | `CREATE TRIGGER trg_guard_message_media_path BEFORE INSERT OR UPDATE OF media_bucket, media_path, user_id, bot_id, forwarded_from_id ON public.messages FOR EACH ROW EXECUTE FUNCTION private.guard_message_media_path()` | `c9a235326e1db59aeca30ff13aa15d390de250d5845b7ce6bbaed78aa34bb603` |
| `messages.trg_messages_forward_origin` | `CREATE TRIGGER trg_messages_forward_origin BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION messages_forward_origin()` | `c308143d2fb5f436da81ab7cdb826fb489a3ab0a49092694859e34f1ba15fdfd` |
| `messages.trg_messages_sender_on_insert` | `CREATE TRIGGER trg_messages_sender_on_insert BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.enforce_message_sender_on_insert()` | `9d43866798bc2fa4b942156a89c22c50b70fe7d1ac2d33eb3f872dc40e387c46` |
| `messages.trg_messages_sender_on_update` | `CREATE TRIGGER trg_messages_sender_on_update BEFORE UPDATE OF user_id, bot_id, type ON public.messages FOR EACH ROW EXECUTE FUNCTION private.enforce_message_sender_on_update()` | `50bcd611e1dcbe3e765c6fe2a9b81b8cabd15186a05ad246c1964919e60b65e5` |
| `messages.trg_validate_bot_reply_markup` | `CREATE TRIGGER trg_validate_bot_reply_markup BEFORE INSERT OR UPDATE OF bot_id, bot_reply_markup ON public.messages FOR EACH ROW EXECUTE FUNCTION private.validate_bot_reply_markup()` | `768d01c71975ae91ec5e8835614c0e559645aadc9cbd2d816e4cb39b2d980763` |
| `messages.trg_zz_deleted_message_keeps_nothing` | `CREATE TRIGGER trg_zz_deleted_message_keeps_nothing BEFORE UPDATE ON public.messages FOR EACH ROW WHEN (((old.deleted_at IS NOT NULL) OR (new.deleted_at IS NOT NULL))) EXECUTE FUNCTION private.deleted_message_keeps_nothing()` | `b592d01a353e8ecdc7274ee1741375553a054d98b6a665ec86956e5ddf99ac9f` |
| `messages.trg_zz_deleted_message_leaves_no_preview` | `CREATE TRIGGER trg_zz_deleted_message_leaves_no_preview AFTER UPDATE OF deleted_at ON public.messages FOR EACH ROW WHEN (((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL))) EXECUTE FUNCTION private.deleted_message_leaves_no_preview()` | `5ef921b9ed43cab0d7c3a943c3ff6c108846c82521d5927d25a8623b198ddef2` |
| `notifications.trg_enqueue_push_after_notification_insert` | `CREATE TRIGGER trg_enqueue_push_after_notification_insert AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION _enqueue_push_after_notification_insert()` | `41c95153fc4debf5898b18957e8ff2a91b5014ca95df4583b36f6d8bc771a982` |
| `profiles.trg_profiles_mark_message_tombstones` | `CREATE TRIGGER trg_profiles_mark_message_tombstones BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.mark_profile_delete_message_tombstones()` | `fb224f386a3ca4ba42af03c406be00e7ba1aa767b20b3abe3189ef1c7fd2c4c2` |

## RLS and structural guards

Messages, notifications, chat_members, chat_bot_members, topics, user_blocks and inspected push/album tables all have RLS enabled. No RLS was changed.
The selected policies below are the current critical read/write predicates; they are not all policies on all dependency tables.
Policy hash recipe: SHA-256(UTF-8 jsonb_build_object('command',polcmd,'permissive',polpermissive,'roles',polroles,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid))::text).
The roles input is the **production OID array**, so these exact policy hashes are production drift guards, not portable role-name hashes for a fresh database.

| Policy | Mode/command; roles | Live policy SHA-256 |
| --- | --- | --- |
| messages: Chat members can send messages | permissive/a; authenticated | `a8ed4ed6366fbc0ad70483b43717bdde31a037c1afae3df007f36685470de82d` |
| messages: Chat members can view messages | permissive/r; authenticated | `2538e7e48981470a85a52f0e8a1518a07c892d5c53976779de48e5a93b3df201` |
| messages: Users can edit own messages | permissive/w; PUBLIC | `b311685e6b23a7580b23eaa5d1501e5d4eb66ebb0f4f1880be485d2be61d1d40` |
| messages: block banned reads | restrictive/r; PUBLIC | `8d920b7f6f16557832be858ddca1cd22a9ae1a1d4ad721589e82cf861c12fec5` |
| messages: block writes to someone who refused you | restrictive/a; authenticated | `a2461f4445a3a37e5633d13c83e8c3c1287b83fa3bf5c4aa8598479f5cf95f49` |
| notifications: Owner reads own notifications | permissive/r; authenticated | `23b71ce140d51cdf22e0e164d583a34d200d0484d197b3ac33e540394af112a9` |
| user_blocks: Own blocks are yours alone | permissive/*; authenticated | `ba4c418419857bb457da0b0191d2616543c73526fe97a219d9f772c6606f88d3` |

Constraint/index hashes use pg_get_constraintdef / pg_get_indexdef under the recorded inspection search_path.

| Guard | Exact live definition | SHA-256 |
| --- | --- | --- |
| `messages_bot_id_fkey` | `FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE RESTRICT` | `6d34bdb0cb549975daa071cc6d08f22ad8314a6797d0489aec9110eb4b009ab9` |
| `messages_chat_id_fkey` | `FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE` | `6a1e43e639a646c15e48db78f5bc998b73b3cf4604fcfcb76c2f2c2d04465097` |
| `messages_forwarded_from_id_fkey` | `FOREIGN KEY (forwarded_from_id) REFERENCES messages(id) ON DELETE SET NULL` | `cdfc50361f05dc293d5b798f44ae58253c1af5de1d628c709687cff19cc9c045` |
| `messages_sender_shape_check` | `CHECK ((((type = 'system'::text) AND (user_id IS NULL) AND (bot_id IS NULL)) OR ((COALESCE(type, 'text'::text) <> 'system'::text) AND (NOT ((user_id IS NOT NULL) AND (bot_id IS NOT NULL))))))` | `decfeb00e670836f546e91d3f5c844baed92bc977bc277692ea92babd7a3ed7f` |
| `messages_topic_id_fkey` | `FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE` | `09887a135bc2c4890bd7f2b1c1addfd369e734d89488b2d889f86ec5639aae28` |
| `messages_user_id_fkey` | `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL` | `2687f6281ff3065737cde307524ae963d6b7db6826f97a37a439d6743bf13352` |
| `notifications_message_user_once_idx` | `CREATE UNIQUE INDEX notifications_message_user_once_idx ON public.notifications USING btree (user_id, ((payload ->> 'message_id'::text))) WHERE ((kind = 'message'::text) AND (payload ? 'message_id'::text))` | `c6dbe3987d2c8a009dcd510aebea048c09a4b221a586a983194cb198a612d228` |

## Tracked migration fingerprints

File hashes are Git HEAD blob bytes, not working-tree EOL conversion. Newer files present in both migration directories were identical in the parsed tracked copies; one canonical path is shown.

| ID | Tracked path | Whole-file SHA-256 |
| --- | --- | --- |
| M01 | `.migration-backup/supabase/migrations/20260504_chats_membership_hardening.sql` | `518598729895c2487120f4d63ac9a3f35c3c869f82c89a7238db2f2bcb7446c1` |
| M02 | `.migration-backup/supabase/migrations/20260504_roles_admin.sql` | `73cf2898076b891b915f6137a4d4eb55543943005d9d5fa48a7d7df538299bbe` |
| M03 | `.migration-backup/supabase/migrations/20260506_chat_delete_permissions.sql` | `c6a2e24d4c87e46514bc04c8ca430304789fb1c603fb3bf8046f928ddd79f6a7` |
| M04 | `.migration-backup/supabase/migrations/20260527_push_notifications_foundation.sql` | `b688708d7783d28672efdc85662934b73d34c790609a67b991479a292272ccd8` |
| M05 | `.migration-backup/supabase/migrations/20260714_push_foreground_sessions.sql` | `94076df4cbd876e7f44853db822a012092039c431936e9a69c42ee1b2ac090d9` |
| M06 | `.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql` | `514b1aa7f059c31ef67a8c4e753d29149e72121e5920d9804f2a8980322ace68` |
| M07 | `.migration-backup/supabase/migrations/20260911143000_delete_messages_for_everyone.sql` | `49d16f40cff770afc79c6e5bba6704df826ea4831e15f3d0d5af7f9d4956d1b5` |
| M08 | `.migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql` | `ef1338b67c3ad9c8390a4698914760ec0fd6f34bb9d04d02379dac318bbb46f0` |
| M09 | `.migration-backup/supabase/migrations/20260913133000_message_client_time_guard.sql` | `1a166b86e29e4c6a9bcbbd9c1c7a9738844e0ebb772419810cfacc301cc088b3` |
| M10 | `.migration-backup/supabase/migrations/20260914120000_personal_blocks_and_reports.sql` | `0d373bdfacdece79795c03c261885be0664868c6c390fdd017273c742bdc0de5` |
| M11 | `.migration-backup/supabase/migrations/20260919050000_a_bot_can_fetch_a_file_and_is_told_its_size.sql` | `3cf30a25b4b264754598972c2a21b040453688f768f44b426b5e0e450ab1843f` |
| M12 | `.migration-backup/supabase/migrations/20260920120000_bot_full_visibility_request_removal.sql` | `f0b2d29e90b192e6f9eaf05cf3ad1cbc5547d1c1bf92a59806a9bef2c09ea1b5` |
| M13 | `.migration-backup/supabase/migrations/20260921120000_a_forward_names_its_source.sql` | `1623566581ec2c7fad4dc32c4e18610a873f3f56d91952719d3d7fad432aff36` |
| M14 | `supabase/migrations/20260924100000_native_push_claim.sql` | `1fc4b46805e14841f8e945a9fc7c2005c251496d888cad6630fa478e8f9dd6e7` |
| M15 | `supabase/migrations/20260925212424_native_push_outbox_delivery_recheck.sql` | `92edb0ff7209282da9a7bbfb3142b587630c1e5658ae571bc6996c0b0142bbb8` |
| M16 | `supabase/migrations/20260925222612_web_push_subscription_owner_recheck.sql` | `de4b68fb57512faac4f36b070784d97fe134076a04b95b671fbd1d0b89f4f6f6` |
| M17 | `supabase/migrations/20260926085544_album_push_outbox.sql` | `542067d8dd3f196e4ef3407f6238b2a90ef19f9e45b9b6d1dbfe44a9ede81102` |
| M18 | `supabase/migrations/20260926091149_album_push_activate.sql` | `3b8508f42f3e5c4a68f284ee3267daa190e59d2992fb310f2a24ba7f566bb725` |
| M19 | `supabase/migrations/20260926144000_bot_privacy_delivery_epoch.sql` | `b28fcaa8fba7b9bdcce1fb40ebb397cf75c8c8620a6265281f9a51493f9eaa84` |
| M20 | `supabase/migrations/20260926193000_bot_viewer_interface.sql` | `6d3757dddc952f73e52041c2dbe805a9e2510d17377e133aee993ad5781ec7ae` |
| M21 | `supabase/migrations/20260928190000_task_reminders.sql` | `dde68d454984a1bb248024d3521306c2c4a5664f0c131038d6f2d96fdacad85f` |
| M22 | `supabase/migrations/20260928210000_deleted_message_keeps_nothing.sql` | `e1cde49e3ee4dc9478a445269ff81ccce5bfd3d2a875df55842a251cb771a90d` |
| M23 | `supabase/migrations/20260930150000_micro_groups.sql` | `d1dca5ccb88010bce99628d548501fd34d159187825898786b30b67ddea238fd` |

## Reproducible read-only function checkpoint

Run from PowerShell in the main checkout. This returns catalog attributes/hashes only, not source/data. Retain the recorded session search_path when comparing definition hashes; use body hash to distinguish source drift from pretty-print/search_path differences.

```powershell
$sql = @'
BEGIN READ ONLY;
SELECT current_setting('server_version'), current_setting('search_path'), clock_timestamp();
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
       pg_get_userbyid(p.proowner), p.prosecdef, p.provolatile, p.proconfig, p.proacl,
       encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS definition_sha256,
       encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public','private') AND p.proname IN (
    'bot_can_receive_message',
    'bot_message_update_payload',
    'bot_update_still_visible',
    'deleted_message_keeps_nothing',
    'deleted_message_leaves_no_preview',
    'enforce_message_sender_on_insert',
    'enforce_message_sender_on_update',
    'enqueue_bot_message_updates_after_insert',
    'enqueue_bot_message_updates_after_update',
    'guard_bot_message_created_at',
    'guard_message_client_times',
    'lock_bot_message_epoch',
    'mark_profile_delete_message_tombstones',
    'scrub_deleted_message_notifications',
    '_enqueue_push_after_notification_insert',
    '_notification_push_allowed',
    '_notification_push_payload',
    'album_push_claim',
    'album_push_enqueue',
    'album_push_recheck',
    'blocked_from_chat',
    'bot_delivery_prepare_internal',
    'bot_updates_poll_internal',
    'bot_viewer_delivery_recheck_internal',
    'chat_bot_set_privacy',
    'delete_messages_for_everyone',
    'enqueue_message_notifications',
    'forward_message',
    'is_banned',
    'is_chat_member',
    'mark_chat_delete_cascade',
    'messages_forward_origin',
    'native_push_outbox_claim',
    'native_push_outbox_delivery_recheck',
    'push_outbox_claim',
    'push_outbox_delivery_recheck'
)
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);
COMMIT;
'@
$sql | ssh -i C:/Users/maksi/.ssh/letscube_ed25519 -o BatchMode=yes -o ConnectTimeout=10 root@ms.letscube.ru 'docker exec -i supabase-db psql -X -qAt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres'
```

## Handoff

Only this report was written. No code/SQL/client edits, production SQL apply, data reads, backup/restore, container changes, commit/push or agents.
Carry forward isolated tests for entity validation/legacy edit/unrelated update, notification single-row/no edit push, current membership epochs/ban/block/topic source eligibility across all three predelivery paths, forward/deletion/report-retained metadata, and independent bot full/private/own/restricted routing. These are the coordinator's next verification gates, not claimed results from this audit.
