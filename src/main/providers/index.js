// The models Penny can use, and a factory for the provider behind an id like "cmd:deepseek/deepseek-v4.1-flash".
//   cmd:<model>     Command Code CLI (the user's Command Code login)
//   agy:<model>     Antigravity CLI (the user's Antigravity login)
//   claude:<model>  Claude API (the user's own API key)
//   openai:<model>  OpenAI API (the user's own API key)
//   codex:<model>   ChatGPT account through the Codex CLI ("default" = the account's default model)
//   gemini:<model>  Gemini API (the user's own API key)

const { spawn } = require("node:child_process");
const { AcpProvider } = require("./acp");
const { AgyProvider } = require("./agy");
const { ClaudeApiProvider } = require("./anthropic");
const { OpenAiApiProvider } = require("./openai");
const { CodexProvider } = require("./codex");
const { GeminiApiProvider } = require("./gemini");
const { commandCodeCommand, antigravityCommand, workDir } = require("./cli");

// The user's own accounts: an API key they paste in Accounts, or their ChatGPT sign-in.
const OWN_ACCOUNTS = [
  { id: "claude:claude-opus-5-5", name: "Claude Opus 5.5 (your Claude account)", needs: "anthropic" },
  { id: "claude:claude-sonnet-5-5", name: "Claude Sonnet 5.5 (your Claude account)", needs: "anthropic" },
  { id: "claude:claude-haiku-5-5", name: "Claude Haiku 5.5 (your Claude account)", needs: "anthropic" },
  { id: "openai:gpt-6.1-terra", name: "GPT-6.1 Terra (your OpenAI API key)", needs: "openai" },
  { id: "codex:default", name: "ChatGPT (your ChatGPT account, via Codex)", needs: "codex" },
  { id: "gemini:gemini-3.8-flash", name: "Gemini 3.8 Flash (your Gemini API key)", needs: "google" },
  { id: "agy:gemini-3.8-flash-low", name: "Gemini 3.8 Flash (your Google account, via Antigravity)", needs: "google-account" },
];

// Models that can read a screenshot and that worked on this machine's plans, fastest first.
const SUGGESTED = [
  { id: "cmd:deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (Command Code)" },
  { id: "cmd:deepseek/deepseek-v4.1-flash-fast", name: "DeepSeek V4.1 Flash Fast (Command Code)" },
  { id: "cmd:moonshotai/kimi-k2.6", name: "Kimi K2.6 (Command Code)" },
  { id: "cmd:qwen/qwen3.8-27b", name: "Qwen 3.8 27B (Command Code)" },
  { id: "cmd:xiaomi/mimo-v2.6-flash", name: "MiMo V2.6 Flash (Command Code)" },
  { id: "cmd:claude-sonnet-5-5", name: "Claude Sonnet 5.5 (Command Code)" },
  { id: "agy:gemini-3.8-flash-low", name: "Gemini 3.8 Flash Low (Antigravity)" },
  { id: "agy:gemini-3.8-flash-medium", name: "Gemini 3.8 Flash Medium (Antigravity)" },
  { id: "agy:gemini-3.8-flash-high", name: "Gemini 3.8 Flash High (Antigravity)" },
  { id: "agy:claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Antigravity)" },
];

const DEFAULT_MODEL = SUGGESTED[0].id;

function parseModelId(id) {
  const m = /^(cmd|agy|claude|openai|codex|gemini):([A-Za-z0-9][A-Za-z0-9._/:-]*)$/.exec(id || "");
  return m ? { kind: m[1], model: m[2] } : null;
}

/** `getKey(provider)` returns the user's saved API key for "anthropic" or "openai", or null. */
function createProvider(id, log, { getKey = () => null } = {}) {
  const { kind, model } = parseModelId(id) || parseModelId(DEFAULT_MODEL);
  switch (kind) {
    case "claude":
      return new ClaudeApiProvider({ model, log, getKey: () => getKey("anthropic") });
    case "openai":
      return new OpenAiApiProvider({ model, log, getKey: () => getKey("openai") });
    case "codex":
      return new CodexProvider({ model, log });
    case "gemini":
      return new GeminiApiProvider({ model, log, getKey: () => getKey("google") });
    case "agy":
      return new AgyProvider({ model, log });
    default:
      return new AcpProvider({ model, log });
  }
}

function runList(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd.file, cmd.args, { cwd: workDir(), shell: cmd.shell, windowsHide: true, env: { ...process.env, ...cmd.env, NO_COLOR: "1" } });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out));
    setTimeout(() => child.kill(), 60_000);
  });
}

/** Every model both CLIs report, as ids. Slow (a few seconds); call it in the background. */
async function discoverModels() {
  const [cmdOut, agyOut] = await Promise.all([
    runList(commandCodeCommand(["--list-models", "--no-auto-update"])),
    runList(antigravityCommand(["models"])),
  ]);
  const ids = [];
  for (const line of cmdOut.split(/\r?\n/)) {
    if (line.startsWith("Decision models")) break;
    const m = /^([a-z0-9][a-z0-9._/-]*(?::[a-z0-9]+)?)\s{2,}\S/.exec(line);
    if (m) ids.push(`cmd:${m[1]}`);
  }
  for (const line of agyOut.split(/\r?\n/)) {
    const m = /^([a-z0-9][a-z0-9._-]*)\t/.exec(line);
    if (m) ids.push(`agy:${m[1]}`);
  }
  return ids;
}

module.exports = { SUGGESTED, OWN_ACCOUNTS, DEFAULT_MODEL, parseModelId, createProvider, discoverModels };
