// Overlay bootstrap: wires the stage, voice and status pill to the main process (or to demo files in a browser).

import { OpStream } from "./engine/parser.js";
import { Stage } from "./engine/stage.js";
import { Mic, Speaker } from "./voice.js";
import { Trail } from "./trail.js";

const params = new URLSearchParams(location.search);
const api = window.penny || demoApi();
let settings = { captions: true, muted: false };

// ---------------------------------------------------------------- status pill

const pill = document.getElementById("pill");
const pillText = pill.querySelector(".pill-text");
const bars = [...pill.querySelectorAll(".pill-bars i")];
const captionEl = document.getElementById("caption");
let pillTimer = 0;
let speaking = false;
let phase = "idle"; // idle | listening | transcribing | thinking | answering | error

function setPill(state, text, { hideAfter } = {}) {
  clearTimeout(pillTimer);
  pill.className = `pill on ${state}`;
  pillText.textContent = text;
  if (hideAfter) pillTimer = setTimeout(() => pill.classList.remove("on"), hideAfter);
}

function hidePill() {
  clearTimeout(pillTimer);
  pill.classList.remove("on");
}

function setPhase(next, text) {
  phase = next;
  if (next === "idle") return speaking ? setPill("speaking", "Speaking") : hidePill();
  if (next === "answering") return setPill(speaking ? "speaking" : "thinking", speaking ? "Speaking" : "Drawing");
  setPill(next, text);
}

let captionTimer = 0;
function showCaption(text) {
  if (!settings.captions) return;
  clearTimeout(captionTimer);
  captionEl.textContent = text;
  captionEl.classList.add("on");
}
function hideCaption(delay = 1800) {
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => captionEl.classList.remove("on"), delay);
}

// ---------------------------------------------------------------- stage and voice

const speaker = new Speaker({
  synth: api.synth,
  muted: !!params.get("mute"),
  onState(on) {
    speaking = on;
    if (phase === "answering" || phase === "idle") setPhase(phase);
    if (!on) hideCaption();
  },
});

const stage = new Stage(document.getElementById("stage"), {
  speaker,
  onInteractive: (on) => api.setInteractive(on),
  onVisuals: (on) => api.visuals(on),
  onCaption: showCaption,
  onSculpt: api.sculpt ? (req) => api.sculpt(req) : null,
});

window.__penny = { stage }; // for poking at the stage from DevTools

const trail = new Trail(document.body);
window.__penny.trail = trail;

const mic = new Mic({
  onLevel(level) {
    if (phase !== "listening") return;
    trail.setLevel(level);
    bars.forEach((b, i) => (b.style.height = `${4 + Math.round(level * 12 * (0.6 + 0.4 * Math.sin(i * 1.7 + performance.now() / 120)))}px`));
  },
});

let stream = null;
let answerId = 0;

function startAnswer({ question } = {}) {
  answerId++;
  stage.beginAnswer();
  stream = new OpStream((op) => {
    if (phase === "thinking") {
      setPhase("answering");
      trail.setMode(null);
    }
    stage.enqueue(op);
  });
  setPhase("thinking", question ? `“${question}”` : "Thinking");
  trail.setMode("thinking"); // dots by the cursor until the first drawing arrives
}

async function endAnswer() {
  const id = answerId;
  if (stream && stream.count === 0) {
    trail.setMode(null);
    setPill("error", "The model answered without any drawing", { hideAfter: 4000 });
    phase = "idle";
    api.answerDone({ ops: 0 });
    return;
  }
  await stage.finish();
  if (id !== answerId) return;
  setPhase("idle");
  trail.setMode(null);
  api.answerDone({ ops: stream?.count ?? 0 });
}

// ---------------------------------------------------------------- listening

async function listen({ wake = false } = {}) {
  try {
    await mic.open();
  } catch (err) {
    setPill("error", "Microphone unavailable: " + (err.message || err.name), { hideAfter: 5000 });
    api.listenResult({ error: `mic: ${err.name} ${err.message}`, wake });
    return;
  }
  if (mic.recording) mic.stop(false); // a "Hey Penny" check in progress gives way to the hotkey
  if (!wake) {
    stage.beginAnswer(); // talking over Penny interrupts it
    setPhase("listening", "Listening");
    trail.start();
  }
  const pcm = await mic.record(wake ? { silenceMs: 800, maxMs: 15000, noSpeechMs: 4000 } : {});
  // The path the mouse took while the user talked, in window pixels; main maps it onto the screenshot.
  const gesture = wake ? [] : trail.stop();
  if (!pcm) {
    if (!wake) {
      trail.setMode(null);
      setPill("error", "Didn't hear anything", { hideAfter: 2200 });
    }
    phase = "idle";
    api.listenResult({ empty: true, wake });
    return;
  }
  if (!wake) {
    setPhase("transcribing", "Got it…");
    trail.setMode("thinking");
  }
  api.listenResult({ pcm: pcm.buffer, wake, gesture, view: [window.innerWidth, window.innerHeight] }, [pcm.buffer]);
}

// ---------------------------------------------------------------- events from the main process

api.on("listen:start", (opts) => listen(opts || {}));
api.on("listen:stop", () => mic.stop(true));
api.on("listen:hold", () => {
  mic.holding = true; // push-to-talk: keep recording through pauses until the key is let go
  setPill("listening", "Listening · release to send");
});
api.on("listen:cancel", () => {
  mic.stop(false);
  trail.stop();
  trail.setMode(null);
  setPhase("idle");
});
api.on("heard", ({ text }) => {
  if (text) setPill("thinking", `“${text}”`);
});
api.on("answer:start", (info) => startAnswer(info));
api.on("answer:pointer", (p) => (stage.pointer = p && p.x != null ? p : null));
api.on("answer:space", ({ w, h }) => {
  if (w > 0 && h > 0) stage.space = { w, h };
});
api.on("answer:delta", (text) => stream?.push(text));
api.on("answer:end", () => endAnswer());
api.on("answer:error", ({ message }) => {
  trail.setMode(null);
  setPill("error", message || "Something went wrong", { hideAfter: 6000 });
  phase = "idle";
});
api.on("status", ({ state, text, hideAfter }) => {
  if (state === "error") trail.setMode(null);
  setPill(state, text, { hideAfter });
});
api.on("stage:clear", () => {
  stage.reset();
  trail.setMode(null);
  hideCaption(0);
  setPhase("idle");
});
api.on("settings", (s) => {
  settings = { ...settings, ...s };
  speaker.muted = !!settings.muted;
  speaker.engine = settings.voice === "neural" && api.synth ? "neural" : "system";
  if (!settings.captions) hideCaption(0);
});

// The main process is about to screenshot the screen for the model: hide the drawings for that moment, keep the pill.
api.on("capture:prepare", ({ token }) => {
  stage.layer.style.visibility = "hidden";
  stage.pen.el.style.visibility = "hidden";
  captionEl.style.visibility = "hidden";
  requestAnimationFrame(() => requestAnimationFrame(() => api.captureReady(token)));
});
api.on("capture:done", () => {
  stage.layer.style.visibility = "";
  stage.pen.el.style.visibility = "";
  captionEl.style.visibility = "";
});

/** Plays a whole JSONL reply as if it were streaming in (demos and the dev server). */
async function playText(text, { question, chunk = 48, delay = 30 } = {}) {
  startAnswer({ question });
  for (let i = 0; i < text.length; i += chunk) {
    stream.push(text.slice(i, i + chunk));
    await new Promise((r) => setTimeout(r, delay));
  }
  endAnswer();
}
api.on("ops:play", ({ text, question }) => playText(text, { question }));

api.ready();

// ---------------------------------------------------------------- demo mode: open overlay.html in a browser

function demoApi() {
  document.body.classList.add("demo");
  const bg = params.get("bg");
  if (bg) document.body.style.backgroundImage = `url("${bg}")`;
  const handlers = {};
  const demos = (params.get("demos") || "tensor,f35-hover,jet,engine,pi,pi-camera,newton1,newton3,rocket").split(",");
  queueMicrotask(() => {
    const bar = document.createElement("div");
    bar.className = "demo-bar";
    for (const name of demos) {
      const b = document.createElement("button");
      b.textContent = name;
      b.onclick = async () => {
        const text = await (await fetch(`../../tools/demo/${name}.jsonl`)).text();
        handlers["stage:clear"]?.();
        playText(text, { question: name });
      };
      bar.appendChild(b);
    }
    const clear = document.createElement("button");
    clear.textContent = "clear";
    clear.onclick = () => handlers["stage:clear"]?.();
    bar.appendChild(clear);
    if (!params.get("nobar")) document.body.appendChild(bar); // nobar: clean shots (tools/capture-shots.cjs)
    const auto = params.get("play");
    if (auto) bar.querySelector(`button:nth-child(${demos.indexOf(auto) + 1})`)?.click();
  });
  return {
    synth: null,
    // Demos load a saved splat instead of sculpting (?ply=<url>, default .cache/idol/backpack.ply).
    async sculpt() {
      await new Promise((r) => setTimeout(r, Number(params.get("sculptMs") || 1500)));
      const res = await fetch(params.get("ply") || "../../.cache/idol/backpack.ply");
      if (!res.ok) throw new Error("No saved splat for the demo.");
      return new Uint8Array(await res.arrayBuffer());
    },
    on: (name, fn) => (handlers[name] = fn),
    setInteractive() {},
    visuals() {},
    answerDone(info) {
      window.__lastAnswer = info;
    },
    listenResult() {},
    ready() {},
  };
}
