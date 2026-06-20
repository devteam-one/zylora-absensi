// ─────────────────────────────────────────────────────────────────────────────
// Sync relay for the 2-port build of "Absensi Digital dengan QR-Code".
//
// The single-port prototype fakes "real-time sync" by sharing React state inside
// one tab. When the app is split into TWO real servers (employee :5173 and admin
// :5174) they become two separate origins, so localStorage/BroadcastChannel can no
// longer bridge them. This tiny relay is that bridge: it keeps the latest full app
// snapshot ({ systemMode, attendance, leaveRequests }) and broadcasts every change
// to all connected clients over Server-Sent Events — so a check-in on :5173 shows
// up instantly on the admin dashboard at :5174.
//
// Built on node:http only (no deps) to sidestep the install/network constraints
// documented in .design-sync/NOTES.md.
// ─────────────────────────────────────────────────────────────────────────────
import http from "node:http";

const PORT = Number(process.env.SYNC_PORT) || 5180;
// 127.0.0.2 is a free loopback alias — keeps us off 127.0.0.1 where another
// project already runs on :5173/:5174.
const HOST = process.env.SYNC_HOST || "127.0.0.2";

let snapshot = null; // latest full app state (as posted by a client)
const clients = new Set(); // open SSE responses

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // SSE stream — clients subscribe here to receive every broadcast.
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    // Hand the newcomer the current state immediately so a late-joining admin
    // sees check-ins that already happened.
    if (snapshot) res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    clients.add(res);
    const ping = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* closed */ }
    }, 25000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  // A client posts a new full snapshot; we store it and fan it out to everyone.
  if (req.method === "POST" && req.url === "/update") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 5_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        snapshot = JSON.parse(body);
        const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
        for (const c of clients) {
          try { c.write(payload); } catch { /* dropped */ }
        }
        res.writeHead(204, CORS);
        res.end();
      } catch {
        res.writeHead(400, CORS);
        res.end("bad json");
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: clients.size, hasSnapshot: !!snapshot }));
    return;
  }

  res.writeHead(404, CORS);
  res.end("not found");
});

server.on("error", (err) => {
  console.error(`[sync] server error: ${err.code || err.message}`);
  if (err.code === "EADDRNOTAVAIL" || err.code === "EADDRINUSE") {
    console.error(`[sync] could not bind ${HOST}:${PORT} — set SYNC_HOST/SYNC_PORT.`);
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[sync] SSE relay listening on http://${HOST}:${PORT}`);
});
