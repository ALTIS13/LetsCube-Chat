-- `owner` and `tech_admin` are equal in permissions on purpose.
--
-- This is a decision, recorded so it is not re-discovered as a defect.
--
-- The 2026-09-04 roles audit flagged the two as "indistinguishable" — they grant
-- the same access, and no amount of editing `role_permissions` changes that,
-- because `has_permission` short-circuits to `true` for either before it reads
-- any table. That reads like a bug. It is not.
--
-- The owner's answer, 2026-09-04: the split is organisational, not a permission
-- boundary. One person runs the technical side, the other runs people and the
-- product — and the second also comes in to test, so cutting his reach would
-- get in the way of the thing he is there to do. The roles exist to say who is
-- who, which is what the badge on a profile is for; they were never meant to
-- fence one off from the other.
--
-- So the parity is the intended state and the short-circuit in `has_permission`
-- is the correct implementation of it. What was missing is any statement to
-- that effect: the descriptions promised a distinction the system does not make,
-- which is what sent the audit looking for a fault. They now say the true thing,
-- and they say it in the admin panel, where somebody comparing the two roles
-- will actually be standing.
--
-- Who holds them, and why the count looks wrong at first glance. Four accounts
-- resolve through the bypass, and the audit initially read two of them as
-- "administrators the legacy column calls ordinary users", which sounded like
-- privilege that had leaked. It had not:
--
--   profiles.role='admin', global tech_admin   registered 2026-05-04   a person
--   profiles.role='admin', global owner        registered 2026-05-05   a person
--   profiles.role='user',  global tech_admin   registered 2026-05-05   TEST ACCOUNT
--   profiles.role='user',  global owner        registered 2026-05-17   TEST ACCOUNT
--
-- The last two are two of the five `is_test_account` logins, given the roles on
-- purpose so the functionality behind them could be exercised. They are
-- temporary by construction: those logins are to be deleted when the work on
-- the messenger is finished, and these grants go with them. Until then, any
-- count of "how many administrators" that does not exclude test accounts is
-- wrong by two — the same trap `achievement_recipients` exists to avoid.
--
-- If this ever needs to change, the change is to `has_permission` — not to the
-- data — and it needs a decision about which of the current holders moves.
--
-- Additive: four description strings and two comments. No permission, no
-- assignment, no policy is touched.

update public.roles
set description = 'Полный доступ. Отвечает за людей и продукт. По правам намеренно равен тех. администратору — разделение ролей организационное, а не по доступу.'
where key = 'owner';

update public.roles
set description = 'Полный доступ. Отвечает за техническую часть. По правам намеренно равен владельцу — разделение ролей организационное, а не по доступу.'
where key = 'tech_admin';

-- The other two globals describe themselves honestly while we are here: both
-- have zero holders, and neither one's `role_permissions` rows are consulted
-- for anybody today.
update public.roles
set description = 'Мост совместимости для аккаунтов со старым значением profiles.role = admin. Отдельно никому не назначается.'
where key = 'admin';

update public.roles
set description = 'Операционный доступ. Держателей нет; роль сохранена, потому что на неё ссылаются политики через is_manager_or_admin().'
where key = 'manager';

comment on function public.has_permission(uuid, text) is
  'Resolves in three tiers: an owner/tech_admin bypass that returns true without reading any table, then global roles through role_permissions, then the hardcoded legacy fallback on profiles.role. The bypass makes owner and tech_admin equal by design (2026-09-04 owner decision): the two roles say who someone is, they are not an access boundary. Changing that means changing this function, not the data.';

comment on table public.role_permissions is
  'Grants for global- and location-scope roles. Note that it is not consulted for owner or tech_admin, which bypass it in has_permission, nor for accounts that fall through to the legacy fallback. As of 2026-09-04 every account resolves either by the bypass or by the fallback, so these rows decide nobody''s access today; location-scope rows are the exception and are read by has_location_permission.';
