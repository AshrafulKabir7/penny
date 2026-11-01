// Screen capture for the model: the display under the cursor, without Talky's own drawings in it.

const { desktopCapturer, screen } = require("electron");

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
  return { jpeg: image.toJPEG(82), ...real, imageWidth: sent.width, imageHeight: sent.height, displayId: display.id, at: Date.now() };
}

module.exports = { captureScreen, activeDisplay };
