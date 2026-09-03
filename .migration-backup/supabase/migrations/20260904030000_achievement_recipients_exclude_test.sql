-- Who actually holds an achievement, for counting purposes.
--
-- Five of the fourteen accounts exist for testing and will be deleted when the
-- work on the messenger is done. They earn badges like anyone else — that is
-- what makes the feature testable — but they are not people, and counting them
-- makes every figure about the product wrong in the same direction. Reported as
-- "12 alpha testers" once already, when the honest number was 7.
--
-- There is no surface counting recipients today. This exists so that the first
-- one cannot get it wrong: it is the canonical answer to "how many hold this",
-- and a count taken straight from `user_achievements` is the thing to look for
-- in review.
--
-- `security_invoker` so the caller's own row-level security still applies —
-- a view must not become a way to read what its caller could not.
--
-- Additive: one view.

create or replace view public.achievement_recipients
with (security_invoker = true) as
select
  ua.achievement_key,
  ua.user_id,
  ua.granted_at,
  ua.granted_by
from public.user_achievements ua
join public.profiles profile on profile.id = ua.user_id
where not profile.is_test_account;

comment on view public.achievement_recipients is
  'Achievement holders excluding test accounts. Count recipients from here, not from user_achievements: test accounts earn badges so the feature can be exercised, but they are not people and will be deleted.';

grant select on public.achievement_recipients to anon, authenticated;

/**
 * How many people hold each achievement, as a share of everyone using the
 * messenger.
 *
 * The interface shows this on hover — "получили N% пользователей" — which is
 * what makes a rare badge feel rare. The denominator is real accounts only, for the
 * same reason the numerator is: five of the fourteen accounts here exist for
 * testing and will be deleted, and counting them would move both halves of the
 * fraction in different directions.
 *
 * Aggregate only: it exposes no identity, and the badges themselves are already
 * public by policy. `security_invoker` again, so it can never read more than
 * its caller could.
 */
create or replace view public.achievement_stats
with (security_invoker = true) as
select
  definition.key as achievement_key,
  count(recipient.user_id) as holders,
  (select count(*) from public.profiles p where not p.is_test_account) as eligible
from public.achievements definition
left join public.achievement_recipients recipient
  on recipient.achievement_key = definition.key
where definition.active
group by definition.key;

comment on view public.achievement_stats is
  'Per-achievement holder counts and the eligible population, both excluding test accounts. The share is computed by the caller so an empty product does not have to be represented as a number.';

grant select on public.achievement_stats to anon, authenticated;
