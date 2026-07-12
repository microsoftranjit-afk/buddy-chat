const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("buddyDesktop", {
  subscribeGame: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on("buddy:game", (_e, game) => cb(game));
  },
  setManualOverride: (on) => {
    ipcRenderer.send("buddy:manual", !!on);
  },
});
