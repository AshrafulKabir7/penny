// Command Code through its ACP mode (`cmd acp`): one warm process, JSON-RPC over stdio, the screenshot sent inline.
//
// Sessions run in plan mode in an empty folder and every permission request is refused, so the agent can only answer.
// A spare session is created ahead of time, so starting a new topic costs nothing.

const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { commandCodeCommand, killTree, workDir, jsonLines } = require("./cli");
const { buildTurn } = require("../prompt");

class AcpProvider extends EventEmitter {
  constructor({ model, effort = "off", log = () => {} }) {
    super();
    this.kind = "cmd";
    this.model = model;
    this.effort = effort;
    this.log = log;
    this.child = null;
    this.nextId = 0;
    this.pending = new Map();
    this.session = null; // { id, turns }
    this.spare = null; // Promise<{ id, turns }>
    this.ready = null; // Promise<void>
    this.chunkSink = null;
  }

  get label() {
    return `Command Code · ${this.model}`;
  }

  warm() {
    if (!this.ready) {
      this.ready = this._start().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  async _start() {
    const dir = workDir("acp");
    const cmd = commandCodeCommand(["acp"]);
    const started = Date.now();
    const child = spawn(cmd.file, cmd.args, {
      cwd: dir,
      shell: cmd.shell,
      windowsHide: true,
      env: { ...process.env, ...cmd.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    this.child = child;
    this.dir = dir;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", jsonLines((msg) => this._onMessage(msg)));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => {
      const line = d.trim();
      if (line && !line.startsWith("[acp]")) this.log(`[cmd] ${line.slice(0, 300)}`);
    });
    child.on("exit", (code) => {
      this.log(`[cmd] acp exited (${code})`);
      for (const p of this.pending.values()) p.reject(new Error("Command Code stopped"));
      this.pending.clear();
      if (this.child === child) {
        this.child = null;
        this.ready = null;
        this.session = null;
        this.spare = null;
      }
    });
    child.stdin.on("error", () => {});

    const init = await this._rpc("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    if (!init?.agentCapabilities?.promptCapabilities?.image) this.log("[cmd] warning: agent does not advertise image input");
    this.session = await this._newSession();
    this.spare = this._newSession().catch(() => null);
    this.log(`[cmd] ready in ${((Date.now() - started) / 1000).toFixed(1)}s (${this.model})`);
  }

  async _newSession() {
    const s = await this._rpc("session/new", { cwd: this.dir, mcpServers: [] });
    const id = s.sessionId;
    await this._rpc("session/set_config_option", { sessionId: id, configId: "model", value: this.model });
    // Thinking first costs 15-20 s before the first word; Penny needs to start talking at once.
    await this._rpc("session/set_config_option", { sessionId: id, configId: "effort", value: this.effort }).catch(() => {});
    await this._rpc("session/set_mode", { sessionId: id, modeId: "plan" }).catch(() => {});
    return { id, turns: 0 };
  }

  _rpc(method, params) {
    if (!this.child) return Promise.reject(new Error("Command Code is not running"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  _notify(method, params) {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  _onMessage(msg) {
    if (msg.id != null && this.pending.has(msg.id) && (msg.result !== undefined || msg.error)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === "session/update") {
      const u = msg.params?.update;
      if (msg.params?.sessionId !== this.session?.id) return;
      if (u?.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") this.chunkSink?.(u.content.text);
      return;
    }
    if (msg.method === "session/request_permission" && msg.id != null) {
      // Penny's model only answers; it never gets to run tools.
      this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { outcome: { outcome: "cancelled" } } })}\n`);
      return;
    }
    if (msg.method && msg.id != null) {
      this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Not supported" } })}\n`);
    }
  }

  /** Streams one answer. `onDelta(text)` gets the reply as it is written. */
  async ask({ question, shot, visualsOnScreen, onDelta }) {
    await this.warm();
    if (!this.session) this.session = await this._newSession();
    const session = this.session;
    const closeupRef = shot.closeup ? "the second attached image" : null;
    const text = buildTurn({ question, shot, imageRef: "inline", closeupRef, firstTurn: session.turns === 0, visualsOnScreen });
    const images = [shot.jpeg, shot.closeup].filter(Boolean).map((jpeg) => ({ type: "image", mimeType: "image/jpeg", data: jpeg.toString("base64") }));
    let full = "";
    this.chunkSink = (t) => {
      full += t;
      onDelta(t);
    };
    try {
      const res = await this._rpc("session/prompt", {
        sessionId: session.id,
        prompt: [{ type: "text", text }, ...images],
      });
      session.turns++;
      if (res?.stopReason === "cancelled") throw Object.assign(new Error("cancelled"), { cancelled: true });
      return { text: full, usage: res?.usage };
    } finally {
      this.chunkSink = null;
    }
  }

  cancel() {
    if (this.session) this._notify("session/cancel", { sessionId: this.session.id });
  }

  /** Forget the conversation; the next question starts fresh. */
  async newTopic() {
    if (!this.child) return;
    const old = this.session;
    this.session = (await this.spare) || null;
    this.spare = this._newSession().catch(() => null);
    if (old) this._rpc("session/close", { sessionId: old.id }).catch(() => {});
  }

  get turns() {
    return this.session?.turns ?? 0;
  }

  dispose() {
    killTree(this.child);
    this.child = null;
  }
}

module.exports = { AcpProvider };
