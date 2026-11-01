// The overlay's only door to the main process.

const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = ["listen:start", "listen:stop", "listen:cancel", "heard", "answer:start", "answer:space", "answer:delta", "answer:end", "answer:error",
  "status", "stage:clear", "settings", "ops:play", "capture:prepare", "capture:done"];

contextBridge.exposeInMainWorld("talky", {
  on(channel, fn) {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, payload) => fn(payload));
  },
  ready: () => ipcRenderer.send("overlay:ready"),
  setInteractive: (on) => ipcRenderer.send("overlay:interactive", !!on),
  visuals: (on) => ipcRenderer.send("overlay:visuals", !!on),
  answerDone: (info) => ipcRenderer.send("answer:done", info),
  listenResult: (payload) => ipcRenderer.send("listen:result", payload),
  synth: (text) => ipcRenderer.invoke("tts:synth", String(text)),
  captureReady: (token) => ipcRenderer.send("capture:ready", String(token)),
});
