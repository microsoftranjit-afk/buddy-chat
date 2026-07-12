const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("buddyDesktop", {
  subscribeGame: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on("buddy:game", (_e, game) => cb(game));
  },
  setManualOverride: (on) => {
    ipcRenderer.send("buddy:manual", !!on);
  },
  saveLogin: (d) => {
    ipcRenderer.send("buddy:save-login", d || {});
  },
  loadLogin: () => {
    return ipcRenderer.invoke("buddy:load-login");
  },
  onUpdateAvailable: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on("buddy:update-available", (_e, v) => cb(v));
  },
  onUpdateChecking: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on("buddy:update-checking", () => cb());
  },
  onUpdateLatest: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on("buddy:update-latest", () => cb());
  },
  onUpdateProgress: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on("buddy:update-progress", (_e, p) => cb(p));
  },
  onUpdateDownloaded: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on("buddy:update-downloaded", () => cb());
  },
  onUpdateError: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on("buddy:update-error", (_e, m) => cb(m));
  },
  startUpdateDownload: () => {
    ipcRenderer.send("buddy:update-download");
  },
  installUpdate: () => {
    ipcRenderer.send("buddy:update-install");
  },
  checkForUpdates: () => {
    ipcRenderer.send("buddy:check-updates");
  },
  appVersion: () => {
    return ipcRenderer.invoke("buddy:app-version");
  },
});
