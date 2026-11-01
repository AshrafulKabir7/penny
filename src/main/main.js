// Talky's main process: the overlay window, hotkeys, tray, and the loop from question to drawn answer.

const { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, session, shell, Tray } = require("electron");
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { join } = require("node:path");
const settings = require("./settings");
const { captureScreen, activeDisplay, markPointer } = require("./capture");
const { PointerTracker, POINTING, toImage } = require("./pointer");
const { createProvider, discoverModels, SUGGESTED, parseModelId } = require("./providers");
const { VoiceWorker } = require("./voice");
const { trayIconPng } = require("./icon");

const DEV = process.argv.includes("--dev");
const FOLLOW_UP_MS = 5 * 60_000;
const WAKE = /^\W*(?:hey|hi|hay|ok|okay|a)[\s,.!]+(?:talky|talkie|talki|tokey|toki|tacky|turkey|taki|talk he|talk e)\b[\s,.!?]*/i;

let cfg;
let overlay = null;
let askWin = null;
let tray = null;
let provider = null;
let voice = null;
let overlayReady = false;
let listening = false;
let pendingShot = null;
let askSeq = 0;
let currentAsk = null;
let answering = false;
let visualsOnScreen = false;
let lastAnswerAt = 0;
let extraModels = [];
let wakeLoopOn = false;
const pointer = new PointerTracker();
let pointerAt = null; // where the user pointed while asking (screen DIP)

const logFile = () => join(app.getPath("userData"), "talky.log");
function log(line) {
  const text = `${new Date().toISOString().slice(11, 19)} ${line}`;
  console.log(text);
  try {
    appendFileSync(logFile(), `${text}\n`);
  } catch {}
}

/** In --dev runs, every question's screenshot and raw reply are kept in <userData>/debug for tuning the prompt. */
function saveDebug(shot, question, reply) {
  try {
    const dir = join(app.getPath("userData"), "debug");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(join(dir, `${stamp}.jpg`), shot.jpeg);
    writeFileSync(join(dir, `${stamp}.jsonl`), `// ${question}\n${reply}`);
  } catch {}
}

function send(channel, payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

function status(state, text, hideAfter) {
  send("status", { state, text, hideAfter });
}

// ---------------------------------------------------------------- windows

function createOverlay() {
  const display = activeDisplay();
  const b = display.bounds;
  overlay = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: join(__dirname, "..", "preload", "overlay.js"), contextIsolation: true, backgroundThrottling: false },
  });
  overlay.__displayId = display.id;
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setIgnoreMouseEvents(true, { forward: true });
  applyContentProtection();
  overlay.loadFile(join(__dirname, "..", "renderer", "overlay.html"));
  overlay.once("ready-to-show", () => overlay.showInactive());
  overlay.on("closed", () => (overlay = null));
}

function applyContentProtection() {
  if (!overlay) return;
  overlay.setContentProtection(!!cfg.hideFromCapture);
  overlay.__contentProtected = !!cfg.hideFromCapture;
}

/** The overlay covers the display the user is working on; it moves there (and wipes) when they switch screens. */
function followDisplay() {
  const display = activeDisplay();
  if (!overlay || overlay.__displayId === display.id) return;
  overlay.__displayId = display.id;
  overlay.setBounds(display.bounds);
  send("stage:clear");
}

function createAskWindow() {
  askWin = new BrowserWindow({
    width: 680,
    height: 66,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: join(__dirname, "..", "preload", "ask.js"), contextIsolation: true },
  });
  askWin.setAlwaysOnTop(true, "screen-saver");
  askWin.loadFile(join(__dirname, "..", "renderer", "ask.html"));
  askWin.on("blur", () => askWin?.hide());
  askWin.on("closed", () => (askWin = null));
}

// ---------------------------------------------------------------- model

function startProvider() {
  provider?.dispose();
  const parsed = parseModelId(cfg.model);
  provider = createProvider(cfg.model, log);
  if (provider.effort !== undefined) provider.effort = cfg.effort;
  log(`[model] ${provider.label}`);
  const started = Date.now();
  Promise.resolve(provider.warm())
    .then(() => {
      if (overlayReady) status("idle", `Talky is ready · ${hotkeyLabel(keys.talk)} to talk`, 3500);
      log(`[model] warm after ${((Date.now() - started) / 1000).toFixed(1)}s`);
    })
    .catch((err) => {
      log(`[model] failed to start: ${err.message}`);
      status("error", friendlyError(err, parsed), 8000);
    });
}

function friendlyError(err, parsed = parseModelId(cfg.model)) {
  const m = String(err?.message || err);
  const cli = parsed?.kind === "agy" ? "Antigravity" : "Command Code";
  if (/MODEL_NOT_IN_PLAN|not in (your )?plan/i.test(m)) return `${parsed?.model} is not on your ${cli} plan. Pick another model in the tray menu.`;
  if (/ENOENT|not recognized|cannot find/i.test(m)) return `${cli} CLI not found. Install it and sign in, then restart Talky.`;
  if (/401|unauthori[sz]ed|not logged in|login/i.test(m)) return parsed?.kind === "agy" ? "Sign in to Antigravity (run agy once)." : "Sign in to Command Code: command-code logout, then command-code login.";
  if (/stopped|exited/i.test(m)) return `${cli} stopped. Ask again to restart it.`;
  return m.length > 140 ? `${m.slice(0, 140)}…` : m;
}

async function ask(question, shotPromise, pointedAt = null) {
  question = String(question || "").trim();
  if (!question) return;
  const id = ++askSeq;
  if (answering) provider.cancel();
  answering = true;
  setWake(false);
  send("answer:start", { question });
  const previous = currentAsk;
  let settle;
  currentAsk = new Promise((r) => (settle = r));
  try {
    // A cancelled turn has to wind down before the same session can take the next one.
    if (previous) await Promise.race([previous, new Promise((r) => setTimeout(r, 4000))]);
    let shot = await shotPromise;
    if (id !== askSeq) return;
    send("answer:space", { w: shot.imageWidth, h: shot.imageHeight });
    shot = withPointer(shot, pointedAt, question);
    send("answer:pointer", shot.pointer);
    const followUp = visualsOnScreen || Date.now() - lastAnswerAt < FOLLOW_UP_MS;
    if (!followUp && provider.turns > 0) await provider.newTopic();
    const started = Date.now();
    let first = 0;
    log(`[ask] "${question}" (${followUp ? "follow-up" : "new topic"}, ${provider.label})`);
    const res = await provider.ask({
      question,
      shot,
      visualsOnScreen,
      onDelta: (text) => {
        if (id !== askSeq) return;
        if (!first) first = Date.now() - started;
        send("answer:delta", text);
      },
    });
    if (id !== askSeq) return;
    log(`[ask] first words after ${(first / 1000).toFixed(1)}s, done after ${((Date.now() - started) / 1000).toFixed(1)}s, ${res.text.length} chars`);
    if (DEV) saveDebug(shot, question, res.text);
    send("answer:end");
    lastAnswerAt = Date.now();
  } catch (err) {
    if (err.cancelled || id !== askSeq) return;
    log(`[ask] failed: ${err.message}`);
    send("answer:error", { message: friendlyError(err) });
    answering = false;
    setWake(true);
  } finally {
    settle();
    if (currentAsk && id === askSeq) currentAsk = null;
  }
}

// ---------------------------------------------------------------- talking

/** Captures the screen for the model with Talky's drawings hidden for that moment (the status pill stays). */
function shoot() {
  const started = Date.now();
  const shot = captureScreen({ hideDrawings: visualsOnScreen ? hideDrawings : null });
  shot.then((r) => log(`[capture] ${r.imageWidth}x${r.imageHeight} in ${Date.now() - started} ms`), (err) => log(`[capture] ${err.message}`));
  return shot;
}

/**
 * Adds where the user pointed. When the question says "this"/"here", the pointer is ringed on the screenshot and a
 * close-up of that spot goes along, and the overlay snaps nearby marks onto it.
 */
function withPointer(shot, pointedAt, question) {
  const pt = toImage(pointedAt, shot);
  if (!pt) return { ...shot, pointer: null };
  const meant = POINTING.test(question);
  if (!meant) return { ...shot, pointer: { ...pt, meant } };
  try {
    const marked = markPointer(shot, pt);
    log(`[pointer] "${question}" points at ${pt.x},${pt.y}`);
    return { ...shot, jpeg: marked.jpeg, closeup: marked.closeup, closeupBox: marked.closeupBox, pointer: { ...pt, meant } };
  } catch (err) {
    log(`[pointer] ${err.message}`);
    return { ...shot, pointer: { ...pt, meant } };
  }
}

const captureWaits = new Map();
function hideDrawings() {
  if (!overlay || overlay.__contentProtected) return Promise.resolve(null);
  return new Promise((resolve) => {
    const token = String(Math.random()).slice(2);
    const done = () => {
      captureWaits.delete(token);
      resolve(() => send("capture:done"));
    };
    captureWaits.set(token, done);
    setTimeout(() => captureWaits.get(token)?.(), 300);
    send("capture:prepare", { token });
  });
}

// The talk key: a tap starts listening (which ends by itself when you pause, or with another tap), and holding it is
// push-to-talk. Windows repeats a held hotkey about 30 times a second, so while listening, any further event means
// "held (or tapped again)" and listening stops once the events go quiet. Timing alone is not enough: a screen capture
// can stall the main thread, and the repeats queued meanwhile then arrive in one burst.
const talkKey = { lastAt: 0, held: false, stopTimer: 0 };
const KEY_QUIET_MS = 350;

function onTalkKey() {
  const now = Date.now();
  const gap = now - talkKey.lastAt;
  talkKey.lastAt = now;
  if (!listening) {
    if (gap < 250) return; // repeats from a key still held after listening ended
    talkKey.held = false;
    startListening();
    return;
  }
  if (!talkKey.held) {
    talkKey.held = true;
    send("listen:hold");
  }
  clearTimeout(talkKey.stopTimer);
  talkKey.stopTimer = setTimeout(() => {
    talkKey.held = false;
    if (listening) send("listen:stop");
  }, KEY_QUIET_MS);
}

function startListening() {
  if (listening) {
    send("listen:stop");
    return;
  }
  followDisplay();
  listening = true;
  setWake(false);
  pointer.start();
  pendingShot = shoot();
  send("listen:start", { wake: false });
}

async function onListenResult(payload) {
  const wake = !!payload?.wake;
  if (!wake || payload?.pcm) log(`[listen] ${payload?.pcm ? `${(payload.pcm.byteLength / 4 / 16000).toFixed(1)} s of audio` : payload?.error ? `error: ${payload.error}` : "nothing heard"}${wake ? " (wake check)" : ""}`);
  if (!wake) {
    listening = false;
    pointerAt = pointer.stop();
  }
  if (!payload?.pcm) {
    if (wake) setTimeout(wakeTick, 200);
    else setWake(true);
    return;
  }
  let text = "";
  try {
    text = await voice.transcribe(payload.pcm, { language: cfg.language, prompt: wake ? "Hey Talky," : undefined });
  } catch (err) {
    log(`[stt] ${err.message}`);
    if (!wake) status("error", err.message, 6000);
    if (wake) setTimeout(wakeTick, 2000);
    return;
  }
  log(`[stt] ${wake ? "(wake) " : ""}"${text}"`);
  if (wake) {
    const m = WAKE.exec(text);
    if (!m) return setTimeout(wakeTick, 100);
    const rest = text.slice(m[0].length).trim();
    if (rest.split(/\s+/).length < 2) return startListening(); // just "Hey Talky": listen for the question
    send("heard", { text: rest });
    return ask(rest, shoot(), screen.getCursorScreenPoint());
  }
  if (!text || /^[\s.,!?]*$/.test(text) || /^(thank you\.?|you)$/i.test(text.trim())) {
    status("error", "Didn't catch that", 2200);
    setWake(true);
    return;
  }
  send("heard", { text });
  ask(text, pendingShot || shoot(), pointerAt);
}

// "Hey Talky": while idle, the overlay keeps recording short utterances and the worker checks each for the phrase.
function setWake(on) {
  wakeLoopOn = on && cfg.wakeWord && overlayReady;
  if (wakeLoopOn && !listening && !answering) wakeTick();
}

function wakeTick() {
  if (!wakeLoopOn || listening || answering) return;
  send("listen:start", { wake: true });
}

function clearScreen() {
  askSeq++;
  if (answering) provider?.cancel();
  answering = false;
  send("stage:clear");
  provider?.newTopic();
  lastAnswerAt = 0;
  setVisuals(false);
  setWake(true);
}

function setVisuals(on) {
  visualsOnScreen = on;
  const key = cfg.clearHotkey;
  if (!key) return;
  // Esc belongs to the user's apps except while Talky has something on screen.
  if (on && !globalShortcut.isRegistered(key)) globalShortcut.register(key, clearScreen);
  if (!on && globalShortcut.isRegistered(key)) globalShortcut.unregister(key);
}

async function openAskBar() {
  if (!askWin) createAskWindow();
  followDisplay();
  pointerAt = screen.getCursorScreenPoint();
  pendingShot = shoot();
  const b = activeDisplay().workArea;
  askWin.setBounds({ x: Math.round(b.x + b.width / 2 - 340), y: b.y + 56, width: 680, height: 66 });
  await pendingShot.catch(() => {});
  askWin.show();
  askWin.focus();
  askWin.webContents.send("ask:show");
}

// ---------------------------------------------------------------- hotkeys, tray

function hotkeyLabel(accel) {
  return String(accel || "").replace(/Control/g, "Ctrl").replace(/\+/g, "+");
}

// If another app already owns a shortcut, the next free one in the list is used instead.
const TALK_FALLBACKS = ["Control+Alt+Space", "Control+Shift+Space", "Alt+Shift+Space", "Control+Alt+K"];
const TYPE_FALLBACKS = ["Control+Alt+T", "Control+Shift+Y", "Control+Alt+Y"];
const keys = { talk: "", type: "" };

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const claim = (wanted, fallbacks, fn) => {
    for (const accel of [wanted, ...fallbacks.filter((f) => f !== wanted)]) {
      if (!accel) continue;
      try {
        if (globalShortcut.register(accel, fn)) {
          if (accel !== wanted) log(`[hotkeys] ${wanted} is taken by another app; using ${accel}`);
          return accel;
        }
      } catch {}
    }
    log(`[hotkeys] none of ${[wanted, ...fallbacks].join(", ")} could be registered`);
    return "";
  };
  keys.talk = claim(cfg.talkHotkey, TALK_FALLBACKS, onTalkKey);
  keys.type = claim(cfg.typeHotkey, TYPE_FALLBACKS, openAskBar);
  if (visualsOnScreen) setVisuals(true);
}

function sendSettings() {
  send("settings", { captions: cfg.captions, muted: cfg.voice === "muted", voice: cfg.voice });
}

function change(patch) {
  const before = cfg;
  cfg = settings.update(patch);
  if (patch.model && patch.model !== before.model) startProvider();
  if (patch.effort && provider?.effort !== undefined) {
    provider.effort = cfg.effort;
    provider.newTopic();
  }
  if ("hideFromCapture" in patch) applyContentProtection();
  if ("wakeWord" in patch) setWake(true);
  if ("voice" in patch && voice) voice.ttsBroken = false;
  sendSettings();
  buildTray();
}

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromBuffer(trayIconPng(32), { scaleFactor: 2 }));
    tray.on("click", () => tray.popUpContextMenu());
  }
  tray.setToolTip(`Talky · ${hotkeyLabel(keys.talk)} to talk · ${hotkeyLabel(keys.type)} to type`);
  const modelItem = (m) => ({ label: m.name || m.id, type: "radio", checked: cfg.model === m.id, click: () => change({ model: m.id }) });
  const known = new Set(SUGGESTED.map((m) => m.id));
  const more = extraModels.filter((id) => !known.has(id));
  const menu = Menu.buildFromTemplate([
    { label: `Talk    ${hotkeyLabel(keys.talk)}`, click: startListening },
    { label: `Type a question    ${hotkeyLabel(keys.type)}`, click: openAskBar },
    { label: "Clear the screen    Esc", click: clearScreen },
    { type: "separator" },
    {
      label: "Model",
      submenu: [
        ...SUGGESTED.map(modelItem),
        ...(more.length
          ? [
              { type: "separator" },
              { label: "All Command Code models", submenu: more.filter((id) => id.startsWith("cmd:")).map((id) => modelItem({ id, name: id.slice(4) })) },
              { label: "All Antigravity models", submenu: more.filter((id) => id.startsWith("agy:")).map((id) => modelItem({ id, name: id.slice(4) })) },
            ]
          : []),
        { type: "separator" },
        {
          label: "Thinking",
          submenu: ["off", "low", "default", "high"].map((e) => ({ label: e === "off" ? "Off (fastest)" : e[0].toUpperCase() + e.slice(1), type: "radio", checked: cfg.effort === e, click: () => change({ effort: e }) })),
        },
        { label: "Restart the model", click: startProvider },
      ],
    },
    {
      label: "Voice",
      submenu: [
        { label: "Natural voice (edge-tts)", type: "radio", checked: cfg.voice === "neural", click: () => change({ voice: "neural" }) },
        { label: "Windows voice", type: "radio", checked: cfg.voice === "system", click: () => change({ voice: "system" }) },
        { label: "Silent", type: "radio", checked: cfg.voice === "muted", click: () => change({ voice: "muted" }) },
      ],
    },
    { label: "Show captions", type: "checkbox", checked: cfg.captions, click: (i) => change({ captions: i.checked }) },
    { label: "Listen for “Hey Talky”", type: "checkbox", checked: cfg.wakeWord, click: (i) => change({ wakeWord: i.checked }) },
    { label: "Hide Talky from screen recordings", type: "checkbox", checked: cfg.hideFromCapture, click: (i) => change({ hideFromCapture: i.checked }) },
    { type: "separator" },
    { label: "Open log", click: () => shell.openPath(logFile()) },
    { label: "Quit Talky", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---------------------------------------------------------------- IPC

function wireIpc() {
  ipcMain.on("overlay:ready", () => {
    overlayReady = true;
    // The first capture after launch is several times slower than the rest; get it out of the way now.
    setTimeout(() => captureScreen().catch(() => {}), 1500);
    sendSettings();
    status("idle", `Talky · ${hotkeyLabel(keys.talk)} to talk, ${hotkeyLabel(keys.type)} to type`, 4000);
    setWake(true);
  });
  ipcMain.on("overlay:interactive", (_e, on) => overlay?.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on("overlay:visuals", (_e, on) => setVisuals(on));
  ipcMain.on("capture:ready", (_e, token) => captureWaits.get(token)?.());
  ipcMain.on("answer:done", (_e, info) => {
    answering = false;
    if (info?.ops === 0) log("[ask] the reply had no scene ops");
    setWake(true);
  });
  ipcMain.on("listen:result", (_e, payload) => onListenResult(payload));
  ipcMain.handle("tts:synth", async (_e, text) => (cfg.voice === "neural" ? voice.synth(text, cfg.voiceName) : null));
  ipcMain.on("ask:submit", (_e, text) => {
    askWin?.hide();
    ask(text, pendingShot || shoot(), pointerAt);
  });
  ipcMain.on("ask:hide", () => askWin?.hide());
}

// ---------------------------------------------------------------- local control server (for testing and automation)

function startDevServer() {
  const port = Number(cfg.devPort) || 8791;
  createServer(async (req, res) => {
    const url = new URL(req.url, "http://talky");
    const body = await new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });
    const json = (code, obj) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(obj));
    try {
      if (req.method === "POST" && url.pathname === "/ask") {
        const req = body.length ? JSON.parse(body.toString()) : {};
        const text = url.searchParams.get("q") || req.text;
        followDisplay();
        const at = Array.isArray(req.pointer) ? { x: req.pointer[0], y: req.pointer[1] } : screen.getCursorScreenPoint();
        ask(text, shoot(), at);
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/ops") {
        send("ops:play", { text: body.toString(), question: url.searchParams.get("q") || "demo" });
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/clear") {
        clearScreen();
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/talkkey") {
        onTalkKey(); // one hotkey event, as Windows sends it (a held key sends ~30 a second)
        return json(200, { ok: true, listening, held: talkKey.held });
      }
      if (req.method === "POST" && url.pathname === "/listen") {
        startListening();
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/stt") {
        const text = await voice.transcribe(body, { language: cfg.language });
        return json(200, { text });
      }
      if (req.method === "POST" && url.pathname === "/settings") {
        change(JSON.parse(body.toString() || "{}"));
        return json(200, cfg);
      }
      if (req.method === "GET" && url.pathname === "/snap") {
        const shot = await captureScreen({ full: true, format: "png" });
        return res.writeHead(200, { "content-type": "image/png" }).end(shot.png);
      }
      if (req.method === "GET" && url.pathname === "/state") {
        return json(200, { model: cfg.model, ready: !!provider, answering, listening, visualsOnScreen, sttReady: voice?.sttReady, sttError: voice?.sttError, ttsBroken: voice?.ttsBroken });
      }
      json(404, { error: "not found" });
    } catch (err) {
      json(500, { error: err.message });
    }
  }).listen(port, "127.0.0.1", () => log(`[dev] control server on http://127.0.0.1:${port}`));
}

// ---------------------------------------------------------------- app

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => status("idle", "Talky is already running", 2500));
  app.whenReady().then(() => {
    cfg = settings.load();
    log(`---- Talky ${app.getVersion()} starting`);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(["media", "audioCapture", "speaker-selection"].includes(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => ["media", "audioCapture", "speaker-selection"].includes(permission));
    voice = new VoiceWorker({ log, python: cfg.python || undefined, whisperModel: cfg.whisperModel });
    voice.start();
    wireIpc();
    createOverlay();
    buildTray();
    registerHotkeys();
    startProvider();
    if (DEV || cfg.devServer) startDevServer();
    discoverModels()
      .then((ids) => {
        extraModels = ids;
        buildTray();
      })
      .catch(() => {});
    screen.on("display-removed", () => followDisplay());
  });
  app.on("window-all-closed", (e) => e.preventDefault());
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    provider?.dispose();
    voice?.dispose();
  });
}
