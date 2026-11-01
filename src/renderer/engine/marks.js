// Marks drawn straight onto the user's screen: loops, underlines, marker highlights, arrows, labels, taps, sticky notes.

import { color, drawIn, INK, MARKER, nextSeed, roughFor, sleep, svgEl } from "./sketch.js";

const str = (v) => (v == null ? "" : String(v)).slice(0, 120);

class SvgMark {
  constructor(stage) {
    this.stage = stage;
    this.g = svgEl("g", { class: "mark" }, stage.marksSvg);
  }
  draw(duration) {
    const pen = this.stage.pen;
    return drawIn(this.g, { duration, pen, toScreen: (x, y) => ({ x, y }) });
  }
  remove() {
    this.g.style.transition = "opacity 300ms";
    this.g.style.opacity = "0";
    setTimeout(() => this.g.remove(), 320);
  }
}

class HtmlMark {
  constructor(el, svgMark) {
    this.el = el;
    this.svgMark = svgMark;
  }
  remove() {
    this.el.classList.add("out");
    setTimeout(() => this.el.remove(), 320);
    this.svgMark?.remove();
  }
}

export async function circle(stage, op) {
  const [x0, y0, x1, y1] = stage.markBox(op.box);
  const m = new SvgMark(stage);
  const rc = roughFor(stage.marksSvg);
  const w = Math.max(30, x1 - x0) * 1.18 + 18;
  const h = Math.max(20, y1 - y0) * 1.35 + 16;
  m.g.appendChild(rc.ellipse((x0 + x1) / 2, (y0 + y1) / 2, w, h, { stroke: MARKER, strokeWidth: 3, roughness: 1.4, bowing: 1.5, seed: nextSeed() }));
  await stage.pen.moveTo((x0 + x1) / 2 + w / 2, (y0 + y1) / 2);
  await m.draw(650);
  return m;
}

export async function underline(stage, op) {
  const [x0, , x1, y1] = stage.markBox(op.box);
  const m = new SvgMark(stage);
  const rc = roughFor(stage.marksSvg);
  m.g.appendChild(rc.curve([[x0 - 4, y1 + 4], [(x0 + x1) / 2, y1 + 7], [x1 + 6, y1 + 3]], { stroke: MARKER, strokeWidth: 3, roughness: 1, seed: nextSeed() }));
  await stage.pen.moveTo(x0 - 4, y1 + 4);
  await m.draw(450);
  return m;
}

export async function highlight(stage, op) {
  const [x0, y0, x1, y1] = stage.markBox(op.box);
  const el = document.createElement("div");
  el.className = "highlight";
  Object.assign(el.style, { left: `${x0 - 3}px`, top: `${y0 - 2}px`, width: `${x1 - x0 + 6}px`, height: `${Math.max(8, y1 - y0 + 4)}px` });
  stage.layer.appendChild(el);
  await stage.pen.moveTo(x0, (y0 + y1) / 2);
  el.classList.add("in");
  await stage.pen.moveTo(x1, (y0 + y1) / 2, 420);
  return new HtmlMark(el);
}

function arrowHead(rc, g, [fx, fy], [tx, ty], opts) {
  const a = Math.atan2(ty - fy, tx - fx);
  const len = 16;
  for (const da of [-0.45, 0.45]) {
    g.appendChild(rc.line(tx, ty, tx - len * Math.cos(a + da), ty - len * Math.sin(a + da), opts));
  }
}

export async function arrow(stage, op) {
  const from = stage.point(op.from, [600, 500]);
  const to = stage.markPoint(op.to, [500, 500]);
  const m = new SvgMark(stage);
  const rc = roughFor(stage.marksSvg);
  const opts = { stroke: INK, strokeWidth: 2.2, roughness: 0.9, seed: nextSeed() };
  // A gentle bow reads as hand-drawn; straight lines look mechanical.
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const nx = -(to[1] - from[1]) * 0.12;
  const ny = (to[0] - from[0]) * 0.12;
  m.g.appendChild(rc.curve([from, [mx + nx, my + ny], to], opts));
  arrowHead(rc, m.g, [mx + nx, my + ny], to, opts);
  let label;
  if (op.text) {
    label = document.createElement("div");
    label.className = "mark-label";
    label.textContent = str(op.text);
    stage.layer.appendChild(label);
    const r = label.getBoundingClientRect();
    const left = from[0] < to[0] ? from[0] - r.width - 6 : from[0] + 6;
    label.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, left))}px`;
    label.style.top = `${Math.max(8, from[1] - r.height / 2)}px`;
  }
  await stage.pen.moveTo(from[0], from[1]);
  label?.classList.add("in");
  await m.draw(600);
  return label ? new HtmlMark(label, m) : m;
}

export async function label(stage, op) {
  const at = stage.markPoint(op.at, [500, 500]);
  const c = color(op.color || "blue");
  const el = document.createElement("div");
  el.className = "tag screen-tag";
  el.textContent = str(op.text);
  Object.assign(el.style, { background: c.fill, borderColor: c.stroke, color: c.ink });
  stage.layer.appendChild(el);
  const r = el.getBoundingClientRect();
  const side = ["left", "right", "top", "bottom"].includes(op.side) ? op.side : at[0] > window.innerWidth * 0.6 ? "left" : "right";
  const gap = 70;
  let x = side === "left" ? at[0] - gap - r.width : side === "right" ? at[0] + gap : at[0] - r.width / 2;
  let y = side === "top" ? at[1] - gap - r.height : side === "bottom" ? at[1] + gap : at[1] - r.height / 2 - 18;
  x = Math.max(8, Math.min(window.innerWidth - r.width - 8, x));
  y = Math.max(8, Math.min(window.innerHeight - r.height - 8, y));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  // Leader from the nearest edge of the tag to the point.
  const ex = Math.max(x, Math.min(x + r.width, at[0]));
  const ey = Math.max(y, Math.min(y + r.height, at[1]));
  const m = new SvgMark(stage);
  const rc = roughFor(stage.marksSvg);
  m.g.appendChild(rc.line(ex, ey, at[0], at[1], { stroke: INK, strokeWidth: 1.3, roughness: 0.5, seed: nextSeed() }));
  m.g.appendChild(rc.circle(at[0], at[1], 7, { stroke: INK, fill: INK, fillStyle: "solid", roughness: 0.3, seed: nextSeed() }));
  await stage.pen.moveTo(at[0], at[1]);
  await m.draw(300);
  el.classList.add("in");
  await sleep(250);
  return new HtmlMark(el, m);
}

export async function point(stage, op) {
  const at = stage.markPoint(op.at, [500, 500]);
  await stage.pen.moveTo(at[0], at[1]);
  const ripple = document.createElement("div");
  ripple.className = "ripple";
  ripple.style.left = `${at[0]}px`;
  ripple.style.top = `${at[1]}px`;
  stage.layer.appendChild(ripple);
  setTimeout(() => ripple.remove(), 1200);
  await stage.pen.tap();
  return null;
}

/** A spot near (x, y) for a w×h note that does not cover a card or a 3D scene, and stays on screen. */
function clearSpot(stage, x, y, w, h) {
  const blockers = [...stage.layer.querySelectorAll(".card, .scene3d")].map((el) => el.getBoundingClientRect());
  const fits = (px, py) => !blockers.some((b) => px < b.right + 10 && px + w > b.left - 10 && py < b.bottom + 10 && py + h > b.top - 10);
  const clamp = (px, py) => [Math.max(8, Math.min(window.innerWidth - w - 8, px)), Math.max(8, Math.min(window.innerHeight - h - 8, py))];
  const start = clamp(x, y);
  if (fits(...start)) return start;
  for (let step = 1; step <= 14; step++) {
    const d = step * 40;
    for (const [dx, dy] of [[-d, 0], [0, d], [0, -d], [d, 0], [-d, d], [-d, -d]]) {
      const p = clamp(x + dx, y + dy);
      if (fits(...p)) return p;
    }
  }
  return start;
}

export async function note(stage, op) {
  const at = stage.point(op.at ?? (op.box ? [op.box[0], op.box[1]] : null), [80, 120]);
  const c = color(op.color || "yellow");
  const el = document.createElement("div");
  el.className = "note";
  el.dataset.interactive = "";
  el.textContent = str(op.text);
  el.style.background = c === color("yellow") ? "#fff1a8" : c.fill;
  el.style.setProperty("--tilt", `${(nextSeed() % 7) - 3}deg`);
  stage.layer.appendChild(el);
  const r = el.getBoundingClientRect();
  const [x, y] = clearSpot(stage, at[0], at[1], r.width, r.height);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  await stage.pen.moveTo(x + 20, y + 20);
  el.classList.add("in");
  await sleep(450);
  return new HtmlMark(el);
}
