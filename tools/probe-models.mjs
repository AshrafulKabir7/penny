// Ask a model about a screenshot without the app, and save the JSONL it writes.
//   node tools/probe-models.mjs <model id> <screenshot.jpg> "<question>" [out.jsonl]
//   node tools/probe-models.mjs cmd:deepseek/deepseek-v4.1-flash shot.jpg "How does this work?"

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { createProvider } = require("../src/main/providers/index.js");

const [id, image, question, out] = process.argv.slice(2);
if (!id || !image || !question) {
  console.error('usage: node tools/probe-models.mjs <model id> <screenshot.jpg> "<question>" [out.jsonl]');
  process.exit(1);
}

const jpeg = readFileSync(image);
// JPEG size from the SOF0/SOF2 marker, so the prompt can state the screen size.
function jpegSize(buf) {
  for (let i = 2; i < buf.length; ) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { width: 1600, height: 900 };
}

const provider = createProvider(id, (line) => console.error(line));
const t0 = Date.now();
await provider.warm();
console.error(`warm: ${Date.now() - t0} ms`);
const t1 = Date.now();
let first = 0;
const size = jpegSize(jpeg);
const shot = { jpeg, ...size, imageWidth: size.width, imageHeight: size.height, title: "" };
// POINTER="x,y" (screenshot pixels) and CLOSEUP=<jpg> simulate the user pointing while asking; the screenshot should
// already have the pointer marked on it.
if (process.env.POINTER) {
  const [x, y] = process.env.POINTER.split(",").map(Number);
  shot.pointer = { x, y, meant: true };
  if (process.env.CLOSEUP) {
    shot.closeup = readFileSync(process.env.CLOSEUP);
    const cx = Math.max(0, Math.min(size.width - 440, Math.round(x - 220)));
    const cy = Math.max(0, Math.min(size.height - 260, Math.round(y - 130)));
    shot.closeupBox = [cx, cy, cx + 440, cy + 260];
  }
}
const res = await provider.ask({
  question,
  shot,
  visualsOnScreen: false,
  onDelta: (t) => {
    if (!first) first = Date.now() - t1;
    process.stdout.write(t);
  },
});
console.error(`\nfirst token: ${first} ms, answer: ${Date.now() - t1} ms, ${res.text.length} chars`);
if (out) writeFileSync(out, `${JSON.stringify({ op: "space", w: size.width, h: size.height })}\n${res.text}`);
provider.dispose();
process.exit(0);
