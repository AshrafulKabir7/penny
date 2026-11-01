// Gemini through the Gemini API with the user's own API key from Google AI Studio (or GEMINI_API_KEY in the
// environment). One topic is one conversation; text streams as it is written. History is kept here, one user entry and
// one combined reply per turn (the SDK's chat helper stores every streamed chunk as a separate reply).

const { GoogleGenAI, ApiError } = require("@google/genai");
const { sceneLanguage, buildTurn, usesGrid } = require("../prompt");

const LEVEL = { off: "LOW", low: "LOW", default: "MEDIUM", high: "HIGH" };

class GeminiApiProvider {
  constructor({ model, getKey, log = () => {}, clientOptions = {} }) {
    this.kind = "gemini";
    this.clientOptions = clientOptions;
    this.model = model;
    this.getKey = getKey;
    this.log = log;
    this.effort = "off";
    this.history = [];
    this.client = null;
    this.system = null;
    this.turnCount = 0;
    this.controller = null;
    this.thinkingRejected = false;
  }

  get label() {
    return `Gemini API · ${this.model}`;
  }

  get turns() {
    return this.turnCount;
  }

  warm() {
    return Promise.resolve();
  }

  _client() {
    const env = globalThis.process?.env ?? {};
    const key = this.getKey?.() || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
    if (!key) throw Object.assign(new Error("Add your Gemini API key in Accounts (tray menu), or sign in with Google there."), { needsKey: true });
    return new GoogleGenAI({ apiKey: key, ...this.clientOptions });
  }

  async ask({ question, shot, visualsOnScreen, onDelta }) {
    if (!this.turnCount) {
      this.system = sceneLanguage(shot.imageWidth, shot.imageHeight, { grid: usesGrid(this.model) });
      this.client = this._client();
    }
    const closeupRef = shot.closeup ? "the second attached image" : null;
    const text = buildTurn({ question, shot, imageRef: "inline", closeupRef, firstTurn: this.turnCount === 0, visualsOnScreen, separateSystem: true, grid: usesGrid(this.model) });
    const message = [
      ...[shot.jpeg, shot.closeup].filter(Boolean).map((jpeg) => ({ inlineData: { mimeType: "image/jpeg", data: jpeg.toString("base64") } })),
      { text },
    ];
    try {
      return await this._send(message, onDelta);
    } catch (err) {
      // Models without thinking levels reject the setting; ask again without it, and remember.
      if (err instanceof ApiError && err.status === 400 && /thinking/i.test(err.message) && !this.thinkingRejected) {
        this.thinkingRejected = true;
        return this._send(message, onDelta);
      }
      throw err;
    }
  }

  async _send(message, onDelta) {
    this.controller = new AbortController();
    const config = {
      systemInstruction: this.system,
      abortSignal: this.controller.signal,
      ...(this.thinkingRejected ? {} : { thinkingConfig: { thinkingLevel: LEVEL[this.effort] || "LOW" } }),
    };
    let full = "";
    try {
      const stream = await this.client.models.generateContentStream({
        model: this.model,
        contents: [...this.history, { role: "user", parts: message }],
        config,
      });
      for await (const chunk of stream) {
        const piece = chunk.text;
        if (piece) {
          full += piece;
          onDelta(piece);
        }
      }
      this.history.push({ role: "user", parts: message }, { role: "model", parts: [{ text: full }] });
      this.turnCount++;
      return { text: full };
    } catch (err) {
      if (this.controller?.signal.aborted) throw Object.assign(new Error("cancelled"), { cancelled: true });
      throw this._explain(err);
    } finally {
      this.controller = null;
    }
  }

  _explain(err) {
    if (!(err instanceof ApiError)) return err;
    const say = (message, extra = {}) => Object.assign(new Error(message), extra);
    if (/API_KEY_INVALID|API key not valid/i.test(err.message) || err.status === 401 || err.status === 403) {
      return say("Your Gemini API key was rejected. Update it in Accounts (tray menu).", { needsKey: true });
    }
    if (err.status === 404) return say(`${this.model} isn't available to your Gemini API key. Choose another model in Accounts.`);
    if (err.status === 429) return say("Gemini is rate-limiting your key (or its free quota is used up). Try again later.");
    if (err.status === 400 && /thinking/i.test(err.message)) return err; // handled in ask
    return say(`Gemini API error ${err.status ?? ""}: ${String(err.message).slice(0, 160)}`.trim());
  }

  cancel() {
    this.controller?.abort();
  }

  newTopic() {
    this.history = [];
    this.turnCount = 0;
  }

  dispose() {
    this.cancel();
  }
}

/** A one-line request that proves the key works (Accounts → Test). */
async function testGeminiKey(key, model, clientOptions = {}) {
  const ai = new GoogleGenAI({ apiKey: key, ...clientOptions });
  const res = await ai.models.generateContent({ model, contents: "Reply with: ok" });
  return res.text || "ok";
}

module.exports = { GeminiApiProvider, testGeminiKey };
