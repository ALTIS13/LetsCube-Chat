-- Say what each permission actually lets a person do.
--
-- Asked for by the owner on 2026-09-04: "все правила расписаны корректно а не
-- технически". They were not. Every name was a nominalisation mirroring its own
-- key — `roles.view` read «Просмотр ролей», `system.manage` read «Управление
-- системой» — which is a list of database tables wearing Russian, and answers
-- none of "what changes if I tick this box".
--
-- Two permissions had no copy at all in the client fallback and rendered as a
-- bare key there: `bots.suspend` and `tasks.claim`.
--
-- WHERE THE TEXT ACTUALLY COMES FROM, which is the part that nearly went wrong.
-- `getPermissionLabel` prefers `permissions.name` from the database over the
-- map in `artifacts/kub/src/lib/rolePermissions.ts`, and all 40 rows carry a
-- name and a description. So rewriting only the TypeScript would have changed
-- nothing on screen. The client map is the fallback for a row that has no copy;
-- this migration is what the administrator actually reads. Both are updated
-- from the same source, and the file this was generated from is that source.
--
-- The voice: the name is a verb phrase — what the holder can do. The
-- description is the boundary or the cost: what it bypasses, what it leaves
-- alone, where a mistake is dearer than usual. Neither restates the key.
--
-- Additive: 40 name/description pairs. No key, no grant, no policy is touched.

update public.permissions as p
set name = v.name,
    description = v.description
from (values
  ('audit.view', 'Читать журнал действий', 'История действий администраторов: кто что изменил и когда. Ничего не меняет.'),
  ('bots.suspend', 'Останавливать ботов', 'Приостанавливать и возвращать ботов. Доступа к их токенам это не даёт.'),
  ('chats.invite', 'Звать людей в чаты', 'Приглашать туда, где правила чата это и так разрешают.'),
  ('chats.invite_any', 'Звать в любой чат, минуя его правила', 'Приглашать в любой чат независимо от его правил. Обходит настройку владельца чата.'),
  ('chats.manage_invites', 'Отзывать и перевыпускать приглашения', 'Отменять приглашения, выпускать заново и смотреть их историю.'),
  ('chats.manage_roles', 'Менять роли участников чата', 'Повышать и понижать участников внутри чата.'),
  ('chats.moderate', 'Модерировать чаты', 'Вмешиваться в чужие переписки: удалять сообщения и ограничивать участников.'),
  ('folders.manage_shared', 'Вести общие папки', 'Создавать и менять папки чатов, общие для всех.'),
  ('location_members.manage', 'Менять состав локаций', 'Добавление и удаление сотрудников, их роли и основной администратор локации.'),
  ('location_members.view', 'Видеть состав локаций', 'Кто работает в локации и с какой ролью.'),
  ('locations.manage', 'Создавать и менять локации', 'Создание и изменение локаций целиком.'),
  ('locations.view', 'Видеть локации', 'Список локаций и кто к какой относится.'),
  ('media.moderate', 'Снимать чужие вложения', 'Удалять вложения, загруженные другими людьми.'),
  ('permissions.manage', 'Менять набор прав у роли', 'Решает, что роль позволяет делать. Фактически раздаёт доступ всем, у кого эта роль.'),
  ('roles.manage', 'Создавать и менять роли', 'Создание, переименование, порядок и цвет. Набор прав меняется отдельным правом.'),
  ('roles.view', 'Видеть роли и их права', 'Только чтение. Открывает раздел ролей и показывает, что каждая роль даёт.'),
  ('support.claim', 'Брать обращение в работу', 'Взять обращение на себя, чтобы им занимался один человек.'),
  ('support.escalate', 'Поднимать обращение выше', 'Поднять обращение на уровень выше, когда своих полномочий не хватает.'),
  ('support.lookup_customer', 'Смотреть карточку обратившегося', 'Смотреть данные обратившегося. Персональные данные — открывать по необходимости.'),
  ('support.manage', 'Управлять очередью поддержки', 'Управлять очередью целиком: приоритеты, закрытие, чужие обращения.'),
  ('support.reply', 'Отвечать в обращениях', 'Писать ответы, которые увидит обратившийся.'),
  ('support.settings', 'Менять настройки поддержки', 'Менять то, как поддержка работает у всех: маршрутизацию и правила.'),
  ('support.transfer', 'Передавать обращение другому', 'Отдать обращение другому сотруднику.'),
  ('support.view', 'Видеть обращения в поддержку', 'Читать обращения в поддержку, не отвечая на них.'),
  ('system.manage', 'Менять технические настройки', 'Самое широкое право: технические настройки и аварийное обслуживание, влияющие на весь мессенджер.'),
  ('tasks.assign', 'Назначать задачи другим', 'Назначать задачи другим людям.'),
  ('tasks.bulk_delete', 'Удалять задачи пачкой', 'Удаление сразу многих. Ошибка обходится дороже — отдельное право не случайно.'),
  ('tasks.claim', 'Брать задачу себе', 'Взять свободную задачу на себя, не дожидаясь назначения.'),
  ('tasks.create', 'Создавать задачи', 'Ставить новые задачи в своей области.'),
  ('tasks.delete', 'Удалять задачи', 'Удаление по одной. Задача уходит в корзину и может быть возвращена.'),
  ('tasks.manage', 'Менять и закрывать задачи', 'Менять содержание, сроки и статус, включая закрытие.'),
  ('tasks.manage_admin_tasks', 'Менять задачи администраторов', 'Менять административные задачи, а не только видеть их.'),
  ('tasks.manage_all_locations', 'Менять задачи всех локаций', 'Снимает границу локации при изменении задач.'),
  ('tasks.restore', 'Возвращать удалённые задачи', 'Возвращать удалённые задачи из корзины.'),
  ('tasks.view', 'Видеть задачи своей области', 'Задачи тех локаций, к которым человек относится. Не все подряд.'),
  ('tasks.view_admin_tasks', 'Видеть задачи администраторов', 'Открывает задачи, помеченные как административные и обычно скрытые.'),
  ('tasks.view_all_locations', 'Видеть задачи всех локаций', 'Снимает границу локации: видны задачи всех, а не только своих.'),
  ('users.assign_roles', 'Выдавать роли людям', 'Выдаёт и снимает роли — в том числе те, что сильнее собственной. Давать с осторожностью.'),
  ('users.manage', 'Блокировать и ограничивать пользователей', 'Блокировки, ограничения и снятие их. Роли этим правом не выдаются.'),
  ('users.view', 'Видеть пользователей', 'Список и карточки. Без блокировок и без смены ролей.')
) as v(key, name, description)
where p.key = v.key;

-- Every permission must end up with copy; a silent gap is how the two above
-- shipped. This fails the migration rather than leaving a key on screen.
do $$
declare v_missing text;
begin
  select string_agg(key, ', ' order by key) into v_missing
    from public.permissions
   where coalesce(btrim(name), '') = '' or coalesce(btrim(description), '') = '';
  if v_missing is not null then
    raise exception 'permissions without readable copy: %', v_missing;
  end if;
end $$;
