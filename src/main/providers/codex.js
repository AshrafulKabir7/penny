// ChatGPT through OpenAI's Codex CLI, signed in with the user's own ChatGPT account. `codex login` runs the sign-in in
// their browser, so Penny never sees a password or a token. Each question is one `codex exec` run in an empty
// folder with a read-only sandbox; follow-ups resume the same Codex thread. Codex hands back the reply in one piece,
// so drawing starts once it is complete (slower to first stroke than the streaming providers).

const { execFile, spawn, spawnSync } = require("node:child_process");
const { existsSync, readdirSync, statSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { workDir, killTree, jsonLines } = require("./cli");
const { buildTurn } = require("../prompt");

const EFFORT = { off: "low", low: "low", default: "medium", high: "high" };

/** The Codex CLI: PENNY_CODEX, `codex` on PATH, or the copy the Codex desktop app ships. */
function findCodex() {
  if (process.env.PENNY_CODEX && existsSync(process.env.PENNY_CODEX)) return process.env.PENNY_CODEX;
  const where = spawnSync(process.platform === "win32" ? "where" : "which", ["codex"], { encoding: "utf8", windowsHide: true });
  const onPath = (where.stdout || "").split(/\r?\n/).find((p) => p && existsSync(p));
  if (onPath) return onPath;
  const bin = join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin");
  if (!existsSync(bin)) return null;
  const builds = readdirSync(bin)
    .map((d) => join(bin, d, "codex.exe"))
    .filter((p) => existsSync(p))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return builds[0] || null;
}

/** Resolves "signed-in", "signed-out" or "missing" (no Codex CLI), without blocking the app. */
function codexStatus() {
  const exe = findCodex();
  if (!exe) return Promise.resolve("missing");
  return new Promise((resolve) => {
    execFile(exe, ["login", "status"], { windowsHide: true, timeout: 20_000 }, (_err, stdout = "", stderr = "") => {
      const out = `${stdout}${stderr}`;
      resolve(/logged in/i.test(out) && !/not logged in/i.test(out) ? "signed-in" : "signed-out");
    });
  });
}

/** Runs `codex login`, which opens the ChatGPT sign-in in the user's browser. Resolves when it finishes. */
function codexLogin() {
  const exe = findCodex();
  if (!exe) return Promise.reject(new Error("The Codex CLI isn't installed. Install the Codex app or `npm i -g @openai/codex`."));
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ["login"], { windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Sign-in did not finish (code ${code}).`))));
  });
}

class CodexProvider {
  constructor({ model, log = () => {} }) {
    this.kind = "codex";
    this.model = model; // "default" uses the account's default model
    this.log = log;
    this.effort = "off";
    this.threadId = null;
    this.turnCount = 0;
    this.child = null;
  }

  get label() {
    return `ChatGPT (Codex)${this.model === "default" ? "" : ` · ${this.model}`}`;
  }

  get turns() {
    return this.turnCount;
  }

  warm() {
    return Promise.resolve();
  }

  async ask({ question, shot, visualsOnScreen, onDelta }) {
    const exe = findCodex();
    if (!exe) throw Object.assign(new Error("Install the Codex app (or the Codex CLI) and sign in with ChatGPT to use your ChatGPT account."), { needsKey: true });
    const dir = workDir("codex");
    const stamp = Date.now().toString(36);
    const shotFile = `screen-${stamp}.jpg`;
    writeFileSync(join(dir, shotFile), shot.jpeg);
    const images = ["-i", shotFile];
    let closeupRef = null;
    if (shot.closeup) {
      const closeFile = `pointer-${stamp}.jpg`;
      writeFileSync(join(dir, closeFile), shot.closeup);
      images.push("-i", closeFile);
      closeupRef = "the second attached image";
    }
    const firstTurn = !this.threadId;
    const text = buildTurn({ question, shot, imageRef: "inline", closeupRef, firstTurn, visualsOnScreen });
    const common = ["--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-c", `model_reasoning_effort="${EFFORT[this.effort] || "low"}"`];
    if (this.model !== "default") common.push("-m", this.model);
    const args = firstTurn ? ["exec", ...common, "-s", "read-only", ...images, "-"] : ["exec", "resume", this.threadId, ...common, ...images, "-"];
    try {
      const reply = await this._run(exe, args, dir, text);
      this.turnCount++;
      onDelta(reply);
      return { text: reply };
    } finally {
      for (const f of [shotFile, `pointer-${stamp}.jpg`]) rmSync(join(dir, f), { force: true });
    }
  }

  _run(exe, args, cwd, prompt) {
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args, { cwd, windowsHide: true, env: { ...process.env, NO_COLOR: "1" } });
      this.child = child;
      let reply = "";
      let failure = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on(
        "data",
        jsonLines((msg) => {
          if (msg.type === "thread.started" && msg.thread_id) this.threadId = msg.thread_id;
          else if (msg.type === "item.completed" && msg.item?.type === "agent_message") reply += (reply ? "\n" : "") + (msg.item.text || "");
          else if (msg.type === "error" || msg.type === "turn.failed") failure = msg.message || msg.error?.message || failure || "Codex failed";
        }),
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
      child.on("error", reject);
      child.on("exit", (code) => {
        this.child = null;
        if (this.cancelled) {
          this.cancelled = false;
          return reject(Object.assign(new Error("cancelled"), { cancelled: true }));
        }
        if (reply) return resolve(reply);
        const why = failure || stderr.trim().split(/\r?\n/).pop() || `Codex exited with code ${code}`;
        if (/not logged in|login|unauthori[sz]ed|401/i.test(why)) {
          return reject(Object.assign(new Error("Sign in with ChatGPT in Accounts (tray menu) to use your ChatGPT account."), { needsKey: true }));
        }
        reject(new Error(why));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    });
  }

  cancel() {
    if (!this.child) return;
    this.cancelled = true;
    killTree(this.child);
  }

  newTopic() {
    this.threadId = null;
    this.turnCount = 0;
  }

  dispose() {
    this.cancel();
  }
}

module.exports = { CodexProvider, codexStatus, codexLogin, findCodex };
