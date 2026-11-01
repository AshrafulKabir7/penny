// Registers Penny as a native messaging host for Chrome and Edge, so Penny for Chrome can use the accounts signed in
// here (src/native/host.js). Runs at every start: it writes a launcher and a host manifest into Penny's data folder
// and points the browsers' per-user registry keys at it. Nothing is installed system-wide.

const { execFile } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const HOST = "app.penny.host";
// Penny for Chrome's ID (fixed by the "key" in extension/manifest.json).
const EXTENSION_IDS = ["mnpcmhoideneafghojodngbcomangdbg"];
const BROWSER_KEYS = ["HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts", "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts"];

/** `exe` is Penny's executable (it runs the host script as Node), `script` the host, `dir` where to write the files. */
function registerNativeHost({ exe, script, dir, log = () => {} }) {
  if (process.platform !== "win32") return Promise.resolve(false);
  mkdirSync(dir, { recursive: true });
  const launcher = join(dir, "penny-host.cmd");
  writeFileSync(launcher, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${script}" %*\r\n`);
  const manifest = join(dir, `${HOST}.json`);
  writeFileSync(
    manifest,
    JSON.stringify(
      {
        name: HOST,
        description: "Penny: lets Penny for Chrome use the accounts signed in on this PC",
        path: launcher,
        type: "stdio",
        allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
      },
      null,
      2,
    ),
  );
  const add = (key) =>
    new Promise((resolve) => execFile("reg", ["add", `${key}\\${HOST}`, "/ve", "/t", "REG_SZ", "/d", manifest, "/f"], { windowsHide: true }, (err) => resolve(!err)));
  return Promise.all(BROWSER_KEYS.map(add)).then((ok) => {
    if (!ok.every(Boolean)) log(`[native] registering the browser host failed for ${BROWSER_KEYS.filter((_, i) => !ok[i]).join(", ")}`);
    return ok.some(Boolean);
  });
}

module.exports = { registerNativeHost, HOST, EXTENSION_IDS };
