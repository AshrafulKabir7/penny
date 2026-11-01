// Hand-drawn strokes: Rough.js shapes in SVG, revealed as if drawn, with the pen following the line.

import rough from "roughjs";

export const SVG_NS = "http://www.w3.org/2000/svg";

export const PALETTE = {
  blue: { fill: "#dbe9ff", stroke: "#4a7fd6", ink: "#1f3f78" },
  pink: { fill: "#ffdfe4", stroke: "#e0607a", ink: "#7a2335" },
  green: { fill: "#dcf5df", stroke: "#4fae64", ink: "#21582e" },
  yellow: { fill: "#fff3b8", stroke: "#d9a521", ink: "#6b4e00" },
  purple: { fill: "#ece2ff", stroke: "#8a63d2", ink: "#41267a" },
  gray: { fill: "#eceae4", stroke: "#8b877c", ink: "#3c3a35" },
  orange: { fill: "#ffe6cf", stroke: "#e58a3a", ink: "#7a3d08" },
};

export const INK = "#2d2b28";
export const MARKER = "#f2b705";

export function color(name) {
  if (typeof name === "string" && PALETTE[name.toLowerCase()]) return PALETTE[name.toLowerCase()];
  if (typeof name === "string" && /^#[0-9a-f]{3,8}$/i.test(name)) return { fill: name + "33", stroke: name, ink: INK };
  return PALETTE.blue;
}

let seed = 1;
export function nextSeed() {
  seed = (seed * 16807) % 2147483647;
  return seed;
}

export function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

export function roughFor(svg) {
  return rough.svg(svg);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Reveals every stroke in a Rough.js group one after another, as if drawn, and fades in its fills.
 * `pen` (optional) follows the tip of the line. `toScreen(x, y)` maps the SVG's coordinates to the page.
 */
export function drawIn(group, { duration = 600, pen, toScreen } = {}) {
  const paths = [...group.querySelectorAll("path")];
  const strokes = paths.filter((p) => p.getAttribute("fill") === "none" || !p.getAttribute("fill"));
  const fills = paths.filter((p) => !strokes.includes(p));
  for (const f of fills) {
    f.style.opacity = "0";
    f.style.transition = `opacity ${Math.round(duration * 0.8)}ms ease ${Math.round(duration * 0.3)}ms`;
  }
  const lengths = strokes.map((p) => {
    let len = 0;
    try {
      len = p.getTotalLength();
    } catch {}
    p.style.strokeDasharray = `${len} ${len}`;
    p.style.strokeDashoffset = `${len}`;
    return len;
  });
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  requestAnimationFrame(() => fills.forEach((f) => (f.style.opacity = "1")));
  return new Promise((resolve) => {
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      let budget = easeInOut(t) * total;
      let tip = null;
      strokes.forEach((p, i) => {
        const len = lengths[i];
        const shown = Math.max(0, Math.min(len, budget));
        budget -= len;
        p.style.strokeDashoffset = `${len - shown}`;
        if (shown > 0 && shown < len) tip = { p, shown };
      });
      if (pen && tip && toScreen) {
        try {
          const pt = tip.p.getPointAtLength(tip.shown);
          const s = toScreen(pt.x, pt.y);
          pen.jump(s.x, s.y);
        } catch {}
      }
      if (t < 1) requestAnimationFrame(frame);
      else {
        strokes.forEach((p) => {
          p.style.strokeDasharray = "";
          p.style.strokeDashoffset = "";
        });
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

/** The yellow pen that travels to whatever is being drawn. */
export class Pen {
  constructor(parent) {
    this.el = document.createElement("div");
    this.el.className = "pen";
    this.el.innerHTML = `<svg viewBox="0 0 32 32" width="30" height="30"><path d="M4 3 L27 14 L16 17 L12 28 Z" fill="#ffd23f" stroke="#2d2b28" stroke-width="2" stroke-linejoin="round"/></svg>`;
    parent.appendChild(this.el);
    this.x = window.innerWidth * 0.75;
    this.y = window.innerHeight * 0.3;
    this.hideTimer = 0;
    this._place();
  }

  _place() {
    this.el.style.transform = `translate(${this.x - 4}px, ${this.y - 3}px)`;
  }

  show() {
    clearTimeout(this.hideTimer);
    this.el.classList.add("on");
  }

  idle(after = 2500) {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.el.classList.remove("on"), after);
  }

  jump(x, y) {
    this.show();
    this.el.style.transition = "none";
    this.x = x;
    this.y = y;
    this._place();
  }

  /** Glides to (x, y); resolves on arrival. */
  moveTo(x, y, ms) {
    this.show();
    const dist = Math.hypot(x - this.x, y - this.y);
    const dur = ms ?? Math.min(420, 120 + dist * 0.35);
    this.el.style.transition = `transform ${dur}ms cubic-bezier(.3,.7,.3,1)`;
    this.x = x;
    this.y = y;
    this._place();
    return sleep(dur);
  }

  async tap() {
    this.el.classList.remove("tap");
    void this.el.offsetWidth;
    this.el.classList.add("tap");
    await sleep(350);
  }
}
