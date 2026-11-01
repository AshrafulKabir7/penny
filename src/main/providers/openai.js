// OpenAI models through the OpenAI API with the user's own API key. One topic is one chain of Responses
// (previous_response_id keeps the earlier turns and screenshots on OpenAI's side); text streams as it is written.

const OpenAI = require("openai").default;
const { sceneLanguage, buildTurn } = require("../prompt");

const EFFORT = { off: "low", low: "low", default: "medium", high: "high" };

class OpenAiApiProvider {
  constructor({ model, getKey, log = () => {}, clientOptions = {} }) {
    this.kind = "openai";
    this.clientOptions = clientOptions;
    this.model = model;
    this.getKey = getKey;
    this.log = log;
    this.effort = "off";
    this.previousId = null;
    this.turnCount = 0;
    this.instructions = null;
    this.controller = null;
    this.reasoningRejected = false;
  }

  get label() {
    return `OpenAI API · ${this.model}`;
  }

  get turns() {
    return this.turnCount;
  }

  warm() {
    return Promise.resolve();
  }

  _client() {
    const key = this.getKey?.() || globalThis.process?.env?.OPENAI_API_KEY;
    if (!key) throw Object.assign(new Error("Add your OpenAI API key in Accounts (tray menu) to use OpenAI models."), { needsKey: true });
    return new OpenAI({ apiKey: key, ...this.clientOptions });
  }

  async ask({ question, shot, visualsOnScreen, onDelta }) {
    const client = this._client();
    const firstTurn = !this.previousId;
    if (firstTurn) this.instructions = sceneLanguage(shot.imageWidth, shot.imageHeight);
    const closeupRef = shot.closeup ? "the second attached image" : null;
    const text = buildTurn({ question, shot, imageRef: "inline", closeupRef, firstTurn, visualsOnScreen, separateSystem: true });
    const content = [
      { type: "input_text", text },
      ...[shot.jpeg, shot.closeup].filter(Boolean).map((jpeg) => ({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
        detail: "high",
      })),
    ];
    const params = {
      model: this.model,
      instructions: this.instructions, // not carried over by previous_response_id, so sent every turn
      input: [{ role: "user", content }],
      ...(this.previousId ? { previous_response_id: this.previousId } : {}),
      ...(this.reasoningRejected ? {} : { reasoning: { effort: EFFORT[this.effort] || "low" } }),
    };
    try {
      return await this._stream(client, params, onDelta);
    } catch (err) {
      // Models without reasoning reject the effort setting; ask again without it, and remember.
      if (err instanceof OpenAI.BadRequestError && /reasoning/i.test(err.message) && !this.reasoningRejected) {
        this.reasoningRejected = true;
        delete params.reasoning;
        return this._stream(client, params, onDelta);
      }
      throw err;
    }
  }

  async _stream(client, params, onDelta) {
    this.controller = new AbortController();
    let full = "";
    try {
      const stream = client.responses.stream(params, { signal: this.controller.signal });
      stream.on("response.output_text.delta", (event) => {
        full += event.delta;
        onDelta(event.delta);
      });
      const response = await stream.finalResponse();
      this.previousId = response.id;
      this.turnCount++;
      return { text: full, usage: response.usage };
    } catch (err) {
      if (this.controller?.signal.aborted) throw Object.assign(new Error("cancelled"), { cancelled: true });
      throw this._explain(err);
    } finally {
      this.controller = null;
    }
  }

  _explain(err) {
    const say = (message, extra = {}) => Object.assign(new Error(message), extra);
    if (err instanceof OpenAI.AuthenticationError) return say("Your OpenAI API key was rejected. Update it in Accounts (tray menu).", { needsKey: true });
    if (err instanceof OpenAI.PermissionDeniedError) return say(`Your OpenAI account can't use ${this.model}. Choose another model in Accounts.`);
    if (err instanceof OpenAI.NotFoundError) return say(`${this.model} isn't available to your OpenAI account. Choose another model in Accounts.`);
    if (err instanceof OpenAI.RateLimitError) return say("OpenAI is rate-limiting your account (or it is out of credit). Try again later.");
    if (err instanceof OpenAI.APIConnectionError) return say("Can't reach the OpenAI API. Check your internet connection.");
    if (err instanceof OpenAI.BadRequestError) return err; // let the caller decide (see ask)
    if (err instanceof OpenAI.APIError) return say(`OpenAI API error ${err.status ?? ""}: ${err.message}`.trim());
    return err;
  }

  cancel() {
    this.controller?.abort();
  }

  newTopic() {
    this.previousId = null;
    this.turnCount = 0;
  }

  dispose() {
    this.cancel();
  }
}

/** A one-line request that proves the key works (Accounts → Test). */
async function testOpenAiKey(key, model, clientOptions = {}) {
  const client = new OpenAI({ apiKey: key, ...clientOptions });
  const res = await client.responses.create({ model, input: "Reply with: ok" });
  return res.output_text || "ok";
}

module.exports = { OpenAiApiProvider, testOpenAiKey };
