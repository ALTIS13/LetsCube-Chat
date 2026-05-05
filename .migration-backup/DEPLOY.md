# Деплой Neogram на firstvds (Ubuntu 24.04)

Схема: GitHub (private repo) → push в `main` → GitHub webhook → tiny Node listener на сервере → `deploy.sh` → `git pull` + `npm ci` + `next build` + `pm2 reload`. Два сервиса под pm2: `neogram-web` (Next.js) и `neogram-bot` (Telegram-бот).

---

## Шаг 1. Создать GitHub-репозиторий

1. Зайди на https://github.com/new, создай **private** репо `neogram` (или любое имя).
2. **Не добавляй** README/`.gitignore` — он уже есть локально.
3. Скопируй SSH-URL вида `git@github.com:<твой-логин>/neogram.git`.

В терминале на ПК:

```bash
cd /Users/nekit/Documents/LETSCUBE/neogram
git remote add origin git@github.com:<твой-логин>/neogram.git
git push -u origin main
```

Если SSH-ключа на маке для GitHub ещё нет — `ssh-keygen -t ed25519 -C "you@mail"`, потом скопировать `~/.ssh/id_ed25519.pub` в GitHub → Settings → SSH keys.

---

## Шаг 2. Подготовить переменные окружения

На сервере мы создадим два файла. Содержимое для них возьми из текущих локальных:

- `/var/www/neogram/.env.production` — то же, что в локальном `neogram/.env.local`, плюс продакшн-Supabase-ключи и `NEXT_PUBLIC_SITE_URL=https://<твой-домен>`.
- `/var/www/neogram/bot/.env` — `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_IDS`, `ANTHROPIC_API_KEY` и пр.

Не клади их в git. Они в `.gitignore` (`.env*`).

---

## Шаг 3. Купить/привязать домен (или использовать IP)

Webhook от GitHub удобнее принимать через HTTPS, а HTTPS — только через домен. Если домена нет, на firstvds можно взять субдомен бесплатно или купить любой за ~150₽/год. Привяжи A-запись на IP сервера.

Если домена пока нет — пропусти HTTPS-шаги, GitHub примет webhook на http://IP, но с предупреждением.

---

## Шаг 4. Один раз настроить сервер

Зайди по SSH как root (firstvds присылает доступы письмом):

```bash
ssh root@<ip-сервера>
```

Скачай и запусти setup-скрипт. Он сам поставит Node 22, nginx, pm2, ufw, certbot, создаст пользователя `deploy` и сгенерирует SSH-ключ для GitHub:

```bash
# Один из способов — скачать setup из репо через curl сразу после первого пуша:
curl -fsSL https://raw.githubusercontent.com/<твой-логин>/neogram/main/deploy/setup-server.sh -o setup.sh
bash setup.sh git@github.com:<твой-логин>/neogram.git neogram.example.ru
```

Если репо приватный, curl его не достанет — тогда просто скопируй файл вручную: на маке открой `neogram/deploy/setup-server.sh`, скопируй содержимое, на сервере `nano setup.sh`, вставь, сохрани, `bash setup.sh ...`.

Скрипт остановится в момент, когда покажет публичный ключ — это deploy-key для приватного репо. Скопируй его и:

- GitHub → твой репо → Settings → **Deploy keys** → Add deploy key → вставь, **галку „Allow write access" НЕ ставь** (нам нужно только pull).
- Вернись в терминал сервера, нажми Enter — он клонирует репо в `/var/www/neogram`.

---

## Шаг 5. Заполнить env'ы

```bash
sudo -u deploy nano /var/www/neogram/.env.production
sudo -u deploy nano /var/www/neogram/bot/.env
```

---

## Шаг 6. Webhook secret

Сгенерируй секрет и впиши его в systemd-юнит:

```bash
openssl rand -hex 32
sudo nano /etc/systemd/system/neogram-webhook.service
# замени CHANGE_ME_TO_A_LONG_RANDOM_STRING на сгенерированную строку
sudo systemctl daemon-reload
```

---

## Шаг 7. Первый деплой и автозапуск pm2

```bash
sudo -u deploy bash /var/www/neogram/deploy/deploy.sh
sudo -u deploy pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
# скопируй и выполни команду, которую он напечатает
```

Запусти webhook-listener:

```bash
sudo systemctl enable --now neogram-webhook
sudo systemctl status neogram-webhook --no-pager
```

---

## Шаг 8. HTTPS (если есть домен)

```bash
sudo certbot --nginx -d neogram.example.ru
```

Certbot сам пропишет редирект 80 → 443 в nginx-конфиг.

---

## Шаг 9. Подключить webhook в GitHub

GitHub → твой репо → Settings → **Webhooks** → Add webhook:

- **Payload URL**: `https://neogram.example.ru/__deploy`
- **Content type**: `application/json`
- **Secret**: тот же, что в `neogram-webhook.service`
- **Which events**: `Just the push event`
- **Active**: ✅

GitHub отправит ping — должен быть зелёный ✓. Дальше любой `git push origin main` будет автоматически триггерить деплой.

---

## Проверка

```bash
sudo -u deploy pm2 list                       # оба процесса должны быть online
sudo -u deploy pm2 logs neogram-web --lines 50
sudo -u deploy pm2 logs neogram-bot --lines 50
sudo journalctl -u neogram-webhook -f         # лог вебхука
curl -I https://neogram.example.ru            # 200/301
```

---

## Откат к предыдущей версии

```bash
cd /var/www/neogram
sudo -u deploy git log --oneline -5            # найти нужный коммит
sudo -u deploy git reset --hard <sha>
sudo -u deploy bash deploy/deploy.sh
```

---

## Что есть в `deploy/`

| Файл | Назначение |
|---|---|
| `setup-server.sh` | Одноразовый bootstrap чистого Ubuntu 24.04 |
| `ecosystem.config.cjs` | Манифест pm2 для двух сервисов |
| `nginx.conf.template` | Шаблон nginx-сайта (домен подставляется setup'ом) |
| `webhook.js` | Маленький Node-listener, валидирует HMAC от GitHub и зовёт `deploy.sh` |
| `webhook.service` | systemd-юнит для webhook'а |
| `deploy.sh` | git pull → npm ci → build → pm2 reload (single-flight через flock) |
