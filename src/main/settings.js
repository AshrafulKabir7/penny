// Settings kept in the user's app-data folder.

const { app } = require("electron");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { DEFAULT_MODEL } = require("./providers");

const DEFAULTS = {
  model: DEFAULT_MODEL,
  effort: "off",
  talkHotkey: "Control+Alt+Space",
  typeHotkey: "Control+Alt+T",
  clearHotkey: "Escape",
  voice: "neural", // neural | system | muted
  voiceName: "en-US-AndrewMultilingualNeural",
  language: "en",
  captions: true,
  wakeWord: false,
  hideFromCapture: false,
  whisperModel: "base",
  python: "",
  devServer: false,
  devPort: 8791,
};

let cache = null;

function file() {
  return join(app.getPath("userData"), "settings.json");
}

function load() {
  if (cache) return cache;
  let saved = {};
  try {
    if (existsSync(file())) saved = JSON.parse(readFileSync(file(), "utf8"));
  } catch {}
  cache = { ...DEFAULTS, ...saved };
  return cache;
}

function update(patch) {
  cache = { ...load(), ...patch };
  try {
    writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch {}
  return cache;
}

module.exports = { load, update, DEFAULTS };
