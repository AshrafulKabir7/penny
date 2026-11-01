// In the Chrome extension the overlay talks to Penny's background worker instead of the desktop app's main process.
// This sets up the same `window.penny` interface overlay.js uses there, over a runtime port. Loaded before overlay.js.

const handlers = new Map();
let port = null;

function connect() {
  port = chrome.runtime.connect({ name: "overlay" });
  port.onMessage.addListener(({ type, data }) => emit(type, data));
  // The worker is stopped when idle; the next message reconnects (a new conversation starts then).
  port.onDisconnect.addListener(() => (port = null));
  port.postMessage({ type: "ready", data: { view: [innerWidth, innerHeight] } });
}

function emit(type, data) {
  for (const fn of handlers.get(type) || []) fn(data);
}

function send(type, data) {
  if (!port) connect();
  port.postMessage({ type, data });
}

window.penny = {
  synth: null, // answers are spoken with the browser's own voices
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(fn);
  },
  emit,
  send,
  setInteractive: (on) => parent.postMessage({ penny: "interactive", on }, "*"),
  visuals: (on) => send("visuals", on),
  answerDone: (info) => send("answer-done", info),
  listenResult() {},
  ready: () => port || connect(),
  captureReady: (token) => send("capture-ready", token),
};

// The page forwards the mouse while the overlay lets clicks through; replay it here so the trail and hover work.
addEventListener("message", (e) => {
  if (e.source !== parent || !e.data?.penny) return;
  const { type, x, y } = e.data;
  if (type === "mouse") document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
  else if (type === "scroll" || type === "escape") emit(`page:${type}`, { x, y });
});
