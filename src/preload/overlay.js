// The overlay's only door to the main process.

const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = ["listen:start", "listen:stop", "listen:cancel", "listen:hold", "answer:pointer", "heard", "answer:start", "answer:space", "answer:delta", "answer:end", "answer:error",
  "status", "stage:clear", "settings", "ops:play", "capture:prepare", "capture:done"];

contextBridge.exposeInMainWorld("penny", {
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
  // A 3D copy of the object in part of the last screenshot (Idol); resolves with the .ply bytes.
  sculpt: async (req) => {
    const res = await ipcRenderer.invoke("idol:sculpt", req);
    if (res.error) throw new Error(res.error);
    return res.bytes;
  },
});
