export const BOT_API_BASE_URL = "https://api.letscube.ru/bot/v1/";
export const BOT_API_AUTHORIZATION = "Authorization: Bot <token>";

export interface BotApiExample {
  language: "cURL" | "JavaScript" | "Python";
  code: string;
}

export interface BotApiMethod {
  name: string;
  summary: string;
  input: string;
}

export interface BotApiMethodGroup {
  title: string;
  methods: readonly BotApiMethod[];
}

export const BOT_API_EXAMPLES: readonly BotApiExample[] = [
  {
    language: "cURL",
    code: `curl --request POST \\
  https://api.letscube.ru/bot/v1/getMe \\
  --header "Authorization: Bot $LETSCUBE_BOT_TOKEN" \\
  --header "Content-Type: application/json" \\
  --data '{}'

curl --request POST \\
  https://api.letscube.ru/bot/v1/sendMessage \\
  --header "Authorization: Bot $LETSCUBE_BOT_TOKEN" \\
  --header "Content-Type: application/json" \\
  --data '{
    "chat_id": "11111111-1111-4111-8111-111111111111",
    "text": "Сборка завершена",
    "idempotency_key": "deploy-status-20260831-01"
  }'`,
  },
  {
    language: "JavaScript",
    code: `const token = process.env.LETSCUBE_BOT_TOKEN;
if (!token) throw new Error("LETSCUBE_BOT_TOKEN is required");

async function callBot(method, body) {
  const response = await fetch(
    "https://api.letscube.ru/bot/v1/" + method,
    {
      method: "POST",
      headers: {
        Authorization: "Bot " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error?.code);
  return payload.result;
}

const bot = await callBot("getMe", {});
await callBot("sendMessage", {
  chat_id: "11111111-1111-4111-8111-111111111111",
  text: "Сборка завершена",
  idempotency_key: "deploy-status-20260831-01",
});`,
  },
  {
    language: "Python",
    code: `import os
import requests

TOKEN = os.environ["LETSCUBE_BOT_TOKEN"]
BASE_URL = "https://api.letscube.ru/bot/v1/"
HEADERS = {"Authorization": f"Bot {TOKEN}"}

def call_bot(method, body):
    response = requests.post(
        BASE_URL + method,
        headers=HEADERS,
        json=body,
        timeout=10,
    )
    response.raise_for_status()
    payload = response.json()
    if not payload["ok"]:
        raise RuntimeError(payload["error"]["code"])
    return payload["result"]

bot = call_bot("getMe", {})
call_bot("sendMessage", {
    "chat_id": "11111111-1111-4111-8111-111111111111",
    "text": "Сборка завершена",
    "idempotency_key": "deploy-status-20260831-01",
})`,
  },
];

export const BOT_API_METHOD_GROUPS: readonly BotApiMethodGroup[] = [
  {
    title: "Идентификация",
    methods: [
      { name: "getMe", summary: "Публичная идентичность текущего бота.", input: "{}" },
      {
        name: "getWebhookInfo",
        summary: "Состояние webhook и безопасные счетчики доставки.",
        input: "{}",
      },
    ],
  },
  {
    title: "Сообщения и файлы",
    methods: [
      {
        name: "sendMessage",
        summary: "Текст до 4096 символов, ответ, тема и callback-кнопки.",
        input: "chat_id, text, idempotency_key",
      },
      {
        name: "sendPhoto / sendVideo / sendDocument / sendVoice",
        summary: "Отправка ранее разрешенного объекта chat-media.",
        input: "chat_id, media, idempotency_key",
      },
      {
        name: "sendChatAction",
        summary: "Краткое состояние typing или загрузки.",
        input: "chat_id, action, idempotency_key",
      },
      {
        name: "editMessageText / deleteMessage",
        summary: "Изменение сообщения, принадлежащего боту.",
        input: "chat_id, message_id, idempotency_key",
      },
      {
        name: "getFile",
        summary: "Короткоживущая ссылка на доступное боту вложение.",
        input: "chat_id, message_id",
      },
    ],
  },
  {
    title: "Команды и взаимодействия",
    methods: [
      {
        name: "setMyCommands",
        summary: "Заменяет список из не более чем 100 команд.",
        input: "commands, idempotency_key",
      },
      { name: "getMyCommands", summary: "Возвращает текущие команды.", input: "{}" },
      {
        name: "answerCallbackQuery",
        summary: "Подтверждает нажатие callback-кнопки.",
        input: "callback_query_id, idempotency_key",
      },
    ],
  },
  {
    title: "Доставка обновлений",
    methods: [
      {
        name: "setWebhook",
        summary: "Включает HTTPS webhook и отключает long polling.",
        input: "url, secret_token, idempotency_key",
      },
      {
        name: "deleteWebhook",
        summary: "Отключает webhook; очередь можно очистить явно.",
        input: "drop_pending_updates, idempotency_key",
      },
      {
        name: "getUpdates",
        summary: "Long polling до 30 секунд, не более 100 обновлений.",
        input: "offset, limit, timeout, allowed_updates",
      },
    ],
  },
];

export const BOT_COMMANDS_EXAMPLE = `{
  "commands": [
    { "command": "status", "description": "Статус сервиса" },
    { "command": "help", "description": "Доступные команды" }
  ],
  "idempotency_key": "commands-20260831-01"
}`;

export const BOT_CALLBACK_EXAMPLE = `{
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "text": "Подтвердить действие?",
  "reply_markup": {
    "inline_keyboard": [[
      { "text": "Подтвердить", "callback_data": "confirm:42" },
      { "text": "Отмена", "callback_data": "cancel:42" }
    ]]
  },
  "idempotency_key": "confirmation-42"
}`;

export const BOT_UPDATE_EXAMPLE = `{
  "update_id": 12041,
  "payload": {
    "callback_query": {
      "id": "22222222-2222-4222-8222-222222222222",
      "data": "confirm:42"
    }
  }
}`;

export const BOT_SUCCESS_EXAMPLE = `{
  "ok": true,
  "result": { "id": "...", "username": "status_bot", "is_bot": true }
}`;

export const BOT_ERROR_EXAMPLE = `{
  "ok": false,
  "error": {
    "code": "rate_limited",
    "message": "Too many requests",
    "request_id": "...",
    "retry_after": 3
  }
}`;
