// Penny for Chrome, background worker. Clicking the toolbar button (or Alt+Shift+P) lays Penny's overlay on the tab.
// A question from its ask bar is answered here: the visible tab is captured with Penny's drawings hidden, the pointer
// is marked on it, and the model's scene ops stream back to the overlay. The model is called straight from the
// browser with the user's own API key, kept in this browser's extension storage; Penny has no server.

import { ClaudeApiProvider, testClaudeKey } from "../src/main/providers/anthropic.js";
import { OpenAiApiProvider, testOpenAiKey } from "../src/main/providers/openai.js";
import { GeminiApiProvider, testGeminiKey } from "../src/main/providers/gemini.js";
import { POINTING, gestureOnShot } from "../src/main/gesture.js";
import { KEY_FOR, loadSettings as settings } from "./models.js";

const MAX_WIDTH = 1600; // screenshot width sent to the model
const FOLLOW_UP_MS = 5 * 60_000;

/** Browser-only client options; `devBaseUrls` (set from DevTools, never in the UI) points a provider at a mock. */
function clientOptions(provider, s) {
  const base = s.devBaseUrls?.[provider];
  if (provider === "gemini") return base ? { httpOptions: { baseUrl: base } } : {};
  return { dangerouslyAllowBrowser: true, ...(base ? { baseURL: base } : {}) };
}

function createProvider(s) {
  const id = s.provider;
  const options = { model: s.models[id], getKey: () => s.keys[KEY_FOR[id]], clientOptions: clientOptions(id, s), log: console.log };
  const provider = id === "openai" ? new OpenAiApiProvider(options) : id === "gemini" ? new GeminiApiProvider(options) : new ClaudeApiProvider(options);
  provider.effort = s.effort;
  return provider;
}

// ---------------------------------------------------------------- tabs

const tabs = new Map(); // tabId -> { port, provider, providerKey, visuals, lastAnswerAt, askSeq, waits, openWhenReady }

function tabState(tabId) {
  if (!tabs.has(tabId)) tabs.set(tabId, { port: null, provider: null, providerKey: "", visuals: false, lastAnswerAt: 0, askSeq: 0, waits: new Map(), openWhenReady: false });
  return tabs.get(tabId);
}

const send = (t, type, data) => {
  try {
    t.port?.postMessage({ type, data });
  } catch {}
};

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.get(tabId)?.provider?.cancel();
  tabs.delete(tabId);
});

chrome.action.onClicked.addListener(async (tab) => {
  const t = tabState(tab.id);
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch {
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#d93025" });
    chrome.action.setBadgeText({ tabId: tab.id, text: "×" });
    chrome.action.setTitle({ tabId: tab.id, title: "Penny can't draw on this page (browser pages and the Web Store are off limits)." });
    return;
  }
  if (t.port) openAskBar(tab.id, t);
  else t.openWhenReady = true; // the overlay is still loading
});

function openAskBar(tabId, t) {
  // Focus the overlay frame first; a frame can't take the keyboard focus by itself.
  chrome.scripting.executeScript({ target: { tabId }, func: () => window.__pennyOverlay?.focus() }).catch(() => {});
  send(t, "ask:open");
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "overlay" || !port.sender?.tab) return;
  const tabId = port.sender.tab.id;
  const t = tabState(tabId);
  t.port = port;
  port.onDisconnect.addListener(() => {
    if (t.port === port) t.port = null;
  });
  port.onMessage.addListener(async ({ type, data }) => {
    if (type === "ready") {
      const s = await settings();
      send(t, "settings", { muted: !s.speak, captions: s.captions, voice: "system" });
      if (t.openWhenReady) {
        t.openWhenReady = false;
        openAskBar(tabId, t);
      }
    } else if (type === "ask") ask(tabId, t, data);
    else if (type === "cancel") {
      t.askSeq++;
      t.provider?.cancel();
    } else if (type === "visuals") t.visuals = !!data;
    else if (type === "capture-ready") t.waits.get(data)?.();
    else if (type === "open-options") chrome.runtime.openOptionsPage();
  });
});

// Settings changed on the options page: the next question uses them.
chrome.storage.onChanged.addListener(async () => {
  const s = await settings();
  for (const t of tabs.values()) send(t, "settings", { muted: !s.speak, captions: s.captions, voice: "system" });
});

// ---------------------------------------------------------------- asking

async function ask(tabId, t, { question, pointer, gesture, view }) {
  question = String(question || "").trim();
  if (!question) return;
  const id = ++t.askSeq;
  t.provider?.cancel();
  send(t, "answer:start", { question });
  try {
    const s = await settings();
    if (!s.keys[KEY_FOR[s.provider]]) {
      chrome.runtime.openOptionsPage();
      throw Object.assign(new Error("Add your API key in Penny's settings first."), { needsKey: true });
    }
    const providerKey = JSON.stringify([s.provider, s.models[s.provider], s.keys[KEY_FOR[s.provider]], s.devBaseUrls]);
    if (t.providerKey !== providerKey) {
      t.provider = createProvider(s);
      t.providerKey = providerKey;
    }
    t.provider.effort = s.effort;
    const tab = await chrome.tabs.get(tabId);
    let shot = await capture(t, tab);
    if (id !== t.askSeq) return;
    shot = await withPointer(shot, question, pointer, gesture, view);
    send(t, "answer:space", { w: shot.imageWidth, h: shot.imageHeight });
    send(t, "answer:pointer", shot.pointer);
    const followUp = t.visuals || Date.now() - t.lastAnswerAt < FOLLOW_UP_MS;
    if (!followUp && t.provider.turns > 0) await t.provider.newTopic();
    await t.provider.ask({
      question,
      shot,
      visualsOnScreen: t.visuals,
      onDelta: (text) => id === t.askSeq && send(t, "answer:delta", text),
    });
    if (id !== t.askSeq) return;
    send(t, "answer:end");
    t.lastAnswerAt = Date.now();
  } catch (err) {
    if (err.cancelled || id !== t.askSeq) return;
    console.warn("[penny]", err);
    if (err.needsKey) chrome.runtime.openOptionsPage();
    send(t, "answer:error", { message: friendly(err) });
  }
}

/** The provider messages name the desktop app's Accounts window; here the keys live in the options page. */
function friendly(err) {
  const m = String(err?.message || err).replace(/ in Accounts \(tray menu\)| in Accounts/g, " in Penny's settings").replace(/ \(tray menu\)/g, "");
  return m.length > 180 ? `${m.slice(0, 180)}…` : m;
}

// ---------------------------------------------------------------- the screenshot

/** Captures what the tab shows, with Penny's drawings hidden for that moment. */
async function capture(t, tab) {
  if (!tab.active) throw new Error("Switch back to this tab, then ask again.");
  await new Promise((resolve) => {
    const token = String(Math.random()).slice(2);
    const done = () => {
      t.waits.delete(token);
      resolve();
    };
    t.waits.set(token, done);
    send(t, "capture:prepare", { token });
    setTimeout(done, 500); // never hang on an overlay that went away
  });
  let url;
  try {
    url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 90 });
  } catch (err) {
    throw new Error(/permission|activeTab/i.test(err.message) ? "Click Penny's button (or press Alt+Shift+P) on this page again so it can see the page." : `Couldn't capture the page: ${err.message}`);
  } finally {
    send(t, "capture:done");
  }
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let host = "";
  try {
    host = new URL(tab.url).host;
  } catch {}
  return { canvas, imageWidth: canvas.width, imageHeight: canvas.height, title: [tab.title, host].filter(Boolean).join(" · ") };
}

/**
 * Adds where the user pointed, as the desktop app does: with "this"/"here" in the question (or a traced path), the
 * pointer is ringed on the screenshot in magenta and a close-up of that spot goes along.
 */
async function withPointer(shot, question, pointer, gestureRaw, view) {
  const { canvas, ...facts } = shot;
  const encode = async (c) => b64(await c.convertToBlob({ type: "image/jpeg", quality: 0.85 }));
  const plain = async (p = null) => ({ ...facts, pointer: p, jpeg: await encode(canvas) });
  if (!view?.[0]) return plain();
  const gesture = gestureRaw?.length ? gestureOnShot({ points: gestureRaw, view }, shot) : null;
  const pt = gesture ? gesture.target : pointer ? { x: Math.round((pointer.x / view[0]) * shot.imageWidth), y: Math.round((pointer.y / view[1]) * shot.imageHeight) } : null;
  if (!pt) return plain();
  const meant = !!gesture || POINTING.test(question);
  if (!meant) return plain({ ...pt, meant });
  const ctx = canvas.getContext("2d");
  ctx.lineCap = ctx.lineJoin = "round";
  const path = (pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  };
  if (gesture) {
    path(gesture.points);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = "#ec00aa";
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  if (!gesture?.loop) {
    const ring = (r, width, color) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    ring(15.5, 9, "#fff");
    ring(15.5, 5, "#ec00aa");
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ec00aa";
    ctx.fill();
  }
  // A 2x close-up of the spot (or of the circled area).
  const span = gesture?.loop ? [gesture.box[2] - gesture.box[0], gesture.box[3] - gesture.box[1]] : [0, 0];
  const cw = Math.min(canvas.width, Math.max(440, Math.round(span[0] * 1.4)));
  const ch = Math.min(canvas.height, Math.max(260, Math.round(span[1] * 1.4)));
  const cx = Math.max(0, Math.min(canvas.width - cw, Math.round(pt.x - cw / 2)));
  const cy = Math.max(0, Math.min(canvas.height - ch, Math.round(pt.y - ch / 2)));
  const zoom = Math.min(2, 1400 / cw);
  const close = new OffscreenCanvas(Math.round(cw * zoom), Math.round(ch * zoom));
  const cctx = close.getContext("2d");
  cctx.imageSmoothingQuality = "high";
  cctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, close.width, close.height);
  return {
    ...facts,
    jpeg: await encode(canvas),
    closeup: await encode(close),
    closeupBox: [cx, cy, cx + cw, cy + ch],
    pointer: { ...pt, meant, ...(gesture?.loop ? { box: gesture.box } : {}) },
    gesture: gesture ? { loop: gesture.loop, box: gesture.box } : null,
  };
}

/** The providers read images as `jpeg.toString("base64")` (Node buffers on the desktop); this stands in for one. */
async function b64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const text = btoa(s);
  return { toString: () => text };
}

// ---------------------------------------------------------------- options page

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== "test") return;
  const test = { claude: testClaudeKey, openai: testOpenAiKey, gemini: testGeminiKey }[msg.provider];
  settings()
    .then((s) => test(msg.key, msg.model, clientOptions(msg.provider, s)))
    .then(
      (text) => reply({ ok: true, text }),
      (err) => reply({ ok: false, message: String(err?.status ? `${err.status}: ${err.message}` : err?.message || err).slice(0, 300) }),
    );
  return true; // replies asynchronously
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
