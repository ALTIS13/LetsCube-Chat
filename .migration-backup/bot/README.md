# NeoGram Claude Code Bot

Telegram бот для управления Claude Code из мессенджера.

## Настройка

1. Скопируй `.env.example` → `.env`
2. Вставь токен бота (от @BotFather)
3. Узнай свой Telegram ID → напиши [@userinfobot](https://t.me/userinfobot)
4. Вставь ID в `ALLOWED_USER_IDS`

## Запуск

```bash
cd bot
node bot.js
# или для авто-перезапуска при изменениях:
node --watch bot.js
```

## Команды в Telegram

| Команда | Описание |
|---------|----------|
| `/start` | Справка |
| `/status` | Статус бота + последние коммиты |
| `/stop` | Остановить текущую задачу |
| `/ls` | Список файлов проекта |
| `/git` | Git status |
| Любой текст | Выполнить как задачу для Claude Code |

## Примеры

```
Добавь кнопку поиска в ChatHeader
Исправь баг: при отправке сообщения textarea не очищается
Сделай commit с описанием всех изменений
Запусти npm run build и покажи результат
```
