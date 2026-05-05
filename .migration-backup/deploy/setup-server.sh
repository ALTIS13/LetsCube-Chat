#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# One-time server setup for Neogram on a fresh Ubuntu 24.04 VPS (firstvds.ru).
#
# Usage (run as root once, right after first SSH login):
#   bash setup-server.sh <github-repo-ssh-url> <domain>
#
# Example:
#   bash setup-server.sh git@github.com:nikita/neogram.git neogram.example.ru
#
# What it does:
#   1. Updates system, installs nginx, git, ufw, certbot, build-essential
#   2. Installs Node.js 22 LTS via NodeSource
#   3. Installs pm2 globally
#   4. Creates 'deploy' system user with sudo for the few commands we need
#   5. Generates an SSH deploy-key for GitHub (you copy it to the repo afterwards)
#   6. Clones the repo into /var/www/neogram
#   7. Drops nginx config, opens firewall (22, 80, 443, 9000 webhook)
#   8. Prints next-step instructions
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${1:-}"
DOMAIN="${2:-}"

if [[ -z "$REPO_URL" || -z "$DOMAIN" ]]; then
  echo "Usage: $0 <github-repo-ssh-url> <domain>"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (or with sudo)."
  exit 1
fi

APP_USER="deploy"
APP_DIR="/var/www/neogram"
WEBHOOK_PORT=9000

echo "▶ 1/8  Updating system…"
apt-get update -y
apt-get upgrade -y

echo "▶ 2/8  Installing base packages…"
apt-get install -y curl git ufw build-essential nginx ca-certificates gnupg \
  certbot python3-certbot-nginx

echo "▶ 3/8  Installing Node.js 22 LTS…"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "▶ 4/8  Installing pm2…"
npm install -g pm2

echo "▶ 5/8  Creating deploy user…"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$APP_USER"
  # Grant only the specific commands we need without password
  cat >/etc/sudoers.d/deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /bin/systemctl restart nginx, /bin/systemctl reload nginx, /bin/systemctl restart neogram-webhook, /usr/bin/certbot
EOF
  chmod 440 /etc/sudoers.d/deploy
fi

# SSH dir
sudo -u "$APP_USER" mkdir -p "/home/$APP_USER/.ssh"
sudo -u "$APP_USER" chmod 700 "/home/$APP_USER/.ssh"

echo "▶ 6/8  Generating deploy SSH key (if absent)…"
KEY_PATH="/home/$APP_USER/.ssh/id_ed25519"
if [[ ! -f "$KEY_PATH" ]]; then
  sudo -u "$APP_USER" ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "deploy@$(hostname)"
fi
# Pre-trust github.com
sudo -u "$APP_USER" ssh-keyscan -t ed25519 github.com >> "/home/$APP_USER/.ssh/known_hosts" 2>/dev/null || true

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  COPY THIS PUBLIC KEY into GitHub → Repo → Settings → Deploy keys"
echo "  (allow write access only if you really need it; for pull-only — leave unchecked)"
echo "════════════════════════════════════════════════════════════════════════"
cat "$KEY_PATH.pub"
echo "════════════════════════════════════════════════════════════════════════"
echo "Press ENTER once you've added the key to GitHub…"
read -r

echo "▶ 7/8  Cloning repo to $APP_DIR…"
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"
# pm2 + deploy.sh write here; create up front so deploy doesn't trip on perms
mkdir -p /var/log/neogram
chown "$APP_USER:$APP_USER" /var/log/neogram
if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
fi

echo "▶ 8/8  Configuring nginx + firewall…"

# Render nginx config from template
sed "s/__DOMAIN__/$DOMAIN/g; s|__WEBHOOK_PORT__|$WEBHOOK_PORT|g" \
  "$APP_DIR/deploy/nginx.conf.template" > /etc/nginx/sites-available/neogram
ln -sf /etc/nginx/sites-available/neogram /etc/nginx/sites-enabled/neogram
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# Firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# Install webhook systemd unit
install -m 644 "$APP_DIR/deploy/webhook.service" /etc/systemd/system/neogram-webhook.service
systemctl daemon-reload

echo
echo "✅ Base setup done."
echo
echo "NEXT STEPS (do these manually, in order):"
echo "  1) Create env files on the server:"
echo "       sudo -u $APP_USER nano $APP_DIR/.env.production       # Next.js env"
echo "       sudo -u $APP_USER nano $APP_DIR/bot/.env              # Telegram bot env"
echo "  2) Pick a webhook secret (any long random string) and put it into the unit file:"
echo "       sudo nano /etc/systemd/system/neogram-webhook.service  # set GITHUB_WEBHOOK_SECRET"
echo "       sudo systemctl daemon-reload"
echo "  3) First build + start of services:"
echo "       sudo -u $APP_USER bash $APP_DIR/deploy/deploy.sh"
echo "       sudo -u $APP_USER pm2 save"
echo "       sudo env PATH=\$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $APP_USER --hp /home/$APP_USER"
echo "  4) Start the webhook listener:"
echo "       sudo systemctl enable --now neogram-webhook"
echo "  5) Get HTTPS cert:"
echo "       sudo certbot --nginx -d $DOMAIN"
echo "  6) In GitHub repo → Settings → Webhooks add:"
echo "       Payload URL : https://$DOMAIN/__deploy"
echo "       Content type: application/json"
echo "       Secret      : <the same string as GITHUB_WEBHOOK_SECRET>"
echo "       Events      : Just the push event"
echo
