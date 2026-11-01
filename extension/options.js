// Penny for Chrome settings: the model, the user's own API keys (chrome.storage.local, never synced), accounts signed
// in through the Penny app, and voice.

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
  renderAccounts();
}

// ---------------------------------------------------------------- accounts (through the Penny app)

let accounts = null; // the app's answer: { installed, chatgpt, claude, google }
const STATE = { "signed-in": "signed in", "signed-out": "not signed in", missing: "not installed", "no-cli": "ant CLI not installed" };

function renderAccounts() {
  $("#no-app").hidden = !accounts || accounts.installed;
  for (const box of $$(".account")) {
    const state = accounts?.installed ? accounts[box.dataset.account] : accounts ? "unavailable" : "checking";
    const el = $(".state", box);
    el.textContent = STATE[state] || (state === "checking" ? "checking…" : "needs the Penny app");
    el.classList.toggle("saved", state === "signed-in");
    $(".signin", box).hidden = state === "signed-in";
    $(".signin", box).disabled = !accounts?.installed;
    const use = $(".use", box);
    use.hidden = state !== "signed-in";
    use.disabled = s?.provider === box.dataset.provider;
    use.textContent = use.disabled ? "In use" : `Use ${$("h3", box).firstChild.textContent.trim()}`;
  }
}

async function checkAccounts() {
  accounts = null;
  renderAccounts();
  accounts = await chrome.runtime.sendMessage({ type: "accounts" }).catch(() => ({ installed: false }));
  renderAccounts();
}

for (const box of $$(".account")) {
  const result = $(".result", box);
  const say = (html, ok) => {
    result.innerHTML = html;
    result.className = `result ${ok == null ? "" : ok ? "ok" : "bad"}`;
  };
  $(".signin", box).addEventListener("click", async () => {
    say("Finish signing in in the window that opened…", null);
    const res = await chrome.runtime.sendMessage({ type: "login", account: box.dataset.account });
    if (res?.error) {
      const link = /^https:\/\//.test(res.install || "") ? ` <a href="${res.install}" target="_blank" rel="noreferrer">Get it here</a>.` : "";
      return say(`${res.error.replace(/[<>&]/g, "")}${link}`, false);
    }
    say(box.dataset.account === "google" ? "Sign in with Google in the Antigravity window, then press Check again." : "Signed in.", true);
    await checkAccounts();
    if (accounts?.[box.dataset.account] === "signed-in") save({ provider: box.dataset.provider });
  });
  $(".use", box).addEventListener("click", () => save({ provider: box.dataset.provider }));
}
$("#recheck").addEventListener("click", checkAccounts);

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
checkAccounts();
