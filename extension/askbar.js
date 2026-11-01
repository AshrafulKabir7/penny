// The ask bar at the bottom of the page (Alt+Shift+P or the toolbar button): type a question, or press the mic and talk
// while pointing at things. Also keeps the drawings on the page as it scrolls, and Esc clears them.

const api = window.penny;
const { stage, trail } = window.__penny;

const bar = document.createElement("form");
bar.className = "askbar";
bar.dataset.interactive = "";
bar.innerHTML = `
  <span class="dot"></span>
  <input autocomplete="off" spellcheck="false" placeholder="Ask about anything on this page…" />
  <button type="button" class="mic" title="Talk (point at things while you talk)">
    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 1 0-7 0v6A3.5 3.5 0 0 0 12 15Zm6-3.5a1 1 0 1 1 2 0 8 8 0 0 1-7 7.94V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-1.56a8 8 0 0 1-7-7.94 1 1 0 1 1 2 0 6 6 0 0 0 12 0Z"/></svg>
  </button>
  <button type="button" class="gear" title="Penny settings">
    <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M13.9 2.6a1 1 0 0 0-1-.8h-1.8a1 1 0 0 0-1 .8l-.3 2a7.6 7.6 0 0 0-1.6.9l-1.9-.8a1 1 0 0 0-1.2.4l-.9 1.6a1 1 0 0 0 .2 1.3l1.6 1.2a7.7 7.7 0 0 0 0 1.8l-1.6 1.2a1 1 0 0 0-.2 1.3l.9 1.6a1 1 0 0 0 1.2.4l1.9-.8c.5.4 1 .7 1.6.9l.3 2a1 1 0 0 0 1 .8h1.8a1 1 0 0 0 1-.8l.3-2c.6-.2 1.1-.5 1.6-.9l1.9.8a1 1 0 0 0 1.2-.4l.9-1.6a1 1 0 0 0-.2-1.3l-1.6-1.2a7.7 7.7 0 0 0 0-1.8l1.6-1.2a1 1 0 0 0 .2-1.3l-.9-1.6a1 1 0 0 0-1.2-.4l-1.9.8a7.6 7.6 0 0 0-1.6-.9l-.3-2ZM12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Z"/></svg>
  </button>
  <kbd>Enter</kbd>`;
document.body.appendChild(bar);
const input = bar.querySelector("input");
const micButton = bar.querySelector(".mic");

function openBar() {
  bar.classList.add("on");
  input.focus();
  input.select();
}

function closeBar() {
  bar.classList.remove("on");
  input.value = "";
  input.blur();
}

/** The mouse position to send with a question, unless it is resting on the ask bar itself. */
function pointerNow() {
  const m = trail.mouse;
  if (!m) return null;
  const r = bar.getBoundingClientRect();
  if (bar.classList.contains("on") && m.x > r.left - 20 && m.x < r.right + 20 && m.y > r.top - 20) return null;
  return { x: m.x, y: m.y };
}

function submit(question, gesture = []) {
  const pointer = pointerNow();
  closeBar(); // out of the screenshot
  api.send("ask", { question, pointer, gesture, view: [innerWidth, innerHeight] });
}

bar.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text) submit(text);
  else closeBar();
});
bar.querySelector(".gear").addEventListener("click", () => api.send("open-options"));

function escape() {
  if (recognition) {
    recognition.cancelled = true;
    return recognition.abort();
  }
  if (bar.classList.contains("on")) return closeBar();
  api.send("cancel");
  api.emit("stage:clear");
}
document.addEventListener("keydown", (e) => e.key === "Escape" && escape());
api.on("page:escape", escape);
api.on("ask:open", () => (bar.classList.contains("on") && !input.value ? closeBar() : openBar()));

// ---------------------------------------------------------------- talking (the browser's speech recognition)

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (!Recognition) micButton.hidden = true;

micButton.addEventListener("click", () => {
  if (recognition) return recognition.stop();
  const rec = (recognition = new Recognition());
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  let heard = "";
  let failed = null;
  recognition.onresult = (e) => {
    heard = [...e.results].map((r) => r[0].transcript).join("");
    input.value = heard;
  };
  recognition.onerror = (e) => (failed = e.error);
  recognition.onend = () => {
    recognition = null;
    bar.classList.remove("listening");
    if (rec.cancelled) return api.emit("listen:cancel");
    const gesture = trail.stop(); // the path the mouse took while they talked
    trail.setMode(null);
    if (heard.trim()) return submit(heard.trim(), gesture);
    const why =
      failed === "not-allowed" || failed === "service-not-allowed"
        ? "Microphone blocked here. Allow it from the address bar, or type instead."
        : failed && failed !== "aborted"
          ? `Speech recognition failed (${failed}). Type instead.`
          : "Didn't hear anything";
    api.emit("status", { state: "error", text: why, hideAfter: 3500 });
  };
  stage.beginAnswer(); // talking over Penny interrupts it
  bar.classList.add("listening");
  api.emit("status", { state: "listening", text: "Listening · point at things as you talk" });
  trail.start();
  recognition.start();
});

// ---------------------------------------------------------------- drawings stay on the page as it scrolls

let scroll = null; // page scroll when the drawings on screen were made
let page = { x: 0, y: 0 };
api.on("page:scroll", (p) => {
  page = p;
  if (!scroll) scroll = p;
  stage.layer.style.transform = `translate(${scroll.x - p.x}px, ${scroll.y - p.y}px)`;
});
api.on("answer:start", () => {
  // A new answer is drawn in the coordinates of a fresh screenshot; old drawings scrolled away from it go.
  if (scroll && (scroll.x !== page.x || scroll.y !== page.y)) stage.clear();
  scroll = page;
  stage.layer.style.transform = "";
});
api.on("stage:clear", () => {
  scroll = page;
  stage.layer.style.transform = "";
});
