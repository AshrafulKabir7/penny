// API keys a user enters for their own accounts. They are encrypted with Windows' per-user data protection (Electron
// safeStorage) and kept in the app-data folder, never in the project, the log or the overlay. The Accounts window only
// ever gets a masked hint back.

const { app, safeStorage } = require("electron");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const PROVIDERS = new Set(["anthropic", "openai", "google"]);

function file() {
  return join(app.getPath("userData"), "credentials.json");
}

function readAll() {
  try {
    return JSON.parse(readFileSync(file(), "utf8"));
  } catch {
    return {};
  }
}

function writeAll(data) {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(file(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

/** The decrypted key, or null. Only providers call this, at request time. */
function getKey(provider) {
  const sealed = readAll()[provider];
  if (!sealed) return null;
  try {
    return safeStorage.decryptString(Buffer.from(sealed, "base64"));
  } catch {
    return null; // sealed under another Windows account, or damaged
  }
}

function setKey(provider, key) {
  if (!PROVIDERS.has(provider)) throw new Error(`Unknown provider ${provider}`);
  const value = String(key || "").trim();
  if (value.length < 20 || /\s/.test(value)) throw new Error("That doesn't look like an API key.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows can't encrypt the key for this account, so it was not saved.");
  const data = readAll();
  data[provider] = safeStorage.encryptString(value).toString("base64");
  writeAll(data);
}

function removeKey(provider) {
  const data = readAll();
  delete data[provider];
  writeAll(data);
}

/** e.g. "sk-ant…9xQz": enough to recognise the key, useless to anyone else. */
function hint(provider) {
  const key = getKey(provider);
  return key ? `${key.slice(0, 6)}…${key.slice(-4)}` : null;
}

module.exports = { getKey, setKey, removeKey, hint };
