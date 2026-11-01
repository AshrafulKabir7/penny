// Screen capture for the model: the display under the cursor, without Penny's own drawings in it.

const { desktopCapturer, nativeImage, screen } = require("electron");

const MAX_WIDTH = 1600;

function activeDisplay() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/**
 * Returns { jpeg, width, height, imageWidth, imageHeight, displayId }. `width`/`height` are the display's real pixels;
 * the JPEG is at most 1600 px wide, which is plenty for reading text and keeps the prompt small. The capturer scales it
 * directly, which is much faster than grabbing full resolution and resizing.
 * `hideDrawings` (optional) is an async function that hides Penny's drawings and returns a function that shows them again.
 */
async function captureScreen({ display = activeDisplay(), hideDrawings, full = false, format = "jpeg" } = {}) {
  const { width, height } = display.size;
  const sf = display.scaleFactor || 1;
  const real = { width: Math.round(width * sf), height: Math.round(height * sf) };
  const scale = full ? 1 : Math.min(1, MAX_WIDTH / real.width);
  const thumbnailSize = { width: Math.round(real.width * scale), height: Math.round(real.height * scale) };
  const restore = hideDrawings ? await hideDrawings() : null;
  let image;
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    if (!source) throw new Error("No screen to capture");
    image = source.thumbnail;
  } finally {
    restore?.();
  }
  if (format === "png") return { png: image.toPNG(), ...real, displayId: display.id };
  const sent = image.getSize();
  // The model answers in the pixels of the image it was shown; the overlay maps those back onto the display.
  return { jpeg: image.toJPEG(82), ...real, imageWidth: sent.width, imageHeight: sent.height, displayId: display.id, bounds: display.bounds, at: Date.now() };
}

/**
 * Draws a magenta ring where the user is pointing and cuts a 2× close-up around it, so the model can read exactly
 * what is under the pointer (a 1600 px screenshot is often shrunk further by the model, and small text is lost).
 * `pt` is in screenshot pixels. Returns { jpeg, closeup, closeupBox }.
 */
function markPointer(shot, pt, gesture) {
  const img = nativeImage.createFromBuffer(shot.jpeg);
  const { width, height } = img.getSize();
  const px = img.toBitmap(); // BGRA
  const paint = (cx, cy, r0, r1, [r, g, b]) => {
    for (let y = Math.max(0, Math.floor(cy - r1)); y <= Math.min(height - 1, cy + r1); y++) {
      for (let x = Math.max(0, Math.floor(cx - r1)); x <= Math.min(width - 1, cx + r1); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r0 || d > r1) continue;
        const i = (y * width + x) * 4;
        px[i] = b;
        px[i + 1] = g;
        px[i + 2] = r;
        px[i + 3] = 255;
      }
    }
  };
  const stroke = (pts, radius, color) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
      for (let s = 0; s <= steps; s++) paint(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps, 0, radius, color);
    }
  };
  if (gesture) {
    // The path the user traced with the mouse, as they saw it: white halo, magenta line.
    stroke(gesture.points, 4.5, [255, 255, 255]);
    stroke(gesture.points, 2.5, [236, 0, 170]);
  }
  if (!gesture?.loop) {
    paint(pt.x, pt.y, 11, 20, [255, 255, 255]); // halo so the ring shows on any background
    paint(pt.x, pt.y, 13, 18, [236, 0, 170]);
    paint(pt.x, pt.y, 0, 2.5, [236, 0, 170]);
  }
  const marked = nativeImage.createFromBitmap(px, { width, height });
  // The close-up covers the circled area when there is one.
  const span = gesture?.loop ? [gesture.box[2] - gesture.box[0], gesture.box[3] - gesture.box[1]] : [0, 0];
  const cw = Math.min(width, Math.max(440, Math.round(span[0] * 1.4)));
  const ch = Math.min(height, Math.max(260, Math.round(span[1] * 1.4)));
  const cx = Math.max(0, Math.min(width - cw, Math.round(pt.x - cw / 2)));
  const cy = Math.max(0, Math.min(height - ch, Math.round(pt.y - ch / 2)));
  const closeup = marked.crop({ x: cx, y: cy, width: cw, height: ch }).resize({ width: Math.min(cw * 2, 1400), quality: "best" });
  return { jpeg: marked.toJPEG(85), closeup: closeup.toJPEG(85), closeupBox: [cx, cy, cx + cw, cy + ch] };
}

module.exports = { captureScreen, activeDisplay, markPointer };
