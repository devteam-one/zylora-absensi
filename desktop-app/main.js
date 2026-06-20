// Electron main — membungkus frontend "Sistem Kontrol" (dist-control) jadi
// aplikasi desktop. Memuat aset yang sudah di-bundle (offline UI); data diambil
// dari REST API Zylora (VITE_API_URL di-bake saat build web).
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: "Zylora Sistem Kontrol",
    backgroundColor: "#0D1B2A",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "www", "index.html"));
  // Link eksternal dibuka di browser, bukan di dalam app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
