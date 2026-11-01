// Runs the Python voice worker (Whisper speech-to-text, edge-tts voices) and talks to it over JSON lines.

const { spawn } = require("node:child_process");
const { mkdirSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");

const SCRIPT = join(__dirname, "..", "..", "voice", "talky_voice.py");

class VoiceWorker {
  constructor({ log = () => {}, python, whisperModel = "base" }) {
    this.log = log;
    this.python = python;
    this.whisperModel = whisperModel;
    this.child = null;
    this.pending = new Map();
    this.nextId = 0;
    this.sttReady = false;
    this.sttError = null;
    this.ttsBroken = false;
    this.dir = join(tmpdir(), "talky-voice");
    mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir)) rmSync(join(this.dir, f), { force: true });
  }

  start() {
    if (this.child) return;
    const [file, ...pre] = this.python ? [this.python] : process.platform === "win32" ? ["py", "-3"] : ["python3"];
    const child = spawn(file, [...pre, "-u", SCRIPT], {
      windowsHide: true,
      env: { ...process.env, TALKY_WHISPER_MODEL: this.whisperModel, PYTHONIOENCODING: "utf-8" },
    });
    this.child = child;
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        try {
          this._onMessage(JSON.parse(line));
        } catch {}
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => {
      const text = d.trim();
      if (text && !/FP16 is not supported|UserWarning|warnings.warn/.test(text)) this.log(`[voice] ${text.slice(0, 400)}`);
    });
    child.on("error", (err) => {
      this.sttError = `Python could not start (${err.message})`;
      this.log(`[voice] ${this.sttError}`);
    });
    child.on("exit", (code) => {
      this.log(`[voice] worker exited (${code})`);
      for (const p of this.pending.values()) p.reject(new Error("voice worker stopped"));
      this.pending.clear();
      this.child = null;
      this.sttReady = false;
    });
  }

  _onMessage(msg) {
    if (msg.event === "stt_ready") {
      this.sttReady = true;
      this.log(`[voice] whisper ${this.whisperModel} ready`);
    } else if (msg.event === "stt_failed") {
      this.sttError = msg.error;
      this.log(`[voice] whisper failed: ${msg.error}`);
    }
    if (msg.id == null || !this.pending.has(msg.id)) return;
    const p = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg);
  }

  _request(req) {
    this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ ...req, id })}\n`);
    });
  }

  /** `pcm` is 16 kHz mono float32 samples (Buffer or ArrayBuffer). */
  async transcribe(pcm, { language = "en", prompt } = {}) {
    if (this.sttError) throw new Error(`Speech recognition unavailable: ${this.sttError}`);
    const path = join(this.dir, `clip-${Date.now()}.f32`);
    writeFileSync(path, Buffer.from(pcm));
    try {
      const res = await this._request({ op: "stt", path, language, prompt });
      return res.text || "";
    } finally {
      setTimeout(() => rmSync(path, { force: true }), 1000);
    }
  }

  /** Synthesises one sentence with a neural voice; resolves with a file URL, or null if that is not working. */
  async synth(text, voice) {
    if (this.ttsBroken) return null;
    const out = join(this.dir, `say-${Date.now()}-${this.nextId}.mp3`);
    try {
      await this._request({ op: "tts", text, voice, out });
      setTimeout(() => rmSync(out, { force: true }), 120_000);
      return pathToFileURL(out).href;
    } catch (err) {
      this.failures = (this.failures || 0) + 1;
      this.log(`[voice] tts failed: ${err.message}`);
      if (this.failures >= 3) this.ttsBroken = true; // stop trying; the overlay falls back to the Windows voice
      return null;
    }
  }

  dispose() {
    this.child?.kill();
    this.child = null;
  }
}

module.exports = { VoiceWorker };
