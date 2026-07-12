const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

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
  try {
    return require("./server.js");
  } catch (e) {
    console.error("Local server not available in this build:", e.message);
    return null;
  }
}

let currentUrl = null;
let mainWin = null;
let manualOverride = false;
let currentGame = null;

// Map of running process image names -> activity shown to friends.
const GAME_MAP = {
  "fortniteclient-win64-shipping.exe": "Fortnite",
  "fortniteclient-win32-shipping.exe": "Fortnite",
  "valorant.exe": "Valorant",
  "leagueclient.exe": "League of Legends",
  "league of legends.exe": "League of Legends",
  "cs2.exe": "Counter-Strike 2",
  "csgo.exe": "Counter-Strike",
  "r5apex.exe": "Apex Legends",
  "robloxplayerbeta.exe": "Roblox",
  "rocketleague.exe": "Rocket League",
  "gta5.exe": "Grand Theft Auto V",
  "gtav.exe": "Grand Theft Auto V",
  "eldenring.exe": "Elden Ring",
  "overwatch.exe": "Overwatch 2",
  "overwatch2.exe": "Overwatch 2",
  "destiny2.exe": "Destiny 2",
  "mw2.exe": "Call of Duty",
  "modernwarfare.exe": "Call of Duty",
  "cod.exe": "Call of Duty",
  "wow.exe": "World of Warcraft",
  "wowclassic.exe": "World of Warcraft",
  "dota2.exe": "Dota 2",
  "deadbydaylight.exe": "Dead by Daylight",
  "eaapp.exe": "EA App",
};

function scanGames() {
  if (!mainWin || mainWin.isDestroyed() || manualOverride) return;
  execFile("tasklist", ["/fo", "csv", "/nh"], { windowsHide: true, maxBuffer: 1024 * 1024 }, (err, out) => {
    if (err || !out) return;
    const found = new Set();
    out.split(/\r?\n/).forEach((line) => {
      const m = line.match(/"([^"]+)\.exe"/i);
      if (!m) return;
      const base = m[1].toLowerCase() + ".exe";
      if (GAME_MAP[base]) found.add(GAME_MAP[base]);
    });
    const name = found.size ? [...found][0] : null;
    if (name !== currentGame) {
      currentGame = name;
      try { mainWin.webContents.send("buddy:game", name ? { type: "playing", name } : null); } catch {}
    }
  });
}

ipcMain.on("buddy:manual", (_e, on) => { manualOverride = !!on; if (!manualOverride) scanGames(); });

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
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWin = win;

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
  scanGames();
  setInterval(scanGames, 8000);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
