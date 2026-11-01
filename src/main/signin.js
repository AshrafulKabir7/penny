// Browser sign-ins that need no API key. Each one is the provider's own tool doing the sign-in, so Penny never sees a
// password or a token:
//   Claude: Anthropic's CLI (`ant auth login`) signs in to a Claude API (Console) account. The Anthropic SDK then
//           finds that profile by itself. Claude.ai Pro/Max chat logins are not offered: Anthropic doesn't allow
//           third-party apps to use them.
//   Google: Antigravity (`agy`) signs in with a Google account and serves Gemini models.
// (ChatGPT sign-in lives with its provider, in providers/codex.js.)

const { execFile, spawn, spawnSync } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { antigravityCommand, workDir } = require("./providers/cli");

const ANT_RELEASES = "https://github.com/anthropics/anthropic-cli/releases";

function onPath(name) {
  const res = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8", windowsHide: true });
  return (res.stdout || "").split(/\r?\n/).find((p) => p && existsSync(p)) || null;
}

function findAnt() {
  if (process.env.PENNY_ANT && existsSync(process.env.PENNY_ANT)) return process.env.PENNY_ANT;
  return onPath("ant");
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

/** Runs `ant auth login`, which opens the Claude Console sign-in in the browser. */
function claudeSignIn() {
  const exe = findAnt();
  if (!exe) {
    return Promise.reject(Object.assign(new Error("Install Anthropic's CLI (ant) first, then sign in."), { install: ANT_RELEASES }));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ["auth", "login"], { windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Sign-in did not finish (code ${code}).`))));
  });
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

module.exports = { claudeSignInStatus, claudeSignIn, googleAccountStatus, googleSignIn, ANT_RELEASES };
