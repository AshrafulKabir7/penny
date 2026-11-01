// Finding and stopping the two CLIs.

const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

function onPath(name) {
  const res = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8", windowsHide: true });
  const first = (res.stdout || "").split(/\r?\n/).find(Boolean);
  return first && existsSync(first) ? first : undefined;
}

/** A real Node binary; Electron's own binary can stand in when run as node. */
function nodeCommand() {
  const candidates = [process.env.PENNY_NODE, join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"), onPath("node")];
  const found = candidates.find((p) => p && existsSync(p));
  if (found) return { file: found, env: {} };
  return { file: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

/** How to start Command Code: `{ file, args, env, shell }`. */
function commandCodeCommand(extraArgs) {
  if (process.env.CMD_BIN) return { file: process.env.CMD_BIN, args: extraArgs, env: {}, shell: true };
  const entry = join(process.env.APPDATA || "", "npm", "node_modules", "command-code", "dist", "index.mjs");
  if (existsSync(entry)) {
    const node = nodeCommand();
    return { file: node.file, args: [entry, ...extraArgs], env: node.env, shell: false };
  }
  return { file: "command-code", args: extraArgs, env: {}, shell: process.platform === "win32" };
}

function antigravityCommand(extraArgs) {
  if (process.env.AGY_BIN) return { file: process.env.AGY_BIN, args: extraArgs, env: {}, shell: false };
  const exe = join(process.env.LOCALAPPDATA || "", "agy", "bin", "agy.exe");
  return { file: existsSync(exe) ? exe : "agy", args: extraArgs, env: {}, shell: false };
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
  else child.kill("SIGTERM");
}

/** An empty folder for the CLIs to run in, so nothing of the user's is within their reach. */
function workDir(...parts) {
  const dir = join(process.env.PENNY_WORK_DIR || join(tmpdir(), "penny-cli"), ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Splits a stream of text into lines and hands each parsed JSON object to `onObject`. */
function jsonLines(onObject) {
  let buf = "";
  return (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("{")) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      onObject(obj);
    }
  };
}

module.exports = { commandCodeCommand, antigravityCommand, killTree, workDir, jsonLines };
