// What the user meant by pointing: the words that mean "this thing", and the mouse path traced while asking, mapped onto
// the screenshot. No Electron here, so the Chrome extension shares it.

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

module.exports = { POINTING, toImage, gestureOnShot };
