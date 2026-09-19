/**
 * The channel already shows who is in it, so the conversation stops saying so.
 *
 * **Applied to production on 2026-09-19, before this file existed.** What ran
 * was `20260918200000_a_call_says_so_in_the_conversation.rollback.sql`, and the
 * body below is that file byte for byte from `begin;` onwards. This header is
 * the only thing that is new, because a record of what happened has to be the
 * thing that happened; a tidier body would be a description of a migration
 * rather than the migration. `tests/unit/voice-call-service-message.test.mjs`
 * asserts the two bodies are identical, so an edit here cannot quietly make the
 * record diverge from what the database ran.
 *
 * ── Why the feature was removed ───────────────────────────────────────────
 *
 * The owner, looking at a group chat that was nothing but two sentences
 * alternating: «Убери также эти бесконечные уведомления о начале разговора в
 * канале, по сути и так видно если люди сидят, можно просто оставить отметку на
 * группе о том сколько людей в войсе как уже есть чтобы не мусорить инфой.»
 *
 * The information those sentences carried -- that people are talking in a
 * channel right now -- is already on the channel itself, as the participant
 * count the rail draws, and it is there continuously rather than as two rows
 * appended to a conversation for ever. A second mechanism saying the same thing
 * is what the owner asked to be rid of.
 *
 * Twenty-five rows were counted read-only that day, all in one group chat, all
 * written that day, with a median gap of about fifteen seconds. Fifteen seconds
 * is not a call: it is D-256, the client re-establishing its session every
 * 15-16 seconds, each reconnect emptying and refilling the room and each
 * crossing of zero writing a line. D-256 was fixed hours earlier, so the flood
 * would have been smaller tomorrow. **That is not why the feature goes.** It
 * goes because the owner looked at what it does when it works. Tuning it -- a
 * debounce, a minimum length, a grace window -- would have kept two mechanisms
 * describing one fact, which is the shape
 * `20260918280000_a_private_chat_has_no_channel_to_announce.sql` already had to
 * repair once.
 *
 * ── The mechanism that deliberately stays ─────────────────────────────────
 *
 * **`public.voice_call_stop` and `public.voice_call_record_line` are not
 * touched.** They are the other mechanism -- the record a one-to-one call
 * leaves in a private chat, with its outcome, its direction and its length,
 * carried in `messages.system_payload` -- and the owner asked about channels in
 * groups, not about the call log in a private conversation.
 *
 * That the two are genuinely separate was measured rather than assumed. Before
 * the drop, the only functions on production whose source mentioned
 * `voice_call_transition`, `voice_call_service_line`, `call_announced_at` or
 * `write_voice_call_service_message` were those three functions themselves;
 * after it, no function in `public`, `private`, `auth`, `storage` or `realtime`
 * mentions any of them. Nothing was left pointing at a gap.
 *
 * ── What it cost, recorded rather than predicted ──────────────────────────
 *
 * One room held `call_announced_at` when this ran, so that call's «закончился»
 * line was never written. Under the old feature that would be a defect; here it
 * is one fewer row of something being removed, and every row of it was deleted
 * afterwards in any case.
 *
 * `20260918230000_a_ring_cannot_be_forged.sql` stopped being re-runnable on its
 * own: it rewrote a table-wide INSERT grant into a column list naming
 * `call_announced_at`, and with the column gone that `grant` raises. The
 * recorded order still replays cleanly, because 230000 runs long before this
 * file. `authenticated` went from 14 INSERT columns on `voice_channels` to 13
 * and kept all 7 UPDATE columns, so creating and using a channel is unaffected.
 *
 * ── The rows already written ──────────────────────────────────────────────
 *
 * The body below keeps them, and says so. They were removed **separately and
 * afterwards**, on the owner's explicit instruction («Старые записи можешь
 * почистить»), by a statement of the shape written out at the bottom of this
 * file, carrying a self-check that would have refused any count but 25. The
 * order was: schema dump taken and verified, the 25 rows exported to CSV and
 * read back, this file rehearsed inside a transaction that was rolled back,
 * this file applied, the rows re-exported and the export's sha256 compared with
 * the first -- identical, which is what proves nothing changed between
 * measuring and deleting -- then deleted. Twenty-five deleted, zero remain, the
 * backup kept on the server.
 *
 * **The `delete` written out at the bottom of this file is the weaker one, and
 * it is left as it stands because the body is a record.** It was written on
 * 2026-09-18, before `20260918250000` gave `public.messages` its
 * `system_payload` column, so it cannot use the one thing that tells a channel
 * announcement from a private chat's call record -- there is still no column
 * saying which feature wrote a system row. Anybody running it now should use
 * this instead, which is the shape that was actually run and the shape
 * `20260918280000` established:
 *
 *   delete from public.messages m
 *    using public.chats c
 *    where c.id = m.chat_id
 *      and c.type <> 'private'
 *      and m.type = 'system'
 *      and m.system_payload is null
 *      and (m.content like 'Начался разговор в канале «%»'
 *        or m.content like 'Разговор в канале «%» закончился'
 *        or m.content = 'Начался разговор в голосовом канале'
 *        or m.content = 'Разговор в голосовом канале закончился');
 *
 * with the count asserted before and after, so that a number which has moved
 * since it was measured raises instead of guessing.
 *
 * The rollback beside this file restores the feature. It restores
 * `write_voice_call_service_message` as `20260918280000` left it, **not** as
 * `20260918200000` wrote it, because re-running the older writer would
 * reinstate the defect 280000 repaired: a private chat being told about a
 * «канал» that exists only as an implementation detail.
 */

begin;

set local lock_timeout = '5s';

do $role$
begin
  if pg_catalog.to_regclass('public.voice_channels') is null then
    raise exception 'public.voice_channels does not exist, so there is nothing to roll back';
  end if;
  if not pg_catalog.pg_has_role(
       current_user,
       (select relowner from pg_catalog.pg_class where oid = 'public.voice_channels'::regclass),
       'USAGE'
     ) then
    raise exception
      'this file drops a trigger and a column on public.voice_channels, which % owns: run it as supabase_admin',
      (select pg_catalog.pg_get_userbyid(relowner)
         from pg_catalog.pg_class where oid = 'public.voice_channels'::regclass);
  end if;
end
$role$;

drop trigger if exists trg_voice_call_service_message on public.voice_channels;

drop function if exists public.write_voice_call_service_message();
drop function if exists public.voice_call_service_line(text, text);
drop function if exists public.voice_call_transition(integer, integer, boolean);

alter table public.voice_channels drop column if exists call_announced_at;

do $check$
declare
  v_left integer;
begin
  select pg_catalog.count(*) into v_left
    from pg_catalog.pg_trigger
   where not tgisinternal
     and tgrelid = 'public.voice_channels'::regclass
     and tgname = 'trg_voice_call_service_message';
  if v_left <> 0 then
    raise exception 'the service-message trigger is still on voice_channels';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'write_voice_call_service_message',
         'voice_call_service_line',
         'voice_call_transition'
       )
  ) then
    raise exception 'a service-message function survived the rollback';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.voice_channels'::regclass
       and attname = 'call_announced_at' and not attisdropped
  ) then
    raise exception 'call_announced_at survived the rollback';
  end if;

  raise notice 'a call no longer says anything in the conversation; the lines already written are kept';
end
$check$;

commit;

/**
 * Only if the rows themselves have to go as well, and only with the owner
 * saying so. It is not part of the rollback because it deletes people's
 * conversation history to undo a schema change, and because these two sentences
 * are the only way to tell such a row from D-166's membership lines -- there is
 * no column that says which feature wrote a system message.
 *
 *   delete from public.messages
 *    where type = 'system'
 *      and (content like 'Начался разговор в канале «%»'
 *           or content like 'Разговор в канале «%» закончился'
 *           or content = 'Начался разговор в голосовом канале'
 *           or content = 'Разговор в голосовом канале закончился');
 */
