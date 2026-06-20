#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy Zylora API → EC2 (Ubuntu). Zero-dependency: hanya menyalin server/api,
# memasang Node 22+ (butuh node:sqlite), dan menjalankannya sebagai systemd
# service. Jalankan dari ROOT proyek:  ./deploy/deploy.sh
#
# Override via env:
#   ZYLORA_SSH_KEY   path .pem            (default ~/.ssh/zylora-api-key.pem)
#   ZYLORA_EC2_HOST  host EC2             (default ec2-13-218-74-178.compute-1.amazonaws.com)
#   ZYLORA_EC2_USER  user SSH             (default ubuntu)
#   ZYLORA_REMOTE_DIR direktori app       (default /opt/zylora)
#   ZYLORA_SECRET    WAJIB: rahasia JWT kuat (mis. $(openssl rand -hex 32))
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

KEY="${ZYLORA_SSH_KEY:-$HOME/.ssh/zylora-api-key.pem}"
HOST="${ZYLORA_EC2_HOST:-ec2-13-218-74-178.compute-1.amazonaws.com}"
USER="${ZYLORA_EC2_USER:-ubuntu}"
REMOTE_DIR="${ZYLORA_REMOTE_DIR:-/opt/zylora}"
SECRET="${ZYLORA_SECRET:?Set ZYLORA_SECRET ke rahasia kuat dulu, mis: export ZYLORA_SECRET=\$(openssl rand -hex 32)}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"  # root proyek
cd "$HERE"

if [ ! -f "$KEY" ]; then
  echo "❌ Key SSH tidak ditemukan: $KEY"
  echo "   Letakkan zylora-api-key.pem di sana (chmod 600), atau set ZYLORA_SSH_KEY."
  exit 1
fi
chmod 600 "$KEY" 2>/dev/null || true

# ZYLORA_SSH_EXTRA: opsi SSH tambahan (mis. -o ControlPath=... dari deploy-eic.sh,
# agar semua langkah memakai satu koneksi persisten — penting untuk key EIC 60 dtk).
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 ${ZYLORA_SSH_EXTRA:-}"
TARGET="$USER@$HOST"

echo "[1/5] Cek koneksi SSH ke $TARGET ..."
$SSH "$TARGET" "echo connected as \$(whoami) on \$(hostname)"

echo "[2/5] Menyiapkan direktori remote $REMOTE_DIR ..."
$SSH "$TARGET" "sudo mkdir -p '$REMOTE_DIR' && sudo chown \$(whoami):\$(whoami) '$REMOTE_DIR'"

echo "[3/5] Menyalin backend (server/api, tanpa data/) + berkas deploy ..."
rsync -az --delete -e "$SSH" --exclude 'data/' \
  server/api/ "$TARGET:$REMOTE_DIR/api/"
rsync -az -e "$SSH" \
  deploy/setup-remote.sh deploy/zylora-api.service "$TARGET:$REMOTE_DIR/"

echo "[4/5] Setup Node + systemd service di remote ..."
$SSH "$TARGET" "ZYLORA_SECRET='$SECRET' REMOTE_DIR='$REMOTE_DIR' bash '$REMOTE_DIR/setup-remote.sh'"

echo "[5/5] Verifikasi health (lokal di EC2) ..."
$SSH "$TARGET" "curl -sf http://127.0.0.1:5181/health && echo"

echo "✅ Deploy selesai. API berjalan sebagai service 'zylora-api' di $HOST (port 5181, bind 127.0.0.1)."
echo "   Lihat log:  $SSH $TARGET 'journalctl -u zylora-api -f'"
echo "   Ekspos publik: pasang nginx (deploy/nginx-zylora.conf.example) + TLS, atau buka port via security group."
