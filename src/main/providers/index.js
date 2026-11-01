// The models Talky can use, and a factory for the provider behind an id like "cmd:deepseek/deepseek-v4.1-flash".

const { spawn } = require("node:child_process");
const { AcpProvider } = require("./acp");
const { AgyProvider } = require("./agy");
const { commandCodeCommand, antigravityCommand, workDir } = require("./cli");

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
  const m = /^(cmd|agy):([A-Za-z0-9][A-Za-z0-9._/:-]*)$/.exec(id || "");
  return m ? { kind: m[1], model: m[2] } : null;
}

function createProvider(id, log) {
  const parsed = parseModelId(id) || parseModelId(DEFAULT_MODEL);
  return parsed.kind === "cmd" ? new AcpProvider({ model: parsed.model, log }) : new AgyProvider({ model: parsed.model, log });
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

module.exports = { SUGGESTED, DEFAULT_MODEL, parseModelId, createProvider, discoverModels };
