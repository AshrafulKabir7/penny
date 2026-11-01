// Injected into the page when Penny is called. Lays Penny's overlay (an extension page) over the whole viewport.
// The overlay lets clicks through to the page except over its cards, scenes and ask bar, so it gets the mouse
// position from here, and asks to catch the mouse when it is over something of its own.

(() => {
  if (window.__pennyOverlay?.isConnected) return;
  const origin = new URL(chrome.runtime.getURL("")).origin;
  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL("overlay.html");
  frame.allow = "microphone";
  frame.title = "Penny";
  Object.assign(frame.style, {
    all: "initial",
    position: "fixed",
    left: "0",
    top: "0",
    width: "100vw", // the screenshot includes the scrollbar, so the overlay covers it too
    height: "100vh",
    border: "0",
    margin: "0",
    padding: "0",
    background: "transparent",
    colorScheme: "light", // must match the overlay page's, or Chrome paints the frame opaque
    zIndex: "2147483647",
    pointerEvents: "none",
    display: "block",
  });
  document.documentElement.appendChild(frame);
  window.__pennyOverlay = frame;

  const post = (msg) => frame.contentWindow?.postMessage({ penny: true, ...msg }, origin);
  addEventListener("mousemove", (e) => post({ type: "mouse", x: e.clientX, y: e.clientY }), { capture: true, passive: true });
  const scrolled = () => post({ type: "scroll", x: scrollX, y: scrollY });
  frame.addEventListener("load", scrolled);
  addEventListener("scroll", scrolled, { passive: true });
  addEventListener("keydown", (e) => e.key === "Escape" && post({ type: "escape" }), true);
  addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || e.data?.penny !== "interactive") return;
    frame.style.pointerEvents = e.data.on ? "auto" : "none";
  });
})();
