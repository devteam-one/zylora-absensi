#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy KEYLESS via EC2 Instance Connect — TANPA file .pem.
# Butuh kredensial AWS admin yang valid (mis. profil SSO yang sudah `aws sso login`)
# dengan izin ec2-instance-connect:SendSSHPublicKey + ec2:DescribeInstances.
#
# Cara: push public-key ephemeral (berlaku 60 dtk) → buka SATU koneksi SSH
# ControlMaster yang persisten dalam jendela itu → jalankan deploy.sh memakai
# koneksi itu (semua langkah multiplex, tak perlu re-auth meski >60 dtk).
#
#   aws sso login --profile aws-dev
#   AWS_PROFILE=aws-dev ZYLORA_SECRET=$(openssl rand -hex 32) ./deploy/deploy-eic.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REGION="${ZYLORA_REGION:-us-east-1}"
INSTANCE="${ZYLORA_INSTANCE_ID:-i-0a9dab2093cb5f78c}"
HOST="${ZYLORA_EC2_HOST:-13.218.74.178}"
USER="${ZYLORA_EC2_USER:-ubuntu}"
: "${ZYLORA_SECRET:?Set ZYLORA_SECRET, mis: export ZYLORA_SECRET=\$(openssl rand -hex 32)}"
: "${AWS_PROFILE:?Set AWS_PROFILE ke profil admin yang sudah 'aws sso login' (mis. aws-dev)}"
export AWS_PAGER=""

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$HERE"
TMP="$(mktemp -d)"
CM="$TMP/cm.sock"
cleanup() { ssh -O exit -o ControlPath="$CM" "$USER@$HOST" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "[1/4] Cek identitas AWS ..."
aws sts get-caller-identity --query Arn --output text

AZ="$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE" \
  --query 'Reservations[].Instances[].Placement.AvailabilityZone' --output text)"
echo "      instance $INSTANCE @ $AZ ($HOST)"

ssh-keygen -t ed25519 -N "" -f "$TMP/eic" -q -C zylora-eic-ephemeral

echo "[2/4] Push public-key ephemeral (EC2 Instance Connect, 60 dtk) ..."
aws ec2-instance-connect send-ssh-public-key --region "$REGION" \
  --instance-id "$INSTANCE" --instance-os-user "$USER" --availability-zone "$AZ" \
  --ssh-public-key "file://$TMP/eic.pub" >/dev/null

echo "[3/4] Buka koneksi SSH master persisten ..."
ssh -i "$TMP/eic" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 \
    -o ControlMaster=yes -o ControlPath="$CM" -o ControlPersist=600 \
    -fN "$USER@$HOST"
ssh -o ControlPath="$CM" "$USER@$HOST" 'echo "      terhubung: $(whoami)@$(hostname)"'

echo "[4/4] Jalankan deploy.sh lewat koneksi ini ..."
ZYLORA_SSH_KEY="$TMP/eic" \
ZYLORA_SSH_EXTRA="-o ControlPath=$CM" \
ZYLORA_EC2_HOST="$HOST" ZYLORA_EC2_USER="$USER" \
ZYLORA_SECRET="$ZYLORA_SECRET" \
  ./deploy/deploy.sh

echo "✅ Deploy keyless selesai."
