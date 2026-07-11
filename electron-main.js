const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

const PORT = process.env.PORT || 45900;
const LOCAL_URL = "http://127.0.0.1:" + PORT;

// Start the bundled chat server inside the app so the desktop client is fully
// self-contained (no external server required). Data/uploads go to userData so
// they survive restarts and stay writable inside the installed app.
function startLocalServer() {
  process.env.PORT = String(PORT);
  process.env.DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.UPLOAD_DIR = path.join(app.getPath("userData"), "uploads");
  return require("./server.js");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#1e1f22",
    title: "Buddy",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const serverUrl = process.env.ELECTRON_SERVER_URL || LOCAL_URL;
  win.loadURL(serverUrl);

  win.on("did-fail-load", () => {
    win.loadURL(
      "data:text/html," +
        encodeURIComponent(
          "<body style='font-family:sans-serif;background:#1e1f22;color:#dbdee1;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>" +
          "<div style='text-align:center;max-width:420px'>" +
          "<h2>Can't reach the server</h2>" +
          "<p>Make sure you're online and the Buddy server is running, then restart the app.</p>" +
          "<p style='color:#949ba4;font-size:13px'>" + serverUrl + "</p>" +
          "</div></body>"
        )
    );
  });
}

app.whenReady().then(() => {
  const srv = startLocalServer();
  const open = () => createWindow();
  if (srv && srv.server && srv.server.listening) open();
  else if (srv && srv.server) srv.server.once("listening", open);
  else open();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
