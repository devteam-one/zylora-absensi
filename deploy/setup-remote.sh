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

# 2. Direktori data persisten (DB SQLite). DB tidak ikut tersalin (di-exclude),
#    jadi data di server tidak tertimpa tiap deploy.
mkdir -p "$REMOTE_DIR/data"

# 3. Env file (rahasia, mode 600).
sudo tee /etc/zylora.env >/dev/null <<EOF
ZYLORA_SECRET=$SECRET
ZYLORA_HOST=127.0.0.1
ZYLORA_PORT=5181
ZYLORA_DB=$REMOTE_DIR/data/zylora.db
EOF
sudo chmod 600 /etc/zylora.env

# 4. systemd service (substitusi placeholder).
sudo cp "$REMOTE_DIR/zylora-api.service" /etc/systemd/system/zylora-api.service
sudo sed -i "s#__REMOTE_DIR__#$REMOTE_DIR#g; s#__USER__#$RUN_USER#g" /etc/systemd/system/zylora-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now zylora-api
sleep 2
sudo systemctl --no-pager --lines=8 status zylora-api || true
