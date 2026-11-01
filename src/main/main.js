// Penny's main process: the overlay window, hotkeys, tray, and the loop from question to drawn answer.

const { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, session, shell, Tray } = require("electron");
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { join } = require("node:path");
const settings = require("./settings");
const { captureScreen, activeDisplay, markPointer } = require("./capture");
const { PointerTracker, POINTING, toImage, gestureOnShot } = require("./pointer");
const { createProvider, discoverModels, SUGGESTED, OWN_ACCOUNTS, parseModelId } = require("./providers");
const credentials = require("./credentials");
const { testClaudeKey } = require("./providers/anthropic");
const { testOpenAiKey } = require("./providers/openai");
const { codexStatus, codexLogin } = require("./providers/codex");
const { testGeminiKey } = require("./providers/gemini");
const { claudeSignInStatus, claudeSignIn, googleAccountStatus, googleSignIn } = require("./signin");
const { registerNativeHost } = require("./native-host");
const { VoiceWorker } = require("./voice");
const { trayIconPng } = require("./icon");

const DEV = process.argv.includes("--dev");
const FOLLOW_UP_MS = 5 * 60_000;
// "Hey Penny", including the ways Whisper writes it when it mishears.
const WAKE = /^\W*(?:hey|hi|hay|ok|okay|a)[\s,.!]+(?:penny|pennie|penni|penney|penne|peni|benny|bennie|pen e)\b[\s,.!?]*/i;

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
let gestureAt = null; // the mouse path traced while asking: { points, view } in overlay pixels

const logFile = () => join(app.getPath("userData"), "penny.log");
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
  overlay.once("ready-to-show", () => {
    overlay.showInactive();
    // Windows clamps a new window to the work area (above the taskbar). The overlay has to cover the same area as the
    // screenshot or every mark lands too high, so it is stretched over the whole display once it is up.
    overlay.setBounds(b);
  });
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

let accountsWin = null;

function openAccounts({ inactive = false } = {}) {
  if (accountsWin && !accountsWin.isDestroyed()) {
    if (inactive) accountsWin.showInactive();
    else {
      accountsWin.show();
      accountsWin.focus();
    }
    return;
  }
  accountsWin = new BrowserWindow({
    width: 560,
    height: 760,
    title: "Penny · Accounts",
    backgroundColor: "#141416",
    autoHideMenuBar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    show: false,
    webPreferences: { preload: join(__dirname, "..", "preload", "accounts.js"), contextIsolation: true },
  });
  accountsWin.loadFile(join(__dirname, "..", "renderer", "accounts.html"));
  accountsWin.once("ready-to-show", () => (inactive ? accountsWin.showInactive() : accountsWin.show()));
  accountsWin.on("closed", () => (accountsWin = null));
}

// ---------------------------------------------------------------- model

function startProvider() {
  provider?.dispose();
  const parsed = parseModelId(cfg.model);
  provider = createProvider(cfg.model, log, { getKey: credentials.getKey });
  if (provider.effort !== undefined) provider.effort = cfg.effort;
  log(`[model] ${provider.label}`);
  const started = Date.now();
  Promise.resolve(provider.warm())
    .then(() => {
      if (overlayReady) status("idle", `Penny is ready · ${hotkeyLabel(keys.talk)} to talk`, 3500);
      log(`[model] warm after ${((Date.now() - started) / 1000).toFixed(1)}s`);
    })
    .catch((err) => {
      log(`[model] failed to start: ${err.message}`);
      status("error", friendlyError(err, parsed), 8000);
    });
}

function friendlyError(err, parsed = parseModelId(cfg.model)) {
  const m = String(err?.message || err);
  // The API-key and ChatGPT providers already explain their own errors.
  if (err?.needsKey || ["claude", "openai", "codex"].includes(parsed?.kind)) return m.length > 180 ? `${m.slice(0, 180)}…` : m;
  const cli = parsed?.kind === "agy" ? "Antigravity" : "Command Code";
  if (/MODEL_NOT_IN_PLAN|not in (your )?plan/i.test(m)) return `${parsed?.model} is not on your ${cli} plan. Pick another model in the tray menu.`;
  if (/ENOENT|not recognized|cannot find/i.test(m)) return `${cli} CLI not found. Install it and sign in, then restart Penny.`;
  if (/401|unauthori[sz]ed|not logged in|login/i.test(m)) return parsed?.kind === "agy" ? "Sign in to Antigravity (run agy once)." : "Sign in to Command Code: command-code logout, then command-code login.";
  if (/stopped|exited/i.test(m)) return `${cli} stopped. Ask again to restart it.`;
  return m.length > 140 ? `${m.slice(0, 140)}…` : m;
}

async function ask(question, shotPromise, pointedAt = null, gesture = null) {
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
    shot = withPointer(shot, pointedAt, question, gesture);
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
    if (err.needsKey) openAccounts(); // missing or rejected key: show where to fix it
    answering = false;
    setWake(true);
  } finally {
    settle();
    if (currentAsk && id === askSeq) currentAsk = null;
  }
}

// ---------------------------------------------------------------- talking

/** Captures the screen for the model with Penny's drawings hidden for that moment (the status pill stays). */
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
function withPointer(shot, pointedAt, question, gestureRaw) {
  // A traced path (circling something, or a stroke ending on it) counts as pointing even without "this".
  const gesture = gestureOnShot(gestureRaw, shot);
  const pt = gesture ? gesture.target : toImage(pointedAt, shot);
  if (!pt) return { ...shot, pointer: null };
  const meant = !!gesture || POINTING.test(question);
  if (!meant) return { ...shot, pointer: { ...pt, meant } };
  try {
    const marked = markPointer(shot, pt, gesture);
    log(`[pointer] "${question}" ${gesture ? `${gesture.loop ? "circles" : "traces to"} ${gesture.box.join(",")}` : `points at ${pt.x},${pt.y}`}`);
    const pointer = { ...pt, meant, ...(gesture?.loop ? { box: gesture.box } : {}) };
    const gestureInfo = gesture ? { loop: gesture.loop, box: gesture.box } : null;
    return { ...shot, jpeg: marked.jpeg, closeup: marked.closeup, closeupBox: marked.closeupBox, pointer, gesture: gestureInfo };
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
  armKeyRelease(Date.now());
}

/** Stops listening once key events go quiet. A timer that fires late means the main thread was stalled and the repeats
 * queued meanwhile have not been seen yet, so it waits another round instead of taking that as a release. */
function armKeyRelease(armedAt) {
  talkKey.stopTimer = setTimeout(() => {
    if (Date.now() - armedAt > KEY_QUIET_MS + 150) return armKeyRelease(Date.now());
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
    gestureAt = payload?.gesture?.length ? { points: payload.gesture, view: payload.view } : null;
  }
  if (!payload?.pcm) {
    if (wake) setTimeout(wakeTick, 200);
    else setWake(true);
    return;
  }
  let text = "";
  try {
    text = await voice.transcribe(payload.pcm, { language: cfg.language, prompt: wake ? "Hey Penny," : undefined });
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
    if (rest.split(/\s+/).length < 2) return startListening(); // just "Hey Penny": listen for the question
    send("heard", { text: rest });
    return ask(rest, shoot(), screen.getCursorScreenPoint());
  }
  if (!text || /^[\s.,!?]*$/.test(text) || /^(thank you\.?|you)$/i.test(text.trim()) || looksLikeNoise(text)) {
    if (text) log(`[stt] ignored as background noise`);
    status("error", "Didn't catch that", 2200);
    setWake(true);
    return;
  }
  send("heard", { text });
  ask(text, pendingShot || shoot(), pointerAt, gestureAt);
}

/**
 * Whisper turns background audio (a TV, a video) into text too. Two telltale shapes: one sentence repeated over and
 * over, and a lone word. A real question has a few words and does not repeat itself.
 */
function looksLikeNoise(text) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
  if (words.length < 2) return true;
  const sentences = text.split(/[.!?]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return sentences.length >= 3 && new Set(sentences).size === 1;
}

// "Hey Penny": while idle, the overlay keeps recording short utterances and the worker checks each for the phrase.
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
  // Esc belongs to the user's apps except while Penny has something on screen.
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
  if (accountsWin && !accountsWin.isDestroyed()) accountsWin.webContents.send("accounts:changed");
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
  tray.setToolTip(`Penny · ${hotkeyLabel(keys.talk)} to talk · ${hotkeyLabel(keys.type)} to type`);
  const modelItem = (m) => ({ label: m.name || m.id, type: "radio", checked: cfg.model === m.id, click: () => change({ model: m.id }) });
  // Own-account models that are not set up yet say so, and picking one opens Accounts.
  const ownItem = (m) => {
    const ready =
      m.needs === "codex" || m.needs === "google-account"
        ? true
        : !!credentials.hint(m.needs) || (m.needs === "anthropic" && claudeSignInStatus() === "signed-in");
    return {
      label: ready ? m.name : `${m.name}  · set up in Accounts`,
      type: "radio",
      checked: cfg.model === m.id,
      click: () => {
        change({ model: m.id });
        if (!ready) openAccounts();
      },
    };
  };
  const custom = !OWN_ACCOUNTS.some((m) => m.id === cfg.model);
  const openaiCurrent = [
    ...(custom && cfg.model.startsWith("openai:") ? [modelItem({ id: cfg.model, name: `${cfg.model.slice(7)} (your OpenAI API key)` })] : []),
    ...(custom && cfg.model.startsWith("gemini:") ? [modelItem({ id: cfg.model, name: `${cfg.model.slice(7)} (your Gemini API key)` })] : []),
  ];
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
        { label: "Your own accounts", enabled: false },
        ...OWN_ACCOUNTS.map(ownItem),
        ...openaiCurrent,
        { type: "separator" },
        { label: "Command Code and Antigravity (their own sign-in)", enabled: false },
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
    { label: "Accounts and API keys…", click: openAccounts },
    {
      label: "Voice",
      submenu: [
        { label: "Natural voice (edge-tts)", type: "radio", checked: cfg.voice === "neural", click: () => change({ voice: "neural" }) },
        { label: "Windows voice", type: "radio", checked: cfg.voice === "system", click: () => change({ voice: "system" }) },
        { label: "Silent", type: "radio", checked: cfg.voice === "muted", click: () => change({ voice: "muted" }) },
      ],
    },
    { label: "Show captions", type: "checkbox", checked: cfg.captions, click: (i) => change({ captions: i.checked }) },
    { label: "Listen for “Hey Penny”", type: "checkbox", checked: cfg.wakeWord, click: (i) => change({ wakeWord: i.checked }) },
    { label: "Hide Penny from screen recordings", type: "checkbox", checked: cfg.hideFromCapture, click: (i) => change({ hideFromCapture: i.checked }) },
    { type: "separator" },
    { label: "Open log", click: () => shell.openPath(logFile()) },
    { label: "Quit Penny", click: () => app.quit() },
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
    status("idle", `Penny · ${hotkeyLabel(keys.talk)} to talk, ${hotkeyLabel(keys.type)} to type`, 4000);
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
  wireAccountsIpc();
}

// ---------------------------------------------------------------- Accounts window (keys go in, masked hints come out)

const KEY_LINKS = ["https://console.anthropic.com/", "https://platform.openai.com/", "https://aistudio.google.com/", "https://github.com/anthropics/anthropic-cli/"];
const KEY_KIND = { anthropic: "claude", openai: "openai", google: "gemini" };

// Asking Antigravity whether it is signed in takes a few seconds, so the answer is cached and refreshed in the background.
let googleState = "checking";
let googleCheck = null;
function refreshGoogleState() {
  googleCheck ??= googleAccountStatus().then((state) => {
    googleCheck = null;
    if (state !== googleState) {
      googleState = state;
      accountsWin?.webContents.send("accounts:changed");
    }
  });
  return googleCheck;
}

async function accountsState() {
  const all = [...OWN_ACCOUNTS, ...SUGGESTED];
  const named = all.find((m) => m.id === cfg.model);
  return {
    keys: { anthropic: credentials.hint("anthropic"), openai: credentials.hint("openai"), google: credentials.hint("google") },
    codex: await codexStatus(),
    claude: claudeSignInStatus(),
    google: (refreshGoogleState(), googleState),
    geminiModel: cfg.geminiModel,
    model: cfg.model,
    modelName: named?.name || cfg.model,
    openaiModel: cfg.openaiModel,
  };
}

function wireAccountsIpc() {
  ipcMain.handle("accounts:state", () => accountsState());
  ipcMain.handle("accounts:save-key", async (_e, provider, key) => {
    try {
      credentials.setKey(provider, key);
      log(`[accounts] ${provider} key saved`); // never the key itself
      if (parseModelId(cfg.model)?.kind === KEY_KIND[provider]) startProvider();
      buildTray();
      return { state: await accountsState() };
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle("accounts:remove-key", async (_e, provider) => {
    credentials.removeKey(provider);
    log(`[accounts] ${provider} key removed`);
    buildTray();
    return accountsState();
  });
  ipcMain.handle("accounts:test", async (_e, provider) => {
    const key = credentials.getKey(provider);
    if (!key) return { ok: false, error: "No key saved yet." };
    try {
      if (provider === "anthropic") {
        const current = parseModelId(cfg.model);
        await testClaudeKey(key, current?.kind === "claude" ? current.model : "claude-opus-5-5");
      } else if (provider === "google") {
        await testGeminiKey(key, cfg.geminiModel);
      } else {
        await testOpenAiKey(key, cfg.openaiModel);
      }
      return { ok: true };
    } catch (err) {
      const plain = {
        401: "This key was rejected. Check that it was copied whole, or create a new one.",
        403: "This key works but isn't allowed to use that model.",
        404: "That model isn't available to this account.",
        429: "The account is rate-limited or out of credit.",
      }[/API_KEY_INVALID|API key not valid|invalid.*api.?key/i.test(err.message) ? 401 : err.status];
      return { ok: false, error: plain || String(err.message).slice(0, 200) };
    }
  });
  ipcMain.handle("accounts:codex-login", async () => {
    try {
      await codexLogin();
      return { state: await accountsState() };
    } catch (err) {
      return { error: err.message, state: await accountsState() };
    }
  });
  ipcMain.handle("accounts:use", async (_e, modelId) => {
    const parsed = parseModelId(modelId);
    if (!parsed) return { error: "That model name isn't valid." };
    change({
      model: modelId,
      ...(parsed.kind === "openai" ? { openaiModel: parsed.model } : {}),
      ...(parsed.kind === "gemini" ? { geminiModel: parsed.model } : {}),
    });
    return { state: await accountsState() };
  });
  ipcMain.handle("accounts:claude-login", async () => {
    try {
      await claudeSignIn();
      if (parseModelId(cfg.model)?.kind === "claude") startProvider();
      buildTray();
      return { state: await accountsState() };
    } catch (err) {
      return { error: err.message, install: err.install, state: await accountsState() };
    }
  });
  ipcMain.handle("accounts:google-login", async () => {
    try {
      await googleSignIn();
      // Check again in a while: the user signs in in the Antigravity window.
      setTimeout(refreshGoogleState, 30_000);
      setTimeout(refreshGoogleState, 90_000);
      return {};
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.on("accounts:open", (_e, url) => {
    if (KEY_LINKS.some((prefix) => String(url).startsWith(prefix))) shell.openExternal(url);
  });
}

// ---------------------------------------------------------------- local control server (for testing and automation)

function startDevServer() {
  const port = Number(cfg.devPort) || 8791;
  createServer(async (req, res) => {
    const url = new URL(req.url, "http://penny");
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
      if (req.method === "POST" && url.pathname === "/accounts") {
        openAccounts({ inactive: true }); // testing: don't take focus from what the user is doing
        return json(200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/accounts/text") {
        if (!accountsWin) return json(400, { error: "Accounts is closed" });
        const text = await accountsWin.webContents.executeJavaScript("document.body.innerText");
        return res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(text);
      }
      if (req.method === "GET" && url.pathname === "/accounts/snap") {
        if (!accountsWin) return json(400, { error: "Accounts is closed" });
        const image = await accountsWin.webContents.capturePage();
        return res.writeHead(200, { "content-type": "image/png" }).end(image.toPNG());
      }
      if (req.method === "POST" && url.pathname === "/accounts/call") {
        // Runs one of the Accounts window's own calls, as its buttons do (testing only).
        const { fn, args = [] } = JSON.parse(body.toString() || "{}");
        if (!/^(state|saveKey|removeKey|test|use)$/.test(fn) || !accountsWin) return json(400, { error: "no such call, or Accounts is closed" });
        const result = await accountsWin.webContents.executeJavaScript(`window.accounts.${fn}(...${JSON.stringify(args)})`);
        return json(200, result ?? {});
      }
      if (req.method === "GET" && url.pathname === "/overlay") {
        const state = await overlay.webContents.executeJavaScript(
          "JSON.stringify({ trail: { recording: __penny.trail.recording, points: __penny.trail.points.length, path: __penny.trail.path.length, canvas: [__penny.trail.canvas.width, __penny.trail.canvas.height], mode: __penny.trail.mode, running: __penny.trail.running, frames: __penny.trail.frames || 0, error: __penny.trail.lastError || null }, view: [innerWidth, innerHeight], items: __penny.stage.items.length })",
        );
        return res.writeHead(200, { "content-type": "application/json" }).end(state);
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
  app.on("second-instance", () => status("idle", "Penny is already running", 2500));
  app.whenReady().then(() => {
    cfg = settings.load();
    log(`---- Penny ${app.getVersion()} starting`);
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
    // Penny for Chrome can use the accounts signed in here.
    registerNativeHost({ exe: process.execPath, script: join(__dirname, "..", "native", "host.js"), dir: app.getPath("userData"), log });
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
