// Where the user is pointing. The mouse is sampled while they talk; the spot it last rested on is what "this" means.

const { screen } = require("electron");

const SAMPLE_MS = 80;
const REST_PX = 18; // a pointer that stays within this radius is resting
const REST_MS = 280; // ...for at least this long

class PointerTracker {
  constructor() {
    this.samples = [];
    this.timer = 0;
  }

  start() {
    clearInterval(this.timer);
    this.samples = [];
    this._sample();
    this.timer = setInterval(() => this._sample(), SAMPLE_MS);
  }

  _sample() {
    const p = screen.getCursorScreenPoint();
    this.samples.push({ x: p.x, y: p.y, t: Date.now() });
    if (this.samples.length > 600) this.samples.shift();
  }

  /** Stops sampling and returns the point the user meant, in screen coordinates (DIP). */
  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    this._sample();
    return this.focus();
  }

  /** The last place the pointer rested; if it never rested, where it ended up. */
  focus() {
    const s = this.samples;
    if (!s.length) return screen.getCursorScreenPoint();
    for (let end = s.length - 1; end >= 0; end--) {
      let start = end;
      while (start > 0 && Math.hypot(s[start - 1].x - s[end].x, s[start - 1].y - s[end].y) <= REST_PX) start--;
      if (s[end].t - s[start].t >= REST_MS) {
        const run = s.slice(start, end + 1);
        return { x: run.reduce((a, p) => a + p.x, 0) / run.length, y: run.reduce((a, p) => a + p.y, 0) / run.length };
      }
      end = start; // skip past this run
    }
    return { x: s[s.length - 1].x, y: s[s.length - 1].y };
  }
}

/** Words that mean the user is pointing at something on screen. */
const POINTING = /\b(this|that|these|those|here|there|thing under|my (cursor|mouse|pointer))\b/i;

/** Maps a screen point onto the screenshot's pixels; null when the pointer is on another display. */
function toImage(point, shot) {
  const b = shot.bounds;
  if (!point || !b) return null;
  const fx = (point.x - b.x) / b.width;
  const fy = (point.y - b.y) / b.height;
  if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
  return { x: Math.round(fx * shot.imageWidth), y: Math.round(fy * shot.imageHeight) };
}

/**
 * The mouse path the user drew while talking (overlay window pixels) mapped onto the screenshot, with what it means:
 * a loop around something (they circled it) or a stroke that ends where they point. Null if they barely moved.
 */
function gestureOnShot(gesture, shot) {
  if (!gesture?.points?.length || !gesture.view?.[0]) return null;
  const sx = shot.imageWidth / gesture.view[0];
  const sy = shot.imageHeight / gesture.view[1];
  const pts = gesture.points.map(([x, y]) => [Math.round(x * sx), Math.round(y * sy)]);
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const diag = Math.hypot(box[2] - box[0], box[3] - box[1]);
  if (length < 90 || diag < 24) return null;
  const [sx0, sy0] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  // Around something: the path doubles back on itself, or ends near where it started.
  const loop = length > 2.2 * diag || Math.hypot(ex - sx0, ey - sy0) < 0.35 * diag;
  const target = loop ? { x: Math.round((box[0] + box[2]) / 2), y: Math.round((box[1] + box[3]) / 2) } : { x: ex, y: ey };
  return { points: pts, box, loop, target };
}

module.exports = { PointerTracker, POINTING, toImage, gestureOnShot };
