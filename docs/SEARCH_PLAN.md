# План поиска KUB

Мы не копируем Telegram как бренд или дизайн. Используем похожие UX-паттерны поиска и быстрой навигации там, где они безопасны для KUB.

## Current Audit

- Sidebar chat search:
  - ищет по `chat.name`;
  - дополнительно ищет по `last_message.content`;
  - должен оставаться внутри sidebar без horizontal overflow.
- In-chat search:
  - `ChatSearchBar` ищет только среди уже загруженных сообщений текущего чата;
  - умеет previous/next и jump to message;
  - не ищет по полной истории.
- User/member search:
  - используется в new chat/group, task assign, admin users.
- Task search:
  - полноценного текстового поиска по title/description/assignee/status нет.
- Admin/audit:
  - есть фильтрация/поиск в админских экранах, но нет общей command palette.

## Phase 1: текущий sidebar/search UX

- Удерживать search row внутри sidebar: `min-w-0`, `flex-1`, fixed icon buttons.
- Empty/loading states без скачков layout.
- Mobile search должен быть usable на 390px.
- Не добавлять глобальный поиск без DB/RLS подготовки.

## Phase 2: in-chat message search

- Добавить server-side поиск внутри текущего `chat_id`, respecting RLS.
- Начать с простого `ilike` по `messages.content`, если объем небольшой.
- Для масштаба подготовить отдельную migration с индексами или RPC.
- Не возвращать deleted messages.

## Phase 3: global command/search palette

- Shortcut: `Ctrl+K` / `Cmd+K`.
- Группы результатов: chats, users, tasks, folders.
- Только данные, которые текущий пользователь уже видит через RLS.
- Mobile: full-screen modal вместо узкого popover.

## Phase 4: indexed/RPC search

- RLS-safe RPC для глобального поиска.
- Индексы:
  - messages full-text или trigram;
  - tasks title/description/status/priority;
  - profiles username/full_name.
- Не включать private messages/tasks в выдачу без проверки RLS.

## Safety Rules

- Search не должен обходить RLS.
- Не искать по email обычным пользователям; email допустим только staff/admin, если это явно разрешено.
- Не кешировать приватные результаты глобально между пользователями.
- Не хардкодить test domain.
