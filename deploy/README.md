# Deploy Zylora — API ke EC2 + Frontend ke URL API

Backend Zylora **zero-dependency** (node:http + node:sqlite). Deploy = salin
`server/api`, pasang Node 22+, jalankan sebagai systemd service. Tidak ada
`npm install` di server.

## Arsitektur produksi

```
[ App Karyawan (dist-employee) ]   [ Sistem Kontrol (dist-control) ]   ← 2 situs statis
            \                              /                              (domain berbeda)
             \________ HTTPS REST _________/
                          |
                 [ EC2: zylora-api (systemd) ]  127.0.0.1:5181  ← di balik nginx + TLS
                          |
                 [ SQLite /opt/zylora/data ]    ← sumber kebenaran
```

## 1. Deploy API ke EC2

Prasyarat: letakkan kunci SSH di `~/.ssh/zylora-api-key.pem` (`chmod 600`).

```bash
# dari root proyek
export ZYLORA_SECRET=$(openssl rand -hex 32)         # rahasia JWT produksi (WAJIB)
./deploy/deploy.sh                                    # default host ec2-13-218-74-178, user ubuntu
```

Override bila perlu: `ZYLORA_SSH_KEY`, `ZYLORA_EC2_HOST`, `ZYLORA_EC2_USER`, `ZYLORA_REMOTE_DIR`.

Skrip akan: cek SSH → salin `server/api` (kecuali `data/`) → pasang Node 22 (NodeSource)
→ tulis `/etc/zylora.env` → pasang & start service `zylora-api` → cek `/health`.

DB **tidak** ikut tersalin (di-exclude), jadi data di server aman tiap re-deploy.

## 2. Ekspos publik (HTTPS)

Service bind `127.0.0.1:5181` (tidak langsung publik). Pasang nginx + TLS:

```bash
# di EC2
sudo cp /opt/zylora/nginx-zylora.conf.example /etc/nginx/sites-available/zylora
sudo nano /etc/nginx/sites-available/zylora        # ganti server_name
sudo ln -s /etc/nginx/sites-available/zylora /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.domain-anda.com         # TLS gratis
```

Security group EC2: buka **80/443** ke publik, JANGAN buka 5181.

> Untuk uji cepat tanpa nginx: set `ZYLORA_HOST=0.0.0.0` di `/etc/zylora.env`,
> `sudo systemctl restart zylora-api`, dan buka 5181 di security group (sementara).

## 3. Build frontend menunjuk ke API EC2

```bash
VITE_API_URL=https://api.domain-anda.com ./deploy/build-frontends.sh
# → dist-employee/ dan dist-control/  (host sebagai dua situs statis terpisah)
```

## Operasional

```bash
# log realtime
ssh -i ~/.ssh/zylora-api-key.pem ubuntu@<host> 'journalctl -u zylora-api -f'
# restart / status
ssh ... 'sudo systemctl restart zylora-api'
ssh ... 'systemctl status zylora-api'
```

## Catatan keamanan

- `ZYLORA_SECRET` WAJIB di-set (jangan pakai fallback dev). Disimpan di `/etc/zylora.env` (mode 600).
- CORS backend masih `*` — pertimbangkan membatasi ke origin frontend (di `server/api/lib/http.mjs` atau di nginx).
- Pertimbangkan migrasi SQLite → PostgreSQL bila skala/konkruensi menuntut (skema sudah relasional).
