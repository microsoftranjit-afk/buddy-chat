const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

function loadConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "config.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Server URL = env override > config.json > fallback.
const SERVER_URL =
  process.env.ELECTRON_SERVER_URL ||
  loadConfig().serverUrl ||
  "https://buddy-chat-bd6c.onrender.com";

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#1e1f22",
    title: "Buddy",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(SERVER_URL);

  win.on("did-fail-load", () => {
    win.loadURL(
      "data:text/html," +
        encodeURIComponent(
          "<body style='font-family:sans-serif;background:#1e1f22;color:#dbdee1;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>" +
          "<div style='text-align:center;max-width:420px'>" +
          "<h2>Can't reach the server</h2>" +
          "<p>Make sure you're online and the Buddy server is running, then restart the app.</p>" +
          "<p style='color:#949ba4;font-size:13px'>" + SERVER_URL + "</p>" +
          "</div></body>"
        )
    );
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
