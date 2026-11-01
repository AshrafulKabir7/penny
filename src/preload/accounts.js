// The Accounts window's door to the main process. Keys go in; only masked hints ever come back.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("accounts", {
  state: () => ipcRenderer.invoke("accounts:state"),
  saveKey: (provider, key) => ipcRenderer.invoke("accounts:save-key", String(provider), String(key)),
  removeKey: (provider) => ipcRenderer.invoke("accounts:remove-key", String(provider)),
  test: (provider) => ipcRenderer.invoke("accounts:test", String(provider)),
  codexLogin: () => ipcRenderer.invoke("accounts:codex-login"),
  claudeLogin: () => ipcRenderer.invoke("accounts:claude-login"),
  googleLogin: () => ipcRenderer.invoke("accounts:google-login"),
  use: (modelId) => ipcRenderer.invoke("accounts:use", String(modelId)),
  open: (url) => ipcRenderer.send("accounts:open", String(url)),
  onChanged: (fn) => ipcRenderer.on("accounts:changed", () => fn()),
});
