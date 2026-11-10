// The stage runs scene ops in order, keeps speech and drawing in step, and owns everything on the overlay.
//
// Speech timing: a "say" waits for the previous sentence to finish, then starts speaking and lets the queue move on,
// so the drawings sent after a sentence appear while that sentence is being spoken.

import { Card } from "./card.js";
import * as marks from "./marks.js";
import { Pen, svgEl } from "./sketch.js";

const SNAP_PX = 110;

const ALIASES = { speak: "say", narrate: "say", voice: "say", ellipse: "circle", loop: "circle", line: "arrow", sticky: "note",
  tag3d: "tag", mesh: "part", object: "part", model: "scene", scene3d: "scene", camera: "focus", pause: "wait", marker: "highlight" };

export class Stage {
  constructor(root, { speaker, onInteractive = () => {}, onVisuals = () => {}, onCaption = () => {}, onSculpt = null }) {
    this.root = root;
    this.speaker = speaker;
    this.onSculpt = onSculpt; // ({ box, photo }) => Promise<Uint8Array>, the .ply of a pictured object (Idol)
    this.onInteractive = onInteractive;
    this.onVisuals = onVisuals;
    this.onCaption = onCaption;
    this.layer = document.createElement("div");
    this.layer.className = "layer";
    root.appendChild(this.layer);
    this.marksSvg = svgEl("svg", { class: "marks" });
    this.layer.appendChild(this.marksSvg);
    this.pen = new Pen(root);
    this.items = [];
    this.cards = new Map();
    this.scenesById = new Map();
    this.scenes = new Set();
    this.queue = [];
    this.running = false;
    this.speech = Promise.resolve();
    this.generation = 0;
    this.seq = 0;
    this.interactive = false;
    this.pointerDown = false;
    this.space = { w: 1000, h: 1000 };
    this._loop();
    this._trackHover();
  }

  // ------------------------------------------------------------ coordinates
  // The model answers in the pixels of the screenshot it saw (`space`); demos use a 1000×1000 space.
  // Fallback positions below are written in 1000×1000 units and scaled into the current space.

  point(p, fallback = [500, 500]) {
    const { w, h } = this.space;
    if (p === "pointer" && this.pointer) p = [this.pointer.x, this.pointer.y];
    const [x, y] = Array.isArray(p) && p.length >= 2 ? p : [(fallback[0] / 1000) * w, (fallback[1] / 1000) * h];
    const nx = Math.max(0, Math.min(w, Number(x) || 0));
    const ny = Math.max(0, Math.min(h, Number(y) || 0));
    return [(nx / w) * window.innerWidth, (ny / h) * window.innerHeight];
  }

  box(b, fallback = [400, 400, 600, 600]) {
    const { w, h } = this.space;
    if (b === "pointer" && this.pointer) {
      if (Array.isArray(this.pointer.box)) b = this.pointer.box; // the area the user circled
      else {
        const [x, y] = this.point("pointer");
        return [x - 70, y - 22, x + 70, y + 22];
      }
    }
    const src = Array.isArray(b) && b.length >= 4 ? b : fallback.map((v, i) => (v / 1000) * (i % 2 ? h : w));
    const [ax, ay] = this.point([src[0], src[1]]);
    const [bx, by] = this.point([src[2], src[3]]);
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  }

  // When the user pointed while asking ("what is this?"), a mark the model meant for that spot is usually a little off.
  // Points within reach of the pointer snap onto it, and boxes near it shift just enough to contain it.

  get pointerPx() {
    return this.pointer?.meant ? this.point("pointer") : null;
  }

  markPoint(p, fallback) {
    const pt = this.point(p, fallback);
    const ptr = this.pointerPx;
    if (ptr && p !== "pointer" && Math.hypot(pt[0] - ptr[0], pt[1] - ptr[1]) < SNAP_PX) return ptr;
    return pt;
  }

  markBox(b, fallback) {
    let [x0, y0, x1, y1] = this.box(b, fallback);
    const ptr = this.pointerPx;
    if (!ptr || b === "pointer") return [x0, y0, x1, y1];
    const [px, py] = ptr;
    const dx = px < x0 ? px - x0 - 8 : px > x1 ? px - x1 + 8 : 0;
    const dy = py < y0 ? py - y0 - 8 : py > y1 ? py - y1 + 8 : 0;
    if ((dx || dy) && Math.hypot(dx, dy) < SNAP_PX) [x0, y0, x1, y1] = [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
    return [x0, y0, x1, y1];
  }

  // ------------------------------------------------------------ queue

  /** Starts a new answer: anything still queued from the previous one is dropped. */
  beginAnswer(space) {
    this.space = space && space.w > 0 && space.h > 0 ? space : { w: 1000, h: 1000 };
    this.pointer = null;
    this.generation++;
    this.queue = [];
    this.speaker.stop();
    this.speech = Promise.resolve();
  }

  enqueue(op) {
    if (!op || typeof op.op !== "string") return;
    op.op = ALIASES[op.op.toLowerCase()] || op.op.toLowerCase();
    if (op.op === "say") {
      const text = String(op.text ?? op.say ?? "").trim();
      if (!text) return;
      op.speech = this.speaker.prepare(text);
    }
    this.queue.push({ op, gen: this.generation });
    this._pump();
  }

  /** Resolves once everything queued so far has been drawn and spoken. */
  async finish() {
    const gen = this.generation;
    while ((this.running || this.queue.length) && gen === this.generation) await new Promise((r) => setTimeout(r, 60));
    await this.speech;
    if (gen === this.generation) this.pen.idle();
  }

  async _pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const { op, gen } = this.queue.shift();
      if (gen !== this.generation) continue;
      try {
        await this._run(op, gen);
      } catch (err) {
        console.warn("op failed", op, err);
      }
    }
    this.running = false;
  }

  _keep(item) {
    if (!item) return;
    this.items.push(item);
    this.onVisuals(true);
  }

  async _run(op, gen) {
    switch (op.op) {
      case "say": {
        await this.speech;
        if (gen !== this.generation) return;
        this.onCaption(op.speech.text);
        this.speech = this.speaker.play(op.speech);
        return;
      }
      case "space": // saved replies say which screenshot size their coordinates are in
        if (op.w > 0 && op.h > 0) this.space = { w: Number(op.w), h: Number(op.h) };
        return undefined;
      case "wait":
        return new Promise((r) => setTimeout(r, Math.max(0, Math.min(3000, Number(op.ms) || 500))));
      case "clear":
        return this.clear();
      case "circle":
      case "underline":
      case "highlight":
      case "arrow":
      case "label":
      case "point":
      case "note":
        return this._keep(await marks[op.op](this, op));
      case "card": {
        const old = this.cards.get(op.id);
        if (old) this.removeItem(old);
        const card = new Card(this, op);
        this.cards.set(card.id, card);
        this._keep(card);
        return card.appear();
      }
      case "row":
      case "text":
      case "chart": {
        const card = this._cardFor(op.card);
        if (op.op === "row") return card.addRow(op);
        if (op.op === "text") return card.addText(op);
        return card.addChart(op);
      }
      case "scene":
        return this._scene(op.id, op);
      case "part":
      case "replica":
      case "tag":
      case "spin":
      case "move":
      case "flow":
      case "force":
      case "focus": {
        const scene = await this._scene(op.scene);
        if (op.op === "tag" || op.op === "move") {
          const p = scene.screenPoint(op.target);
          await this.pen.moveTo(p.x, p.y, 220);
        }
        return scene[op.op](op);
      }
      default:
        return undefined; // unknown ops are skipped
    }
  }

  /**
   * Asks the app to sculpt the object in part of the screen. The box goes as fractions of the screen, the same in the
   * screenshot the app holds. "from" may be "pointer": what the user points at or circled.
   */
  sculpt(op) {
    if (!this.onSculpt) return Promise.reject(new Error("3D from pictures isn't available here."));
    const [x0, y0, x1, y1] = this.box(op.from ?? op.box ?? "pointer");
    const W = window.innerWidth;
    const H = window.innerHeight;
    const box = [x0 / W, y0 / H, x1 / W, y1 / H].map((v) => Math.max(0, Math.min(1, v)));
    if (box[2] - box[0] < 0.01 || box[3] - box[1] < 0.01) return Promise.reject(new Error("Nothing to sculpt there."));
    return this.onSculpt({ box, photo: !!op.photo });
  }

  _cardFor(id) {
    const key = id ?? [...this.cards.keys()].pop();
    if (key != null && this.cards.has(key)) return this.cards.get(key);
    const card = new Card(this, { id: key ?? undefined });
    this.cards.set(card.id, card);
    this._keep(card);
    card.el.classList.add("in");
    return card;
  }

  async _scene(id, op) {
    const key = id ?? [...this.scenesById.keys()].pop() ?? "s1";
    let scene = this.scenesById.get(key);
    // A repeated "scene" op in the same answer keeps the scene; in a later answer it starts that scene over.
    if (scene && op && scene.generation !== this.generation) {
      this.removeItem(scene);
      scene = null;
    }
    // Models sometimes send a part before its scene: that made the scene at a default spot, and its own op now places it.
    if (scene && op?.box && scene.provisional) scene.place(op);
    if (scene) return scene;
    if (!scene) {
      const { Scene3D } = await import("./scene3d.js");
      scene = new Scene3D(this, { ...(op || {}), id: key });
      scene.generation = this.generation;
      this.scenesById.set(key, scene);
      this._keep(scene);
      const r = scene.el.getBoundingClientRect();
      await this.pen.moveTo(r.left + r.width / 2, r.top + r.height / 2);
    }
    return scene;
  }

  // ------------------------------------------------------------ clearing

  removeItem(item) {
    item.remove();
    this.items = this.items.filter((i) => i !== item);
    for (const [k, v] of this.cards) if (v === item) this.cards.delete(k);
    for (const [k, v] of this.scenesById) if (v === item) this.scenesById.delete(k);
    if (!this.items.length) {
      this.onVisuals(false);
      this._setInteractive(false);
    }
  }

  clear() {
    for (const item of [...this.items]) this.removeItem(item);
    this.items = [];
    this.cards.clear();
    this.scenesById.clear();
    this.onVisuals(false);
  }

  /** Stops talking and drawing, and wipes the screen. */
  reset() {
    this.beginAnswer();
    this.clear();
    this.pen.idle(0);
  }

  // ------------------------------------------------------------ frame loop and click-through

  _loop() {
    const frame = () => {
      for (const s of this.scenes) s.tick();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  _setInteractive(on) {
    if (on === this.interactive) return;
    this.interactive = on;
    this.onInteractive(on);
  }

  /** The overlay lets clicks through except over cards, notes and 3D scenes. */
  _trackHover() {
    document.addEventListener("pointerdown", () => (this.pointerDown = true), true);
    document.addEventListener("pointerup", () => (this.pointerDown = false), true);
    document.addEventListener("mousemove", (e) => {
      if (this.pointerDown) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      this._setInteractive(!!el?.closest?.("[data-interactive]"));
    });
  }
}
