// The app's half of "3D from pictures": crops the object out of the answer's screenshot and has Idol sculpt it, keeping
// each result on disk by picture, so asking again about the same thing spends no GPU time.

const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { nativeImage } = require("electron");
const idol = require("./idol");

/** The object in `box` (fractions of the screenshot) of `jpeg`, as a PNG with a little room around it. */
function cropObject(jpeg, box) {
  const img = nativeImage.createFromBuffer(jpeg);
  const { width, height } = img.getSize();
  const [bx0, by0, bx1, by1] = box.map(Number);
  // A little room around the object helps Idol find its edges (it cuts the background out itself).
  const mx = (bx1 - bx0) * 0.06;
  const my = (by1 - by0) * 0.06;
  const x = Math.max(0, Math.floor((bx0 - mx) * width));
  const y = Math.max(0, Math.floor((by0 - my) * height));
  const w = Math.min(width - x, Math.ceil((bx1 - bx0 + 2 * mx) * width));
  const h = Math.min(height - y, Math.ceil((by1 - by0 + 2 * my) * height));
  if (!(w >= 24 && h >= 24)) throw new Error("That part of the screen is too small to sculpt.");
  return img.crop({ x, y, width: w, height: h }).toPNG();
}

/** Resolves with the .ply bytes of the object in `box` of `jpeg`. */
async function sculptFromScreenshot({ jpeg, box, photo, token, space, cacheDir, log = () => {} }) {
  const png = cropObject(jpeg, box);
  const file = join(cacheDir, `${createHash("sha256").update(png).update(photo ? "photo" : "render").digest("hex").slice(0, 32)}.ply`);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  const started = Date.now();
  log(`[idol] sculpting ${png.length} bytes of picture (${photo ? "photo" : "render"})`);
  const bytes = await idol.sculpt({ image: new Blob([png], { type: "image/png" }), photo, token, space });
  log(`[idol] done in ${((Date.now() - started) / 1000).toFixed(1)}s, ${(bytes.length / 1e6).toFixed(1)} MB`);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, bytes);
  return bytes;
}

module.exports = { sculptFromScreenshot, cropObject };
