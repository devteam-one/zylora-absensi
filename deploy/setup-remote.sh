#!/usr/bin/env bash
# Dijalankan DI EC2 oleh deploy.sh. Memasang Node 22+ (bila perlu), menulis env,
# dan memasang + menjalankan systemd service. Idempoten.
set -euo pipefail

REMOTE_DIR="${REMOTE_DIR:-/opt/zylora}"
SECRET="${ZYLORA_SECRET:?ZYLORA_SECRET wajib}"
RUN_USER="$(whoami)"

# 1. Pastikan Node >= 22 (node:sqlite butuh 22+). Install via NodeSource bila perlu.
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 22 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  echo "  → Memasang Node.js 22 (NodeSource) ..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "  → Node: $(node --version)"

# 2. Direktori data persisten (DB SQLite) + direktori backup. DB tidak ikut
#    tersalin (di-exclude), jadi data di server tidak tertimpa tiap deploy.
mkdir -p "$REMOTE_DIR/data" "$REMOTE_DIR/backups"

# 3. Env file (rahasia, mode 600).
sudo tee /etc/zylora.env >/dev/null <<EOF
NODE_ENV=production
ZYLORA_SECRET=$SECRET
ZYLORA_HOST=127.0.0.1
ZYLORA_PORT=5181
ZYLORA_DB=$REMOTE_DIR/data/zylora.db
ZYLORA_TZ=${ZYLORA_TZ:-Asia/Jakarta}
ZYLORA_BACKUP_DIR=$REMOTE_DIR/backups
ZYLORA_BACKUP_KEEP=${ZYLORA_BACKUP_KEEP:-14}
EOF
sudo chmod 600 /etc/zylora.env

# 4. systemd service (substitusi placeholder).
sudo cp "$REMOTE_DIR/zylora-api.service" /etc/systemd/system/zylora-api.service
sudo sed -i "s#__REMOTE_DIR__#$REMOTE_DIR#g; s#__USER__#$RUN_USER#g" /etc/systemd/system/zylora-api.service

# 4b. Timer backup DB harian (service oneshot + timer).
sudo cp "$REMOTE_DIR/zylora-backup.service" /etc/systemd/system/zylora-backup.service
sudo cp "$REMOTE_DIR/zylora-backup.timer" /etc/systemd/system/zylora-backup.timer
sudo sed -i "s#__REMOTE_DIR__#$REMOTE_DIR#g; s#__USER__#$RUN_USER#g" /etc/systemd/system/zylora-backup.service

sudo systemctl daemon-reload
sudo systemctl enable zylora-api zylora-backup.timer
# restart (bukan `enable --now`): bila service sudah jalan, `--now` TIDAK
# me-restart, jadi kode baru tak ter-reload → "deploy tak tampak berubah".
sudo systemctl restart zylora-api
sudo systemctl start zylora-backup.timer
sleep 2
sudo systemctl --no-pager --lines=8 status zylora-api || true

# 5. (Opsional) Nginx + TLS otomatis bila ZYLORA_DOMAIN di-set. Tanpa itu,
#    langkah ini dilewati (API tetap hanya di 127.0.0.1:5181 — pasang proxy manual).
if [ -n "${ZYLORA_DOMAIN:-}" ]; then
  echo "  → Nginx reverse-proxy untuk $ZYLORA_DOMAIN ..."
  command -v nginx >/dev/null 2>&1 || sudo apt-get install -y nginx
  sudo tee /etc/nginx/sites-available/zylora >/dev/null <<NGINX
server {
    listen 80;
    server_name $ZYLORA_DOMAIN;
    location / {
        proxy_pass http://127.0.0.1:5181;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 1h;
    }
}
NGINX
  sudo ln -sf /etc/nginx/sites-available/zylora /etc/nginx/sites-enabled/zylora
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl reload nginx

  # TLS Let's Encrypt otomatis bila email disediakan (certbot --nginx).
  if [ -n "${ZYLORA_LE_EMAIL:-}" ]; then
    echo "  → TLS Let's Encrypt (certbot) untuk $ZYLORA_DOMAIN ..."
    command -v certbot >/dev/null 2>&1 || sudo apt-get install -y certbot python3-certbot-nginx
    sudo certbot --nginx -d "$ZYLORA_DOMAIN" --non-interactive --agree-tos \
      -m "$ZYLORA_LE_EMAIL" --redirect || echo "  ⚠ certbot gagal — jalankan manual: sudo certbot --nginx -d $ZYLORA_DOMAIN"
  else
    echo "  ℹ TLS dilewati (ZYLORA_LE_EMAIL tak di-set). Jalankan: sudo certbot --nginx -d $ZYLORA_DOMAIN"
  fi
else
  echo "  ℹ Nginx/TLS dilewati (ZYLORA_DOMAIN tak di-set)."
fi
