// Claude through the Claude API, paid for by the user's own account: the API key they saved in Accounts, or a Claude
// API sign-in the SDK finds by itself (ANTHROPIC_API_KEY, or a profile from `ant auth login`). Claude.ai subscription
// logins are not offered: Anthropic does not allow third-party apps to use them.
//
// One topic is one conversation. The scene language is the cached system prompt, history is append-only (whole
// assistant content, thinking blocks included), and text is streamed to the overlay as it is written.

const Anthropic = require("@anthropic-ai/sdk").default;
const { sceneLanguage, buildTurn } = require("../prompt");

// Penny's "Thinking" setting. Current Claude models always think a little; "low" effort keeps the first words quick.
const EFFORT = { off: "low", low: "low", default: "medium", high: "high" };
// Models with a server-side fallback when a request is declined (Claude API).
const WITH_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

class ClaudeApiProvider {
  constructor({ model, getKey, log = () => {}, clientOptions = {} }) {
    this.kind = "claude";
    this.clientOptions = clientOptions; // e.g. { dangerouslyAllowBrowser: true } in the Chrome extension
    this.model = model;
    this.getKey = getKey;
    this.log = log;
    this.effort = "off";
    this.history = [];
    this.system = null;
    this.stream = null;
  }

  get label() {
    return `Claude API · ${this.model}`;
  }

  get turns() {
    return Math.floor(this.history.length / 2);
  }

  warm() {
    return Promise.resolve();
  }

  async ask({ question, shot, visualsOnScreen, onDelta }) {
    const key = this.getKey?.();
    const client = key ? new Anthropic({ apiKey: key, ...this.clientOptions }) : new Anthropic(this.clientOptions);
    const firstTurn = this.history.length === 0;
    if (firstTurn) this.system = sceneLanguage(shot.imageWidth, shot.imageHeight);
    const closeupRef = shot.closeup ? "the second attached image" : null;
    const text = buildTurn({ question, shot, imageRef: "inline", closeupRef, firstTurn, visualsOnScreen, separateSystem: true });
    const content = [
      ...[shot.jpeg, shot.closeup].filter(Boolean).map((jpeg) => ({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
      })),
      { type: "text", text },
    ];
    const params = {
      model: this.model,
      max_tokens: 16000,
      system: [{ type: "text", text: this.system, cache_control: { type: "ephemeral" } }],
      output_config: { effort: EFFORT[this.effort] || "low" },
      messages: [...this.history, { role: "user", content }],
    };
    if (WITH_FALLBACK.has(this.model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    this.cancelled = false;
    const stream = client.beta.messages.stream(params);
    this.stream = stream;
    let full = "";
    stream.on("text", (delta) => {
      full += delta;
      onDelta(delta);
    });
    try {
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") throw new Error("Claude declined to answer that one.");
      this.history.push({ role: "user", content }, { role: "assistant", content: message.content });
      return { text: full, usage: message.usage };
    } catch (err) {
      if (this.cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
      throw this._explain(err, !!key);
    } finally {
      this.stream = null;
    }
  }

  _explain(err, hadKey) {
    const say = (message, extra = {}) => Object.assign(new Error(message), extra);
    if (err instanceof Anthropic.AuthenticationError) {
      return hadKey
        ? say("Your Claude API key was rejected. Update it in Accounts (tray menu).", { needsKey: true })
        : say("Sign in with Claude, or add your Claude API key, in Accounts (tray menu).", { needsKey: true });
    }
    if (err instanceof Anthropic.PermissionDeniedError) return say(`Your Claude account can't use ${this.model}. Pick another model in the tray.`);
    if (err instanceof Anthropic.NotFoundError) return say(`${this.model} isn't available to your Claude account. Pick another model in the tray.`);
    if (err instanceof Anthropic.RateLimitError) return say("Claude is rate-limiting your account. Try again in a moment.");
    if (err instanceof Anthropic.APIConnectionError) return say("Can't reach the Claude API. Check your internet connection.");
    if (err instanceof Anthropic.APIError) return say(`Claude API error ${err.status ?? ""}: ${err.message}`.trim());
    return err;
  }

  cancel() {
    if (!this.stream) return;
    this.cancelled = true;
    this.stream.abort();
  }

  newTopic() {
    this.history = [];
  }

  dispose() {
    this.cancel();
  }
}

/** A one-line request that proves the key works (Accounts → Test). */
async function testClaudeKey(key, model, clientOptions = {}) {
  const client = new Anthropic({ apiKey: key, ...clientOptions });
  const res = await client.messages.create({
    model,
    max_tokens: 1024, // room for the brief thinking current models always do
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "Reply with: ok" }],
  });
  return res.content.find((b) => b.type === "text")?.text ?? "ok";
}

module.exports = { ClaudeApiProvider, testClaudeKey, AnthropicErrors: Anthropic };
