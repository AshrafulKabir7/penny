// Antigravity through `agy --input-format stream-json`: one process holds one conversation and runs a turn for every
// line written to its stdin. agy only takes text, so the screenshot is written into the process's empty working
// folder and the model is told to open it. A standby process is started ahead of time for the next topic.

const { spawn } = require("node:child_process");
const { writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { antigravityCommand, killTree, workDir, jsonLines } = require("./cli");
const { buildTurn } = require("../prompt");

let folderSeq = 0;

class AgyProcess {
  constructor(model, log) {
    this.model = model;
    this.log = log;
    this.dir = workDir("agy", `${Date.now().toString(36)}-${folderSeq++}`);
    this.turns = 0;
    this.sink = null; // { delta, done, fail }
    const cmd = antigravityCommand([
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--model", model,
      "--disable-slash-commands",
      "--print=",
    ]);
    const started = Date.now();
    this.child = spawn(cmd.file, cmd.args, { cwd: this.dir, shell: cmd.shell, windowsHide: true, env: { ...process.env, ...cmd.env, NO_COLOR: "1" } });
    this.ready = new Promise((resolve, reject) => {
      this._ready = resolve;
      this._notReady = reject;
    });
    this.ready.catch(() => {});
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", jsonLines((msg) => this._onMessage(msg, started)));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (d) => d.trim() && this.log(`[agy] ${d.trim().slice(0, 300)}`));
    this.child.stdin.on("error", () => {});
    this.child.on("exit", (code) => {
      this.exited = true;
      this._notReady(new Error(`Antigravity exited (${code})`));
      this.sink?.fail(new Error(`Antigravity exited (${code})`));
      this.sink = null;
    });
    // agy reports "init" when its conversation is ready; older builds only start talking after the first message.
    this.readyTimer = setTimeout(() => this._ready(), 20_000);
  }

  _onMessage(msg, started) {
    if (msg.event === "init") {
      clearTimeout(this.readyTimer);
      this.log(`[agy] ready in ${((Date.now() - started) / 1000).toFixed(1)}s (${this.model})`);
      this._ready();
      return;
    }
    const step = msg.step_update;
    if (msg.event === "step_update" && step?.step_type === "agent_response" && step.text_delta) {
      this.sink?.delta(step.text_delta);
    } else if (msg.event === "result") {
      const r = msg.result ?? {};
      const sink = this.sink;
      this.sink = null;
      if (r.status === "SUCCESS") sink?.done(r);
      else sink?.fail(new Error(r.error || `Antigravity turn ended with ${r.status}`));
    }
  }

  turn(text, onDelta) {
    return new Promise((resolve, reject) => {
      let full = "";
      this.sink = {
        delta: (t) => {
          full += t;
          onDelta(t);
        },
        done: (r) => resolve({ text: full || r.response || "", usage: r.usage }),
        fail: reject,
      };
      this.child.stdin.write(`${JSON.stringify({ event: "user", message: { role: "user", content: text } })}\n`);
    });
  }

  dispose() {
    clearTimeout(this.readyTimer);
    killTree(this.child);
    setTimeout(() => rmSync(this.dir, { recursive: true, force: true }), 2000);
  }
}

class AgyProvider {
  constructor({ model, log = () => {} }) {
    this.kind = "agy";
    this.model = model;
    this.log = log;
    this.current = null;
    this.standby = null;
  }

  get label() {
    return `Antigravity · ${this.model}`;
  }

  warm() {
    if (!this.current || this.current.exited) this.current = new AgyProcess(this.model, this.log);
    if (!this.standby || this.standby.exited) this.standby = new AgyProcess(this.model, this.log);
    return this.current.ready;
  }

  async ask({ question, shot, visualsOnScreen, onDelta }) {
    this.warm();
    const proc = this.current;
    await proc.ready;
    const file = `screen-${proc.turns + 1}.jpg`;
    writeFileSync(join(proc.dir, file), shot.jpeg);
    let closeupRef = null;
    if (shot.closeup) {
      const closeup = `pointer-${proc.turns + 1}.jpg`;
      writeFileSync(join(proc.dir, closeup), shot.closeup);
      closeupRef = `the file ${closeup} (open it too)`;
    }
    const text = buildTurn({ question, shot, imageRef: file, closeupRef, firstTurn: proc.turns === 0, visualsOnScreen });
    this.busy = proc;
    try {
      const res = await proc.turn(text, onDelta);
      proc.turns++;
      return res;
    } catch (err) {
      if (this.cancelled === proc) throw Object.assign(new Error("cancelled"), { cancelled: true });
      throw err;
    } finally {
      this.busy = null;
    }
  }

  /** agy has no cancel message, so the process is dropped and the standby takes over. */
  cancel() {
    if (!this.busy) return;
    this.cancelled = this.busy;
    this.newTopic();
  }

  newTopic() {
    const old = this.current;
    this.current = this.standby && !this.standby.exited ? this.standby : null;
    this.standby = null;
    old?.dispose();
    // Start the next standby a little later so it does not compete with the turn that is about to run.
    setTimeout(() => this.warm(), 4000);
  }

  get turns() {
    return this.current?.turns ?? 0;
  }

  dispose() {
    this.current?.dispose();
    this.standby?.dispose();
    this.current = this.standby = null;
  }
}

module.exports = { AgyProvider };
