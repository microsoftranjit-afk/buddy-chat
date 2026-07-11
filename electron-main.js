const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

// Default backend. Override with ELECTRON_SERVER_URL (env) or serverUrl (config.json).
const DEFAULT_SERVER_URL = "https://buddy-chat-bd6c.onrender.com";

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

function resolveServerUrl() {
  if (process.env.ELECTRON_SERVER_URL) return process.env.ELECTRON_SERVER_URL;
  const cfg = loadConfig();
  if (cfg && cfg.serverUrl) return cfg.serverUrl;
  return DEFAULT_SERVER_URL;
}

// Optional: run the bundled server locally (offline / dev). Set BUDDY_LOCAL=1.
function startLocalServer() {
  process.env.PORT = String(process.env.PORT || 45900);
  process.env.DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.UPLOAD_DIR = path.join(app.getPath("userData"), "uploads");
  return require("./server.js");
}

let currentUrl = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#1e1f22",
    title: "Buddy",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(currentUrl);

  win.on("did-fail-load", () => {
    win.loadURL(
      "data:text/html," +
        encodeURIComponent(
          "<body style='font-family:sans-serif;background:#1e1f22;color:#dbdee1;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>" +
          "<div style='text-align:center;max-width:420px'>" +
          "<h2>Can't reach the server</h2>" +
          "<p>Make sure you're online and the Buddy server is running, then restart the app.</p>" +
          "<p style='color:#949ba4;font-size:13px'>" + currentUrl + "</p>" +
          "</div></body>"
        )
    );
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (process.env.BUDDY_LOCAL === "1") {
    const srv = startLocalServer();
    currentUrl = "http://127.0.0.1:" + (process.env.PORT || 45900);
    const open = () => createWindow();
    if (srv && srv.server && srv.server.listening) open();
    else if (srv && srv.server) srv.server.once("listening", open);
    else open();
  } else {
    currentUrl = resolveServerUrl();
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
