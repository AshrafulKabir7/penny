// The tray icon, drawn in code: a yellow pen tip on a dark disc. Returns a PNG buffer.

const zlib = require("node:zlib");

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function insideTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function trayIconPng(size = 32) {
  const rows = [];
  const r = size / 2;
  // The pen pointer from the overlay, scaled into the icon.
  const s = size / 32;
  const tri = [
    [7 * s, 6 * s],
    [26 * s, 15 * s],
    [13 * s, 26 * s],
  ];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let a = 0, rr = 0, gg = 0, bb = 0;
      // 4× supersampling for smooth edges.
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const px = x + ox, py = y + oy;
        if (Math.hypot(px - r, py - r) <= r - 0.5) {
          a += 0.25;
          if (insideTriangle(px, py, ...tri)) (rr += 0.25 * 255), (gg += 0.25 * 210), (bb += 0.25 * 63);
          else (rr += 0.25 * 30), (gg += 0.25 * 30), (bb += 0.25 * 34);
        }
      }
      const i = 1 + x * 4;
      row[i] = a ? Math.round(rr / a) : 0;
      row[i + 1] = a ? Math.round(gg / a) : 0;
      row[i + 2] = a ? Math.round(bb / a) : 0;
      row[i + 3] = Math.round(a * 255);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = { trayIconPng };
