// Screen capture for the model: the display under the cursor, without Talky's own drawings in it.

const { desktopCapturer, nativeImage, screen } = require("electron");

const MAX_WIDTH = 1600;

function activeDisplay() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/**
 * Returns { jpeg, width, height, imageWidth, imageHeight, displayId }. `width`/`height` are the display's real pixels;
 * the JPEG is at most 1600 px wide, which is plenty for reading text and keeps the prompt small. The capturer scales it
 * directly, which is much faster than grabbing full resolution and resizing.
 * `hideDrawings` (optional) is an async function that hides Talky's drawings and returns a function that shows them again.
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
function markPointer(shot, pt) {
  const img = nativeImage.createFromBuffer(shot.jpeg);
  const { width, height } = img.getSize();
  const px = img.toBitmap(); // BGRA
  const paint = (r0, r1, [r, g, b]) => {
    for (let y = Math.max(0, pt.y - r1); y <= Math.min(height - 1, pt.y + r1); y++) {
      for (let x = Math.max(0, pt.x - r1); x <= Math.min(width - 1, pt.x + r1); x++) {
        const d = Math.hypot(x - pt.x, y - pt.y);
        if (d < r0 || d > r1) continue;
        const i = (y * width + x) * 4;
        px[i] = b;
        px[i + 1] = g;
        px[i + 2] = r;
        px[i + 3] = 255;
      }
    }
  };
  paint(11, 20, [255, 255, 255]); // halo so the ring shows on any background
  paint(13, 18, [236, 0, 170]);
  paint(0, 2.5, [236, 0, 170]);
  const marked = nativeImage.createFromBitmap(px, { width, height });
  const cw = Math.min(width, 440);
  const ch = Math.min(height, 260);
  const cx = Math.max(0, Math.min(width - cw, Math.round(pt.x - cw / 2)));
  const cy = Math.max(0, Math.min(height - ch, Math.round(pt.y - ch / 2)));
  const closeup = marked.crop({ x: cx, y: cy, width: cw, height: ch }).resize({ width: cw * 2, quality: "best" });
  return { jpeg: marked.toJPEG(85), closeup: closeup.toJPEG(85), closeupBox: [cx, cy, cx + cw, cy + ch] };
}

module.exports = { captureScreen, activeDisplay, markPointer };
