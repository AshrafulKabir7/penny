// Penny's native messaging host: lets Penny for Chrome use the accounts signed in on this PC (ChatGPT through Codex,
// Claude API through Anthropic's `ant` CLI, a Google account through Antigravity). Chrome starts it through the
// launcher the Penny app writes (src/main/native-host.js), which runs this file with Penny's own Node.
//
// Messages are Chrome's native messaging frames (4-byte little-endian length, then JSON), both ways:
//   {id, type: "status"}                          -> {id, chatgpt, claude, google}
//   {id, type: "login", account}                  -> {id, ok} | {id, error, install}
//   {id, type: "ask", session, model, effort, question, shot, visualsOnScreen}
//                                                 -> {id, type: "delta", text}... then {id, type: "end"} | {id, type: "error", message}
//   {type: "cancel" | "new-topic", session}
// Nothing here stores or reads a key: each tool keeps its own sign-in.

const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { createProvider } = require("../main/providers");
const { codexStatus, codexLogin } = require("../main/providers/codex");
const { claudeSignInStatus, claudeSignIn, googleAccountStatus, googleSignIn } = require("../main/signin");

// Stdout is the channel to Chrome, so nothing else may write to it; the log goes to a file.
const LOG = join(process.env.APPDATA || require("node:os").tmpdir(), "Penny", "native-host.log");
try {
  mkdirSync(join(LOG, ".."), { recursive: true });
  writeFileSync(LOG, "");
} catch {}
const log = (line) => {
  try {
    appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${line}\n`);
  } catch {}
};
console.log = console.info = console.warn = console.error = (...a) => log(a.join(" "));

// Only the sign-in models; API-key models run inside the extension itself.
const MODEL = /^(codex|claude|agy):[A-Za-z0-9][A-Za-z0-9._/:-]*$/;

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

const sessions = new Map(); // session -> provider

function provider(session, model) {
  const known = sessions.get(session);
  if (known?.modelId === model) return known;
  known?.dispose();
  const p = createProvider(model, log);
  p.modelId = model;
  sessions.set(session, p);
  return p;
}

function friendly(err, model) {
  const m = String(err?.message || err);
  if (model.startsWith("agy:")) {
    if (/ENOENT|not recognized|cannot find/i.test(m)) return "Antigravity isn't installed on this PC. Install it and sign in with Google.";
    if (/401|unauthori[sz]ed|not logged in|login/i.test(m)) return "Sign in to Antigravity with your Google account first (Penny settings → Sign in with Google).";
  }
  return m.length > 180 ? `${m.slice(0, 180)}…` : m;
}

async function handle(msg) {
  const { id, type } = msg;
  if (type === "status") {
    const [chatgpt, google] = await Promise.all([codexStatus(), googleAccountStatus()]);
    return send({ id, chatgpt, claude: claudeSignInStatus(), google });
  }
  if (type === "login") {
    const login = { chatgpt: codexLogin, claude: () => claudeSignIn({ log }), google: googleSignIn }[msg.account];
    if (!login) return send({ id, error: "Unknown account." });
    try {
      await login();
      return send({ id, ok: true });
    } catch (err) {
      return send({ id, error: err.message, install: err.install });
    }
  }
  if (type === "cancel") return sessions.get(msg.session)?.cancel();
  if (type === "new-topic") return sessions.get(msg.session)?.newTopic();
  if (type === "ask") {
    if (!MODEL.test(msg.model || "")) return send({ id, type: "error", message: "That model can't be used through the Penny app." });
    const p = provider(String(msg.session), msg.model);
    p.effort = msg.effort || "off";
    const s = msg.shot || {};
    const shot = { ...s, jpeg: Buffer.from(s.jpeg || "", "base64"), closeup: s.closeup ? Buffer.from(s.closeup, "base64") : null };
    const started = Date.now();
    try {
      await p.warm?.();
      await p.ask({ question: String(msg.question || ""), shot, visualsOnScreen: !!msg.visualsOnScreen, onDelta: (text) => send({ id, type: "delta", text }) });
      log(`[ask] ${msg.model} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      send({ id, type: "end" });
    } catch (err) {
      log(`[ask] ${msg.model} failed: ${err.message}`);
      send({ id, type: "error", message: err.cancelled ? "cancelled" : friendly(err, msg.model), cancelled: !!err.cancelled });
    }
  }
}

// ---------------------------------------------------------------- reading Chrome's frames

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const body = buf.subarray(4, 4 + len).toString("utf8");
    buf = buf.subarray(4 + len);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      continue;
    }
    handle(msg).catch((err) => log(`[host] ${err.stack || err}`));
  }
});
// Chrome closes the pipe when the extension disconnects (or the browser quits): stop the CLIs and leave.
process.stdin.on("end", () => {
  for (const p of sessions.values()) p.dispose();
  setTimeout(() => process.exit(0), 300);
});
log(`[host] started by ${process.argv.slice(2).join(" ") || "?"}`);
