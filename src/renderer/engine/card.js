// Paper explainer cards. The model only says where a card goes and what is in each row; the card lays itself out.

import { color, drawIn, INK, nextSeed, roughFor, sleep, svgEl } from "./sketch.js";
import { iconSvg } from "./icons.js";

const text = (v) => (v == null ? "" : String(v)).slice(0, 160);

export class Card {
  constructor(stage, op) {
    this.stage = stage;
    this.id = op.id || `card${stage.seq++}`;
    const [x0, y0, x1] = stage.box(op.box, [640, 160, 960, 600]);
    const width = Math.max(280, Math.min(560, x1 - x0));
    this.el = document.createElement("div");
    this.el.className = "card";
    this.el.dataset.interactive = "";
    this.el.style.left = `${Math.min(x0, window.innerWidth - width - 12)}px`;
    this.el.style.top = `${Math.max(12, y0)}px`;
    this.el.style.width = `${width}px`;
    this.el.innerHTML = `<button class="card-close" title="Close">×</button>${op.kicker ? `<div class="card-kicker"></div>` : ""}<div class="card-title"></div><div class="card-body"></div>`;
    if (op.kicker) this.el.querySelector(".card-kicker").textContent = text(op.kicker);
    this.el.querySelector(".card-title").textContent = text(op.title);
    this.el.querySelector(".card-close").addEventListener("click", () => stage.removeItem(this));
    this.body = this.el.querySelector(".card-body");
    stage.layer.appendChild(this.el);
  }

  async appear() {
    const r = this.el.getBoundingClientRect();
    await this.stage.pen.moveTo(r.left + 24, r.top + 30);
    this.el.classList.add("in");
    await sleep(260);
    const title = this.el.querySelector(".card-title");
    title.classList.add("write");
    await sleep(Math.min(700, 120 + title.textContent.length * 18));
  }

  async addRow(op) {
    const row = document.createElement("div");
    row.className = "row";
    if (op.step != null && op.step !== "") {
      const step = document.createElement("div");
      step.className = "step";
      step.textContent = text(op.step).slice(0, 3);
      row.appendChild(step);
    }
    const items = document.createElement("div");
    items.className = "items";
    row.appendChild(items);
    let caption;
    if (op.caption) {
      caption = document.createElement("div");
      caption.className = "caption";
      caption.textContent = text(op.caption);
    }
    this.body.appendChild(row);
    if (caption) this.body.appendChild(caption);

    const list = Array.isArray(op.items) ? op.items.slice(0, 8) : [];
    const built = list.map((item) => this._buildItem(item)).filter(Boolean);
    built.forEach((b) => items.appendChild(b.el));
    this.keepOnScreen();
    row.classList.add("in");
    for (const b of built) await b.reveal();
    if (caption) {
      caption.classList.add("in");
      await sleep(200);
    }
  }

  _buildItem(item) {
    if (typeof item === "string") item = item === "->" || item === "→" ? { arrow: "" } : { text: item };
    if (!item || typeof item !== "object") return null;
    const pen = this.stage.pen;
    if (item.arrow !== undefined || item.type === "arrow") {
      const el = document.createElement("span");
      el.className = "item arrow";
      const label = text(item.arrow ?? item.text);
      el.innerHTML = `${label ? `<span class="arrow-label"></span>` : ""}<svg width="64" height="22"></svg>`;
      if (label) el.querySelector(".arrow-label").textContent = label;
      return {
        el,
        reveal: async () => {
          const svg = el.querySelector("svg");
          const rc = roughFor(svg);
          const g = svgEl("g", {}, svg);
          const opts = { stroke: INK, strokeWidth: 1.6, roughness: 0.8, seed: nextSeed() };
          g.appendChild(rc.line(4, 11, 58, 11, opts));
          g.appendChild(rc.line(50, 5, 59, 11, opts));
          g.appendChild(rc.line(50, 17, 59, 11, opts));
          const r = svg.getBoundingClientRect();
          await pen.moveTo(r.left + 4, r.top + 11, 160);
          el.classList.add("in");
          await drawIn(g, { duration: 320, pen, toScreen: (x, y) => ({ x: r.left + x, y: r.top + y }) });
        },
      };
    }
    if (item.icon) {
      const el = document.createElement("span");
      el.className = "item icon";
      el.innerHTML = iconSvg(item.icon);
      return {
        el,
        reveal: async () => {
          const r = el.getBoundingClientRect();
          await pen.moveTo(r.left + 6, r.top + 8, 160);
          el.classList.add("in");
          const svg = el.querySelector("svg");
          await drawIn(svg, { duration: 420, pen, toScreen: (x, y) => ({ x: r.left + x * 1.25, y: r.top + y * 1.25 }) });
        },
      };
    }
    if (item.box !== undefined || item.type === "box") {
      const c = color(item.color);
      const el = document.createElement("span");
      el.className = "item box";
      el.innerHTML = `<svg class="box-frame"></svg><span class="box-text"></span>`;
      el.querySelector(".box-text").textContent = text(item.box ?? item.text);
      el.style.color = c.ink;
      return {
        el,
        reveal: async () => {
          const r = el.getBoundingClientRect();
          const svg = el.querySelector("svg");
          svg.setAttribute("width", r.width + 8);
          svg.setAttribute("height", r.height + 8);
          const rc = roughFor(svg);
          const g = svgEl("g", {}, svg);
          g.appendChild(
            rc.rectangle(4, 4, r.width, r.height, {
              stroke: c.stroke,
              strokeWidth: 1.6,
              fill: c.fill,
              fillStyle: "solid",
              roughness: 0.9,
              bowing: 0.6,
              seed: nextSeed(),
            }),
          );
          await pen.moveTo(r.left, r.top, 160);
          el.classList.add("in");
          await drawIn(g, { duration: 360, pen, toScreen: (x, y) => ({ x: r.left - 4 + x, y: r.top - 4 + y }) });
          el.classList.add("filled");
        },
      };
    }
    const el = document.createElement("span");
    el.className = "item words";
    el.textContent = text(item.text ?? item.label ?? "");
    if (!el.textContent) return null;
    return {
      el,
      reveal: async () => {
        const r = el.getBoundingClientRect();
        await pen.moveTo(r.left, r.top + r.height * 0.6, 160);
        el.classList.add("in");
        await sleep(Math.min(500, 80 + el.textContent.length * 22));
      },
    };
  }

  async addText(op) {
    const p = document.createElement("div");
    p.className = `card-text ${op.size === "small" ? "small" : ""}`;
    p.textContent = text(op.text);
    this.body.appendChild(p);
    this.keepOnScreen();
    const r = p.getBoundingClientRect();
    await this.stage.pen.moveTo(r.left, r.top + 12, 200);
    p.classList.add("in");
    await sleep(Math.min(900, 150 + p.textContent.length * 14));
  }

  async addChart(op) {
    const pts = (Array.isArray(op.points) ? op.points : [])
      .map((p) => (Array.isArray(p) ? { label: text(p[0]), value: Number(p[1]) } : { label: text(p?.label ?? p?.x), value: Number(p?.value ?? p?.y) }))
      .filter((p) => Number.isFinite(p.value))
      .slice(0, 12);
    if (pts.length < 2) return;
    const wrap = document.createElement("div");
    wrap.className = "chart";
    if (op.title) {
      const t = document.createElement("div");
      t.className = "chart-title";
      t.textContent = text(op.title);
      wrap.appendChild(t);
    }
    const W = this.body.clientWidth || 300;
    const H = 130;
    const svg = svgEl("svg", { width: W, height: H });
    wrap.appendChild(svg);
    this.body.appendChild(wrap);
    this.keepOnScreen();
    wrap.classList.add("in");

    const rc = roughFor(svg);
    const min = Math.min(0, ...pts.map((p) => p.value));
    const max = Math.max(...pts.map((p) => p.value)) || 1;
    const left = 14;
    const bottom = H - 24;
    const top = 14;
    const step = (W - left * 2) / (pts.length - (op.type === "bar" ? 0 : 1));
    const yOf = (v) => bottom - ((v - min) / (max - min || 1)) * (bottom - top);
    const g = svgEl("g", {}, svg);
    g.appendChild(rc.line(left, bottom, W - left, bottom, { stroke: "#9b968a", strokeWidth: 1.2, roughness: 0.6, seed: nextSeed() }));
    const accent = color(op.color || "blue");
    if (op.type === "bar") {
      pts.forEach((p, i) => {
        const x = left + i * step + step * 0.18;
        const y = yOf(p.value);
        g.appendChild(rc.rectangle(x, y, step * 0.64, bottom - y, { stroke: accent.stroke, fill: accent.fill, fillStyle: "hachure", hachureGap: 5, roughness: 0.9, seed: nextSeed() }));
      });
    } else {
      const coords = pts.map((p, i) => [left + i * step, yOf(p.value)]);
      g.appendChild(rc.curve(coords, { stroke: "#d9a521", strokeWidth: 2.2, roughness: 0.6, seed: nextSeed() }));
      coords.forEach(([x, y]) => g.appendChild(rc.circle(x, y, 7, { stroke: INK, fill: "#2d2b28", fillStyle: "solid", roughness: 0.4, seed: nextSeed() })));
    }
    pts.forEach((p, i) => {
      const x = left + i * step + (op.type === "bar" ? step / 2 : 0);
      const label = svgEl("text", { x, y: H - 6, "text-anchor": i === 0 && op.type !== "bar" ? "start" : i === pts.length - 1 && op.type !== "bar" ? "end" : "middle", class: "chart-label" }, svg);
      label.textContent = p.label;
    });
    const r = svg.getBoundingClientRect();
    await drawIn(g, { duration: 900, pen: this.stage.pen, toScreen: (x, y) => ({ x: r.left + x, y: r.top + y }) });
  }

  /** Cards grow downwards; slide the card up if it would run off the screen. */
  keepOnScreen() {
    const r = this.el.getBoundingClientRect();
    const over = r.bottom - (window.innerHeight - 16);
    if (over > 0) this.el.style.top = `${Math.max(12, r.top - over)}px`;
  }

  remove() {
    this.el.classList.add("out");
    setTimeout(() => this.el.remove(), 320);
  }
}
