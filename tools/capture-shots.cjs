// Renders Penny's saved demo answers over a neutral page and saves full-resolution PNGs (website, README).
// Runs offscreen, so nothing appears on the screen.
//   npx electron tools/capture-shots.cjs <out dir> [demo ...]
// Each demo is captured at several moments (shot-<demo>-<seconds>s.png) to pick the best frame from.
// A demo can also be a saved reply anywhere in the project ("../../.cache/nn/before/cmd" plays .cache/nn/before/cmd.jsonl).
// BG=<image in the project> draws over that screenshot instead of the neutral page (give SIZE too); MOMENTS=6,12,20 sets
// the capture times.

const { app, BrowserWindow } = require("electron");
const { createServer } = require("node:http");
const { createReadStream, existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { extname, join, normalize, resolve } = require("node:path");

const ROOT = resolve(__dirname, "..");
// SIZE=1600x850 matches the window to a BG screenshot (the overlay maps the answer onto the window).
const [W, H] = (process.env.SIZE || "1440x900").split("x").map(Number);
const MOMENTS = (process.env.MOMENTS || "5,9,13,18,24").split(",").map(Number); // seconds after the demo starts
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jsonl": "text/plain", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff" };

// The "screen" Penny draws on: a calm, generic article page, so the drawings are what you notice.
const PAGE = `<!doctype html><html><body style="margin:0;background:#eef0f3;font:15px 'Segoe UI',sans-serif">
<div style="margin:28px 40px;height:${H - 56}px;border-radius:14px;background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.08);overflow:hidden">
  <div style="height:46px;display:flex;align-items:center;gap:8px;padding:0 18px;background:#f6f7f9;border-bottom:1px solid #e6e8ec">
    <i style="width:12px;height:12px;border-radius:50%;background:#ff6159"></i><i style="width:12px;height:12px;border-radius:50%;background:#ffbd2e"></i><i style="width:12px;height:12px;border-radius:50%;background:#28c941"></i>
    <div style="margin-left:18px;flex:0 0 46%;height:26px;border-radius:13px;background:#eceef2"></div>
  </div>
  <div style="padding:46px 70px;display:grid;grid-template-columns:1.25fr 1fr;gap:56px">
    <div>${'<div style="height:14px;border-radius:7px;background:#e9ebef;margin:0 0 16px;width:WIDTH%"></div>'.repeat(1)}
      <div style="height:30px;width:72%;border-radius:8px;background:#dfe2e7;margin-bottom:28px"></div>
      ${[96, 92, 88, 94, 60, 0, 90, 97, 85, 93, 70, 0, 95, 89, 91, 56].map((w) => (w ? `<div style="height:12px;border-radius:6px;background:#eceef2;margin:0 0 14px;width:${w}%"></div>` : '<div style="height:18px"></div>')).join("")}
    </div>
    <div><div style="height:230px;border-radius:12px;background:linear-gradient(135deg,#f3f4f7,#e8ebf0)"></div>
      ${[90, 78, 84, 60].map((w) => `<div style="height:12px;border-radius:6px;background:#eceef2;margin:18px 0 0;width:${w}%"></div>`).join("")}
    </div>
  </div>
</div></body></html>`.replace("WIDTH", "38");

function serve() {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
      const file = join(ROOT, path);
      if (!file.startsWith(ROOT) || !existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => done(server));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const out = resolve(process.argv[2] || join(ROOT, ".cache", "shots"));
  const demos = process.argv.slice(3).length ? process.argv.slice(3) : ["engine", "newton3", "tensor", "pi-camera"];
  mkdirSync(out, { recursive: true });
  mkdirSync(join(ROOT, ".cache"), { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const win = new BrowserWindow({ width: W, height: H, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(30);
  // Offscreen windows hand over frames through "paint" (capturePage is not available for them).
  let frame = null;
  win.webContents.on("paint", (_e, _dirty, image) => (frame = image));
  const snap = async () => {
    win.webContents.invalidate();
    await wait(250);
    return frame.toPNG();
  };

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  await wait(600);
  writeFileSync(join(ROOT, ".cache", "screen.png"), await snap());

  for (const demo of demos) {
    const bg = process.env.BG ? `/${process.env.BG.replace(/\\/g, "/")}` : "/.cache/screen.png";
    await win.loadURL(`${base}/src/renderer/overlay.html?bg=${bg}&mute=1&nobar=1&demos=${demo}&play=${demo}`);
    let elapsed = 0;
    for (const s of MOMENTS) {
      await wait((s - elapsed) * 1000);
      elapsed = s;
      writeFileSync(join(out, `shot-${demo.split("/").pop()}-${s}s.png`), await snap());
    }
    console.log(`captured ${demo}`);
  }
  server.close();
  app.quit();
});
