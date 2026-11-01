// While Talky listens, the mouse leaves a fading yellow ink trail and a little sound-level badge rides next to the
// cursor, so circling or pointing at something while you talk is visible, and the path goes to the model as a gesture.
// The overlay ignores the mouse but still receives forwarded mouse moves, so this works over any app.

const FADE_MS = 1600;
const BARS = 5;

export class Trail {
  constructor(root) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "trail";
    this.ctx = this.canvas.getContext("2d");
    this.badge = document.createElement("div");
    this.badge.className = "cursor-badge";
    this.badge.innerHTML = `<span class="bars">${"<i></i>".repeat(BARS)}</span><span class="dots"><i></i><i></i><i></i></span>`;
    this.bars = [...this.badge.querySelectorAll(".bars i")];
    root.append(this.canvas, this.badge);
    this.points = []; // recent points for drawing: { x, y, t }
    this.path = []; // the whole gesture while recording
    this.recording = false;
    this.mode = null;
    this.mouse = null;
    this.running = false;
    this._resize();
    window.addEventListener("resize", () => this._resize());
    document.addEventListener("mousemove", (e) => this._move(e.clientX, e.clientY), true);
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _move(x, y) {
    this.mouse = { x, y };
    if (this.mode) this._placeBadge();
    if (!this.recording) return;
    const t = performance.now();
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < 2) return;
    this.points.push({ x, y, t });
    this.path.push([Math.round(x), Math.round(y)]);
    this._run();
  }

  _placeBadge() {
    this.badge.style.transform = `translate(${this.mouse.x + 16}px, ${this.mouse.y + 18}px)`;
  }

  /** Starts recording a gesture and drawing the trail. */
  start() {
    // The overlay window is created hidden, and its size can read as 0 at that point; size the canvas now.
    this._resize();
    this.recording = true;
    this.points = [];
    this.path = [];
    this.setMode("listening");
  }

  /** Stops recording; returns the gesture in window pixels (at most 240 points). */
  stop() {
    this.recording = false;
    const step = Math.max(1, Math.ceil(this.path.length / 240));
    return this.path.filter((_, i) => i % step === 0 || i === this.path.length - 1);
  }

  /** "listening" shows level bars by the cursor, "thinking" shows dots, null hides the badge. */
  setMode(mode) {
    this.mode = mode;
    this.badge.className = `cursor-badge${mode ? ` on ${mode}` : ""}`;
    if (mode && this.mouse) this._placeBadge();
  }

  setLevel(level) {
    if (this.mode !== "listening") return;
    const now = performance.now();
    this.bars.forEach((b, i) => (b.style.height = `${4 + Math.round(level * 13 * (0.55 + 0.45 * Math.sin(i * 1.9 + now / 110)))}px`));
  }

  _run() {
    if (this.running) return;
    this.running = true;
    const frame = () => {
      const now = performance.now();
      this.points = this.points.filter((p) => now - p.t < FADE_MS);
      try {
        this._draw(now);
        this.frames = (this.frames || 0) + 1;
      } catch (err) {
        this.lastError = String(err); // never let one bad frame end the loop
      }
      if (this.points.length || this.recording) requestAnimationFrame(frame);
      else {
        this.running = false;
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    };
    requestAnimationFrame(frame);
  }

  /** A highlighter stroke whose older end thins out and fades. */
  _draw(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const pts = this.points;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    // Curves through the midpoints, so fast flicks with sparse points still look like ink.
    for (let i = 1; i < pts.length; i++) {
      const life = 1 - (now - pts[i].t) / FADE_MS;
      if (life <= 0) continue;
      const from = i === 1 ? pts[0] : mid(pts[i - 1], pts[i - 2] ?? pts[i - 1]);
      const to = mid(pts[i], pts[i - 1]);
      ctx.strokeStyle = `rgba(245, 197, 24, ${0.25 + 0.55 * life})`;
      ctx.lineWidth = 3 + 6 * life;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, to.x, to.y);
      if (i === pts.length - 1) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  }
}
