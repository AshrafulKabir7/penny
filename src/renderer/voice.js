// Voice in and out for the overlay.
//
// Speaker: every sentence is synthesised the moment it is parsed (neural voice through the main process when it
// works, the best installed Windows voice otherwise) and played strictly in order.
// Mic: 16 kHz mono capture with a simple adaptive level gate that decides when the user has finished talking.

export class Speaker {
  constructor({ synth, onState = () => {}, muted = false }) {
    this.synth = synth; // async (text) => audio URL | null
    this.onState = onState;
    this.muted = muted;
    this.active = 0;
    this.current = null;
    this.engine = synth ? "neural" : "system";
    this.voice = null;
    if ("speechSynthesis" in window) {
      const pick = () => {
        const voices = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("en"));
        const rank = (v) => ["Natural", "Aria", "Jenny", "Guy", "Andrew", "Ava", "Mark", "Zira", "David"].findIndex((n) => v.name.includes(n));
        this.voice = voices.sort((a, b) => (rank(a) < 0 ? 99 : rank(a)) - (rank(b) < 0 ? 99 : rank(b)))[0] || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
  }

  prepare(text) {
    const item = { text, url: null, stopped: false };
    item.url = this.muted || this.engine !== "neural" ? Promise.resolve(null) : this.synth(text).catch(() => null);
    return item;
  }

  _setActive(delta) {
    this.active += delta;
    this.onState(this.active > 0);
  }

  async play(item) {
    if (this.muted || item.stopped) return;
    this._setActive(1);
    try {
      const url = await item.url;
      if (item.stopped) return;
      if (url) await this._playUrl(url, item);
      else await this._speakSystem(item);
    } finally {
      this._setActive(-1);
    }
  }

  _playUrl(url, item) {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      this.current = { item, stop: () => (audio.pause(), resolve()) };
      audio.onended = audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  }

  _speakSystem(item) {
    if (!("speechSynthesis" in window)) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(item.text);
      if (this.voice) u.voice = this.voice;
      u.rate = 1.05;
      u.onend = u.onerror = () => resolve();
      this.current = { item, stop: () => (speechSynthesis.cancel(), resolve()) };
      speechSynthesis.speak(u);
    });
  }

  stop() {
    this.current?.item && (this.current.item.stopped = true);
    this.current?.stop();
    this.current = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
}

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("penny-tap", Tap);
`;

export class Mic {
  constructor({ onLevel = () => {} } = {}) {
    this.onLevel = onLevel;
    this.ctx = null;
    this.noise = 0.006;
    this.holding = false; // push-to-talk: no stopping on silence
    this.listener = null; // receives every 100 ms block: (block, rms)
  }

  async open() {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "penny-tap");
    src.connect(this.node);
    let block = new Float32Array(1600);
    let fill = 0;
    this.node.port.onmessage = (e) => {
      const data = e.data;
      for (let i = 0; i < data.length; i++) {
        block[fill++] = data[i];
        if (fill === block.length) {
          let sum = 0;
          for (let j = 0; j < block.length; j++) sum += block[j] * block[j];
          const rms = Math.sqrt(sum / block.length);
          this.onLevel(Math.min(1, rms * 12));
          this.listener?.(block, rms);
          block = new Float32Array(1600);
          fill = 0;
        }
      }
    };
  }

  /**
   * Records one utterance: waits for speech, then stops after `silenceMs` of quiet.
   * Resolves with 16 kHz Float32 samples, or null if nobody spoke. `stop()` ends it early.
   */
  record({ silenceMs = 1100, maxMs = 25000, noSpeechMs = 7000 } = {}) {
    this.holding = false;
    return new Promise((resolve) => {
      const blocks = [];
      let spoke = false;
      let quiet = 0;
      let loudRun = 0;
      let elapsed = 0;
      const done = (keep) => {
        this.listener = null;
        this._stop = null;
        // Held-key recordings go to Whisper even if the level gate never fired (a quiet voice); Whisper decides.
        if (!keep || (!spoke && !(this.holding && blocks.length >= 5))) return resolve(null);
        const out = new Float32Array(blocks.length * 1600);
        blocks.forEach((b, i) => out.set(b, i * 1600));
        resolve(out);
      };
      this._stop = (keep = true) => done(keep);
      this.listener = (block, rms) => {
        elapsed += 100;
        const gate = Math.max(0.012, this.noise * 3);
        if (!spoke) this.noise = this.noise * 0.95 + rms * 0.05;
        blocks.push(block);
        if (!spoke && !this.holding && blocks.length > 5) blocks.shift(); // keep 0.5 s of lead-in
        if (rms > gate) {
          loudRun++;
          quiet = 0;
          if (loudRun >= 2) spoke = true;
        } else {
          loudRun = 0;
          quiet += 100;
        }
        if (this.holding) {
          if (elapsed >= 60000) done(true);
        } else if ((spoke && quiet >= silenceMs) || elapsed >= maxMs) done(true);
        else if (!spoke && elapsed >= noSpeechMs) done(false);
      };
    });
  }

  stop(keep = true) {
    this._stop?.(keep);
  }

  get recording() {
    return !!this._stop;
  }

  close() {
    this.stop(false);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
  }
}
