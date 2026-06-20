// ─────────────────────────────────────────────────────────────────────────────
// Util HTTP minimalis di atas node:http — router pola ":param", pembaca body
// JSON, dan helper respons. Sengaja kecil; menggantikan Express tanpa dependency.
// ─────────────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── Helper respons ──────────────────────────────────────────────────────────
export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...CORS, "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

export function noContent(res) {
  res.writeHead(204, CORS);
  res.end();
}

// Error berbentuk konsisten: { error: { code, message } }.
export function fail(res, status, message, code = "ERROR") {
  json(res, status, { error: { code, message } });
}

// ApiError dilempar dari handler/middleware; ditangkap router → respons rapi.
export class ApiError extends Error {
  constructor(status, message, code = "ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ─── Pembaca body ────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 5_000_000) {
        reject(new ApiError(413, "Payload terlalu besar", "PAYLOAD_TOO_LARGE"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, "Body bukan JSON valid", "BAD_JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────
// Pola "/api/employees/:id". Handler & middleware: async (ctx) => void.
// Handler memanggil helper respons sendiri; setelah respons terkirim, sisa
// rantai dilewati (cek res.writableEnded).
export function Router() {
  const routes = []; // { method, segments, handlers }

  function add(method, pattern, ...handlers) {
    const segments = pattern.split("/").filter(Boolean);
    routes.push({ method, segments, handlers });
    return api;
  }

  function match(method, path) {
    const parts = path.split("?")[0].split("/").filter(Boolean);
    for (const r of routes) {
      if (r.method !== method) continue;
      if (r.segments.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < r.segments.length; i++) {
        const seg = r.segments[i];
        if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(parts[i]);
        else if (seg !== parts[i]) { ok = false; break; }
      }
      if (ok) return { route: r, params };
    }
    return null;
  }

  async function handle(req, res) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    const query = Object.fromEntries(url.searchParams.entries());

    const found = match(req.method, path);
    if (!found) return fail(res, 404, `Rute tidak ditemukan: ${req.method} ${path}`, "NOT_FOUND");

    const ctx = {
      req,
      res,
      params: found.params,
      query,
      body: {},
      auth: null, // diisi middleware auth
      ip: req.socket?.remoteAddress || "",
    };

    try {
      if (req.method === "POST" || req.method === "PUT") {
        ctx.body = await readBody(req);
      }
      for (const fn of found.route.handlers) {
        await fn(ctx);
        if (res.writableEnded) break; // respons sudah dikirim → stop
      }
      if (!res.writableEnded) {
        fail(res, 500, "Handler tidak mengembalikan respons", "NO_RESPONSE");
      }
    } catch (err) {
      if (res.writableEnded) return;
      if (err instanceof ApiError) return fail(res, err.status, err.message, err.code);
      console.error("[api] unhandled error:", err);
      fail(res, 500, "Kesalahan server internal", "INTERNAL");
    }
  }

  const api = {
    add,
    get: (p, ...h) => add("GET", p, ...h),
    post: (p, ...h) => add("POST", p, ...h),
    put: (p, ...h) => add("PUT", p, ...h),
    delete: (p, ...h) => add("DELETE", p, ...h),
    handle,
  };
  return api;
}
