// Browser sign-ins that need no API key. Each one is the provider's own tool doing the sign-in, so Penny never sees a
// password or a token:
//   Claude: Anthropic's CLI (`ant auth login`) signs in to a Claude API (Console) account. The Anthropic SDK then
//           finds that profile by itself. Claude.ai Pro/Max chat logins are not offered: Anthropic doesn't allow
//           third-party apps to use them.
//   Google: Antigravity (`agy`) signs in with a Google account and serves Gemini models.
// (ChatGPT sign-in lives with its provider, in providers/codex.js.)

const { execFile, spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { antigravityCommand, workDir } = require("./providers/cli");

const ANT_RELEASES = "https://github.com/anthropics/anthropic-cli/releases";
// Where Penny keeps the copy of ant it installs (per user, no admin rights needed).
const ANT_HOME = join(process.env.LOCALAPPDATA || tmpdir(), "Penny", "bin");

function onPath(name) {
  const res = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8", windowsHide: true });
  return (res.stdout || "").split(/\r?\n/).find((p) => p && existsSync(p)) || null;
}

function findAnt() {
  if (process.env.PENNY_ANT && existsSync(process.env.PENNY_ANT)) return process.env.PENNY_ANT;
  const own = join(ANT_HOME, process.platform === "win32" ? "ant.exe" : "ant");
  return onPath("ant") || (existsSync(own) ? own : null);
}

/**
 * Installs Anthropic's CLI from its latest GitHub release: the official Windows build for this machine, checked
 * against the release's SHA-256 checksums, unpacked into ANT_HOME. Resolves with the path to ant.exe.
 */
async function installAnt({ log = () => {}, api = "https://api.github.com/repos/anthropics/anthropic-cli/releases/latest" } = {}) {
  if (process.platform !== "win32") throw Object.assign(new Error("Install Anthropic's CLI (ant) first, then sign in."), { install: ANT_RELEASES });
  const get = async (url, type) => {
    const res = await fetch(url, { headers: { "user-agent": "Penny", accept: type } });
    if (!res.ok) throw new Error(`Couldn't download Anthropic's CLI (${res.status}).`);
    return res;
  };
  const release = await (await get(api, "application/vnd.github+json")).json();
  const version = String(release.tag_name || "").replace(/^v/, "");
  const arch = { arm64: "arm64", ia32: "386" }[process.arch] || "amd64";
  const asset = (name) => release.assets?.find((a) => a.name === name);
  const zip = asset(`ant_${version}_windows_${arch}.zip`);
  const sums = asset(`ant_${version}_checksums.txt`);
  if (!zip || !sums) throw Object.assign(new Error("Anthropic's latest CLI release has no Windows build. Install it by hand."), { install: ANT_RELEASES });
  log(`[ant] downloading ${zip.name} (${(zip.size / 1e6).toFixed(1)} MB)`);
  const checksums = await (await get(sums.browser_download_url, "text/plain")).text();
  const expected = checksums.split(/\r?\n/).find((l) => l.trim().endsWith(` ${zip.name}`))?.split(/\s+/)[0];
  const bytes = Buffer.from(await (await get(zip.browser_download_url, "application/octet-stream")).arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (!expected || actual !== expected.toLowerCase()) throw new Error("The downloaded CLI didn't match Anthropic's checksum, so it wasn't installed.");
  // Windows' own tar unpacks zips (Windows 10 1803 and later).
  const dir = mkdtempSync(join(tmpdir(), "penny-ant-"));
  try {
    writeFileSync(join(dir, zip.name), bytes);
    const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    await new Promise((resolve, reject) => execFile(tar, ["-xf", zip.name], { cwd: dir, windowsHide: true }, (err) => (err ? reject(err) : resolve())));
    const find = (d) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          const hit = find(p);
          if (hit) return hit;
        } else if (name.toLowerCase() === "ant.exe") return p;
      }
      return null;
    };
    const exe = find(dir);
    if (!exe) throw new Error("The CLI download had no ant.exe in it.");
    mkdirSync(ANT_HOME, { recursive: true });
    copyFileSync(exe, join(ANT_HOME, "ant.exe"));
    log(`[ant] installed ${version} in ${ANT_HOME}`);
    return join(ANT_HOME, "ant.exe");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** "signed-in" when the Anthropic SDK will find credentials without a saved key; else "signed-out" or "no-cli". */
function claudeSignInStatus() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "signed-in";
  const dir = process.env.ANTHROPIC_CONFIG_DIR || join(process.env.APPDATA || "", "Anthropic");
  const creds = join(dir, "credentials");
  // Only checks that a profile exists; the token inside is never read here.
  if (existsSync(creds) && readdirSync(creds).some((f) => f.endsWith(".json"))) return "signed-in";
  return findAnt() ? "signed-out" : "no-cli";
}

/**
 * Signs in to a Claude API (Console) account with `ant auth login`, installing ant first if it is missing. The login
 * runs in its own console window, so any link or code it shows is visible; resolves when that window closes signed in.
 */
async function claudeSignIn({ log = () => {} } = {}) {
  const exe = findAnt() || (await installAnt({ log }));
  await new Promise((resolve, reject) => {
    // `start /wait` opens a console window and waits for it to close; verbatim, so the quoted title and path stay intact.
    const args = process.platform === "win32" ? ["/d", "/c", "start", "\"Penny - sign in with Claude\"", "/wait", `"${exe}"`, "auth", "login"] : null;
    const child = args ? spawn("cmd.exe", args, { windowsHide: false, windowsVerbatimArguments: true, stdio: "ignore" }) : spawn(exe, ["auth", "login"], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", () => resolve());
  });
  if (claudeSignInStatus() !== "signed-in") throw new Error("Claude sign-in didn't finish. Try again.");
}

/** Resolves "signed-in", "signed-out" or "missing" by asking Antigravity for its models (a few seconds). */
function googleAccountStatus() {
  const cmd = antigravityCommand(["models"]);
  if (cmd.file === "agy" && !onPath("agy")) return Promise.resolve("missing");
  return new Promise((resolve) => {
    execFile(cmd.file, cmd.args, { cwd: workDir(), windowsHide: true, timeout: 60_000 }, (err, stdout = "") => {
      if (err?.code === "ENOENT") return resolve("missing");
      resolve(/^[a-z0-9][a-z0-9._-]*\t/m.test(stdout) ? "signed-in" : "signed-out");
    });
  });
}

/** Opens Antigravity in its own window, where its first run signs in with Google. */
function googleSignIn() {
  const cmd = antigravityCommand([]);
  if (cmd.file === "agy" && !onPath("agy")) return Promise.reject(new Error("Install Antigravity first, then sign in with Google."));
  spawn("cmd.exe", ["/c", "start", "Penny - sign in with Google", cmd.file], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  return Promise.resolve();
}

module.exports = { claudeSignInStatus, claudeSignIn, installAnt, findAnt, googleAccountStatus, googleSignIn, ANT_RELEASES, ANT_HOME };
