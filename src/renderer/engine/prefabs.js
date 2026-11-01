// Ready-made 3D objects the model can name instead of assembling from primitives ("shape":"person", "car", ...).
// Each returns a THREE.Group standing on y = 0 (except the round ones, which are centred), facing +x, at the size given.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const DEG = Math.PI / 180;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** `make(color, kind)` builds a material; kinds are those of the "material" field. */
function mesh(geo, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, edges = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (!edges) m.userData.noEdges = true;
  return m;
}

const rbox = (w, h, d, r = Math.min(w, h, d) * 0.18) => new RoundedBoxGeometry(w, h, d, 3, r);

// ---------------------------------------------------------------- person

// Angles in degrees. Arms: sh = forward swing at the shoulder, el = elbow bend, raise = lift out to the side.
// Legs: hip = forward swing, knee = bend. lean = torso tipped forward, drop = how far the hips sink (metres at 1.8 m).
const POSES = {
  stand: { lean: 0, shL: 6, shR: 6, elL: 10, elR: 10, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0 },
  push: { lean: 22, shL: 80, shR: 80, elL: 14, elR: 14, hipL: 26, hipR: -24, kneeL: 22, kneeR: 4, drop: 0.05 },
  pull: { lean: -16, shL: 70, shR: 70, elL: 30, elR: 30, hipL: 30, hipR: -10, kneeL: 30, kneeR: 10, drop: 0.08 },
  walk: { lean: 4, shL: -26, shR: 26, elL: 16, elR: 16, hipL: 26, hipR: -22, kneeL: 6, kneeR: 26 },
  run: { lean: 16, shL: -50, shR: 60, elL: 85, elR: 85, hipL: 55, hipR: -32, kneeL: 35, kneeR: 85, drop: 0.06 },
  sit: { lean: 0, shL: 24, shR: 24, elL: 45, elR: 45, hipL: 90, hipR: 90, kneeL: 90, kneeR: 90, drop: 0.45 },
  throw: { lean: -6, shL: 70, shR: -150, elL: 10, elR: 70, hipL: 24, hipR: -18, kneeL: 10, kneeR: 6 },
  wave: { lean: 0, shL: 6, shR: 0, raiseR: 150, elL: 10, elR: 35, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0 },
  point: { lean: 0, shL: 6, shR: 88, elL: 10, elR: 2, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0 },
  lift: { lean: 28, shL: 62, shR: 62, elL: 50, elR: 50, hipL: 50, hipR: 50, kneeL: 75, kneeR: 75, drop: 0.2 },
  kick: { lean: -8, shL: 30, shR: -30, elL: 20, elR: 20, hipL: -6, hipR: 75, kneeL: 4, kneeR: 8 },
  jump: { lean: 0, shL: 150, shR: 150, elL: 10, elR: 10, hipL: 24, hipR: 24, kneeL: 50, kneeR: 50 },
  carry: { lean: -4, shL: 40, shR: 40, elL: 70, elR: 70, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0 },
};

function person(op, make) {
  const H = num(op.size?.[0] ?? op.size, 1.8);
  const p = { ...POSES.stand, ...(POSES[String(op.pose || "stand").toLowerCase()] || {}) };
  const skin = make(op.color || "#8fb4ec", "plastic");
  const dark = make("#2b2f36", "matte");
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(H / 1.8);
  root.add(body);

  const hipY = 0.92 - (p.drop || 0);
  const pelvis = new THREE.Group();
  pelvis.position.y = hipY;
  body.add(pelvis);
  pelvis.add(mesh(new THREE.CapsuleGeometry(0.1, 0.16, 6, 16), skin, { rx: 90 * DEG, edges: false }));

  // Upper body tips forward around the hips.
  const upper = new THREE.Group();
  upper.rotation.z = -(p.lean || 0) * DEG;
  pelvis.add(upper);
  upper.add(mesh(new THREE.CapsuleGeometry(0.15, 0.3, 8, 20), skin, { y: 0.27, edges: false }));
  upper.add(mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 14), skin, { y: 0.6, edges: false }));
  upper.add(mesh(new THREE.SphereGeometry(0.115, 24, 18), skin, { y: 0.72, edges: false }));
  for (const z of [-0.042, 0.042]) upper.add(mesh(new THREE.SphereGeometry(0.017, 10, 8), dark, { x: 0.105, y: 0.74, z, edges: false }));

  const arm = (side) => {
    const s = side === "L" ? -1 : 1; // +z is the person's right
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 0.5, 0.2 * s);
    shoulder.rotation.x = -s * (p[`raise${side}`] || 0) * DEG;
    upper.add(shoulder);
    const swing = new THREE.Group();
    swing.rotation.z = (p[`sh${side}`] || 0) * DEG;
    shoulder.add(swing);
    swing.add(mesh(new THREE.CapsuleGeometry(0.048, 0.22, 6, 14), skin, { y: -0.14, edges: false }));
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    elbow.rotation.z = (p[`el${side}`] || 0) * DEG;
    swing.add(elbow);
    elbow.add(mesh(new THREE.CapsuleGeometry(0.042, 0.2, 6, 14), skin, { y: -0.13, edges: false }));
    elbow.add(mesh(new THREE.SphereGeometry(0.052, 14, 10), skin, { y: -0.29, edges: false }));
  };
  arm("L");
  arm("R");

  const leg = (side) => {
    const s = side === "L" ? -1 : 1;
    const hip = new THREE.Group();
    hip.position.set(0, -0.02, 0.095 * s);
    hip.rotation.z = (p[`hip${side}`] || 0) * DEG;
    pelvis.add(hip);
    hip.add(mesh(new THREE.CapsuleGeometry(0.07, 0.3, 6, 16), skin, { y: -0.21, edges: false }));
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    knee.rotation.z = -(p[`knee${side}`] || 0) * DEG;
    hip.add(knee);
    knee.add(mesh(new THREE.CapsuleGeometry(0.058, 0.31, 6, 16), skin, { y: -0.21, edges: false }));
    knee.add(mesh(rbox(0.24, 0.07, 0.1, 0.03), dark, { x: 0.05, y: -0.42 - 0.005 }));
  };
  leg("L");
  leg("R");
  return root;
}

// ---------------------------------------------------------------- vehicles and props

function skateboard(op, make) {
  const L = num(op.size?.[0] ?? op.size, 1);
  const g = new THREE.Group();
  const s = new THREE.Group();
  s.scale.setScalar(L);
  g.add(s);
  const deck = make(op.color || "#c7814a", "matte");
  const metal = make("#b8bec7", "metal");
  const wheel = make("#f2e6c9", "plastic");
  s.add(mesh(rbox(1, 0.035, 0.26, 0.015), deck, { y: 0.12 }));
  for (const x of [-0.33, 0.33]) {
    s.add(mesh(new THREE.BoxGeometry(0.06, 0.05, 0.2), metal, { x, y: 0.085 }));
    for (const z of [-0.1, 0.1]) s.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 18), wheel, { x, y: 0.04, z, rx: 90 * DEG }));
  }
  return g;
}

function car(op, make) {
  const L = num(op.size?.[0] ?? op.size, 4);
  const g = new THREE.Group();
  const s = new THREE.Group();
  s.scale.setScalar(L / 4);
  g.add(s);
  const paint = make(op.color || "#d9534f", "metal");
  const glass = make("#24313f", "glass");
  glass.opacity = 0.75;
  const tire = make("#1f2226", "rubber");
  const chrome = make("#d7dce2", "metal");
  s.add(mesh(rbox(4, 0.7, 1.8, 0.22), paint, { y: 0.68 }));
  s.add(mesh(rbox(2.1, 0.62, 1.58, 0.2), paint, { x: -0.25, y: 1.28 }));
  s.add(mesh(rbox(2.16, 0.46, 1.62, 0.16), glass, { x: -0.25, y: 1.3, edges: false }));
  for (const x of [-1.3, 1.3]) {
    for (const z of [-0.86, 0.86]) {
      s.add(mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 28), tire, { x, y: 0.38, z, rx: 90 * DEG }));
      s.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 20), chrome, { x, y: 0.38, z, rx: 90 * DEG, edges: false }));
    }
  }
  for (const z of [-0.6, 0.6]) {
    s.add(mesh(rbox(0.06, 0.14, 0.32, 0.03), make("#fff6c8", "glow"), { x: 2.0, y: 0.78, z, edges: false }));
    s.add(mesh(rbox(0.06, 0.14, 0.32, 0.03), make("#ff3b30", "glow"), { x: -2.0, y: 0.78, z, edges: false }));
  }
  return g;
}

function rocket(op, make) {
  const H = num(op.size?.[0] ?? op.size, 5);
  const g = new THREE.Group();
  const s = new THREE.Group();
  s.scale.setScalar(H / 5);
  g.add(s);
  const hull = make("#eef0f3", "plastic");
  const accent = make(op.color || "#e5484d", "plastic");
  s.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.9, 32), hull, { y: 1.95 }));
  s.add(mesh(new THREE.ConeGeometry(0.45, 1.1, 32), accent, { y: 3.95 }));
  s.add(mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.4, 28), make("#5b6370", "metal"), { y: 0.3 }));
  s.add(mesh(new THREE.SphereGeometry(0.16, 20, 14), make("#7fc4ff", "glass"), { x: 0.4, y: 2.9, edges: false }));
  const fin = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.55, -0.15), new THREE.Vector2(0.55, -0.55), new THREE.Vector2(0, 0.7)]);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.06, bevelEnabled: false });
  finGeo.translate(0, 0, -0.03);
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = (i * 90 + 45) * DEG;
    holder.add(mesh(finGeo, accent, { x: 0.42, y: 0.75 }));
    s.add(holder);
  }
  if (op.flame !== false) {
    const flame = mesh(new THREE.ConeGeometry(0.28, 1.0, 24), make("#ffb340", "glow"), { y: -0.45, rx: 180 * DEG, edges: false });
    s.add(flame);
  }
  return g;
}

/** A wheel facing along z (its axle). Size: [radius]. */
function wheel(op, make) {
  const R = num(op.size?.[0] ?? op.size, 0.5);
  const g = new THREE.Group();
  g.add(mesh(new THREE.TorusGeometry(R * 0.8, R * 0.2, 16, 48), make("#1f2226", "rubber"), { edges: false }));
  const rim = make(op.color || "#c8ced6", "metal");
  g.add(mesh(new THREE.CylinderGeometry(R * 0.18, R * 0.18, R * 0.3, 20), rim, { rx: 90 * DEG }));
  for (let i = 0; i < 6; i++) g.add(mesh(new THREE.BoxGeometry(R * 1.2, R * 0.07, R * 0.07), rim, { rz: (i * 30) * DEG }));
  return g;
}

/** A spur gear facing along z. Size: [radius, teeth, thickness]. */
function gear(op, make) {
  const s = Array.isArray(op.size) ? op.size : [op.size];
  const R = num(s[0], 1);
  const teeth = Math.max(6, Math.min(48, Math.round(num(s[1], 14))));
  const t = num(s[2], R * 0.3);
  const shape = new THREE.Shape();
  const steps = teeth * 4;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = i % 4 === 1 || i % 4 === 2 ? R : R * 0.84;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, R * 0.22, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: true, bevelThickness: t * 0.08, bevelSize: t * 0.06, bevelSegments: 2 });
  geo.translate(0, 0, -t / 2);
  const g = new THREE.Group();
  g.add(mesh(geo, make(op.color || "#c9a227", op.material || "metal")));
  return g;
}

/** A coil spring along y. Size: [radius, length, coils]. */
function spring(op, make) {
  const s = Array.isArray(op.size) ? op.size : [op.size];
  const R = num(s[0], 0.3);
  const L = num(s[1], 1.5);
  const coils = Math.max(2, Math.min(40, num(s[2], 8)));
  const pts = [];
  for (let i = 0; i <= coils * 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * R, -L / 2 + (i / (coils * 24)) * L, Math.sin(a) * R));
  }
  const g = new THREE.Group();
  g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), coils * 48, R * 0.09, 10), make(op.color || "#aab3bd", "metal"), { edges: false }));
  return g;
}

function gridTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#f3efe6";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(90,80,60,0.18)";
  g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A floor whose top is at y = 0. Size: [width, depth]. */
function floor(op) {
  const s = Array.isArray(op.size) ? op.size : [op.size];
  const w = num(s[0], 10);
  const d = num(s[1], w * 0.5);
  const tex = gridTexture();
  tex.repeat.set(w / 1.5, d / 1.5);
  const mat = new THREE.MeshStandardMaterial({ color: op.color || "#ffffff", map: tex, roughness: 0.95, metalness: 0 });
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(w, 0.08, d, 2, 0.03), mat, { y: -0.04, edges: false }));
  return g;
}

/** A table whose top surface is at its height. Size: [width, depth, height]. */
function table(op, make) {
  const s = Array.isArray(op.size) ? op.size : [op.size];
  const w = num(s[0], 1.6);
  const d = num(s[1], 0.8);
  const h = num(s[2], 0.75);
  const wood = make(op.color || "#b98a5a", "matte");
  const g = new THREE.Group();
  g.add(mesh(rbox(w, 0.05, d, 0.02), wood, { y: h - 0.025 }));
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
    for (const z of [-d / 2 + 0.06, d / 2 - 0.06]) g.add(mesh(rbox(0.05, h - 0.05, 0.05, 0.015), wood, { x, y: (h - 0.05) / 2, z }));
  }
  return g;
}

export const PREFABS = { person, human: person, figure: person, skateboard, car, rocket, wheel, gear, spring, floor, ground: floor, table, desk: table };

/** Prefabs whose round axis points along z rather than y (for "axis"). */
export const Z_AXIS = new Set(["wheel", "gear", "torus", "ring"]);
