// ─────────────────────────────────────────────────────────────────────────────
// Registrasi admin + perusahaan via SHELL — zero-dependency (node:sqlite).
//
// Self-register lewat web console SUDAH DIHAPUS (lihat auth.routes.mjs): akun
// Sistem Kontrol HANYA bisa dibuat lewat perintah shell ini, langsung di server
// yang memegang DB produksi. Logika identik dengan endpoint /api/control/register
// yang lama (hash scrypt, id ber-prefix, transaksi atomik).
//
// Pakai (di server, dgn DB & secret produksi):
//   ZYLORA_DB=/opt/zylora/data/zylora.db \
//   node /opt/zylora/api/tools/register-admin.mjs \
//     --name "Nama Admin" --email admin@perusahaan.id \
//     --password 'RahasiaKuat' --company "PT Perusahaan" [--address "Alamat"]
//
// Keluar 0 + cetak {adminId, companyId} bila sukses; keluar 1 + pesan bila gagal.
// ─────────────────────────────────────────────────────────────────────────────
import { get, run, tx } from "../lib/db.mjs";
import { genId, hashPassword, nowISO } from "../lib/security.mjs";

// Parser argumen sederhana: --key value  (juga dukung --key=value).
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); }
    else { out[a.slice(2)] = argv[++i]; }
  }
  return out;
}

function fail(msg) {
  console.error("✗ " + msg);
  console.error('Pakai: node tools/register-admin.mjs --name "Nama" --email a@b.id --password "min8char" --company "PT X" [--address "..."]');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const name = (args.name || "").trim();
const email = (args.email || "").trim().toLowerCase();
const password = String(args.password || "");
const company = (args.company || args.company_name || "").trim();
const address = (args.address || "").trim() || null;

// Validasi sama seperti endpoint lama.
if (!name || !email || !password || !company) fail("Wajib: --name, --email, --password, --company");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Format email tidak valid");
if (password.length < 8) fail("Password minimal 8 karakter");
if (get("SELECT 1 FROM admins WHERE email = ?", email)) fail("Email sudah terdaftar: " + email);

const adminId = genId("adm");
const companyId = genId("co");
tx(() => {
  run(
    "INSERT INTO companies (id, name, address, contact_email, created_at) VALUES (?,?,?,?,?)",
    companyId, company, address, email, nowISO(),
  );
  run(
    "INSERT INTO admins (id, company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)",
    adminId, companyId, name, email, hashPassword(password), "control", nowISO(),
  );
});

console.log("✓ Admin Sistem Kontrol dibuat.");
console.log(JSON.stringify({ adminId, companyId, email, company }, null, 2));
process.exit(0);
