// Penny for Chrome settings: the model, the user's own API keys (chrome.storage.local, never synced), and voice.

import { MODELS, loadSettings } from "./models.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
let s = null;

const save = (patch) => chrome.storage.local.set(patch);
const hint = (key) => (key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "saved");

function render() {
  for (const r of $$("input[name=provider]")) r.checked = r.value === s.provider;
  $("#models").innerHTML = MODELS[s.provider].map((m) => `<option value="${m}"></option>`).join("");
  $("#model").value = s.models[s.provider];
  $("#effort").value = s.effort;
  $("#speak").checked = s.speak;
  $("#captions").checked = s.captions;
  for (const box of $$(".key")) {
    const key = s.keys[box.dataset.key];
    const state = $(".state", box);
    state.textContent = key ? hint(key) : "not added";
    state.classList.toggle("saved", !!key);
    $(".test", box).disabled = !key;
    $(".remove", box).disabled = !key;
  }
}

async function refresh() {
  s = await loadSettings();
  render();
}

for (const r of $$("input[name=provider]")) r.addEventListener("change", () => save({ provider: r.value }));
$("#model").addEventListener("change", (e) => {
  const model = e.target.value.trim();
  if (model) save({ models: { ...s.models, [s.provider]: model } });
});
$("#effort").addEventListener("change", (e) => save({ effort: e.target.value }));
$("#speak").addEventListener("change", (e) => save({ speak: e.target.checked }));
$("#captions").addEventListener("change", (e) => save({ captions: e.target.checked }));

for (const box of $$(".key")) {
  const input = $("input", box);
  const result = $(".result", box);
  const say = (text, ok) => {
    result.textContent = text;
    result.className = `result ${ok == null ? "" : ok ? "ok" : "bad"}`;
  };
  $(".save", box).addEventListener("click", async () => {
    const key = input.value.trim();
    if (key.length < 20 || /\s/.test(key)) return say("That doesn't look like an API key.", false);
    await save({ keys: { ...s.keys, [box.dataset.key]: key } });
    input.value = "";
    say("Saved. Test it to be sure it works.", true);
  });
  $(".remove", box).addEventListener("click", async () => {
    const keys = { ...s.keys };
    delete keys[box.dataset.key];
    await save({ keys });
    say("Removed from this browser.", null);
  });
  $(".test", box).addEventListener("click", async () => {
    const provider = box.dataset.provider;
    say("Testing…", null);
    const res = await chrome.runtime.sendMessage({ type: "test", provider, key: s.keys[box.dataset.key], model: s.models[provider] });
    say(res?.ok ? `Works with ${s.models[provider]}.` : `Didn't work: ${res?.message || "no answer"}`, !!res?.ok);
  });
  input.addEventListener("keydown", (e) => e.key === "Enter" && $(".save", box).click());
}

$("#shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
chrome.commands.getAll().then((commands) => {
  const key = commands.find((c) => c.name === "_execute_action")?.shortcut;
  $("#shortcut").textContent = key || "your shortcut (none set yet)"; // the suggested one is skipped if it clashes
});

chrome.storage.onChanged.addListener(refresh);
refresh();
