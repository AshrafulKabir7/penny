// Interactive 3D scenes built from the model's primitives, floating over the screen with no background. A "replica"
// part is a real 3D copy of something pictured on screen, sculpted by Idol and drawn as Gaussian splats with Spark.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { color as paletteColor, sleep } from "./sketch.js";
import { PREFABS, Z_AXIS } from "./prefabs.js";

const DEG = Math.PI / 180;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const size = (v, d) => Math.min(500, Math.max(0.001, Math.abs(num(v, d))));
const vec3 = (a, d = [0, 0, 0]) => (Array.isArray(a) ? [num(a[0], d[0]), num(a[1], d[1]), num(a[2], d[2])] : d);
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function threeColor(c, fallback = "#9aa0a6") {
  try {
    return new THREE.Color(typeof c === "string" && c ? c : fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function material(op) {
  const c = threeColor(op.color);
  switch (String(op.material || "").toLowerCase()) {
    case "metal":
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0.45, roughness: 0.36 });
    case "glass":
      return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 });
    case "glow":
      return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.3, roughness: 0.4 });
    case "rubber":
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: 0.95 });
    case "matte":
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: 0.85 });
    default:
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0.1, roughness: 0.45 });
  }
}

/** Geometry for one primitive, centred on its own origin. Returns a mesh or a group. */
function buildShape(op, mat) {
  const s = Array.isArray(op.size) ? op.size : op.size != null ? [op.size] : [];
  const shape = String(op.shape || "box").toLowerCase();
  if (PREFABS[shape]) return PREFABS[shape](op, (color, kind) => material({ color, material: kind }));
  let geo;
  switch (shape) {
    case "cylinder":
    case "tube":
    case "pipe":
      geo = new THREE.CylinderGeometry(size(s[0], 0.5), size(s[1] ?? s[0], 0.5), size(s[2], 1), 40, 1, shape !== "cylinder");
      break;
    case "cone":
      geo = new THREE.ConeGeometry(size(s[0], 0.5), size(s[1], 1), 40);
      break;
    case "sphere":
    case "ball":
      geo = new THREE.SphereGeometry(size(s[0], 0.5), 40, 24);
      break;
    case "capsule":
      geo = new THREE.CapsuleGeometry(size(s[0], 0.3), size(s[1], 1), 8, 24);
      break;
    case "torus":
    case "ring":
      geo = new THREE.TorusGeometry(size(s[0], 0.6), size(s[1], 0.15), 18, 56);
      break;
    case "wedge": {
      const w = size(s[0], 1), h = size(s[1], 1), d = size(s[2], 1);
      const tri = new THREE.Shape([new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2), new THREE.Vector2(-w / 2, h / 2)]);
      geo = new THREE.ExtrudeGeometry(tri, { depth: d, bevelEnabled: false });
      geo.translate(0, 0, -d / 2);
      break;
    }
    case "fan":
    case "propeller":
    case "rotor": {
      const r = size(s[0], 0.6), blades = Math.max(2, Math.min(24, Math.round(num(s[1], 8)))), t = size(s[2], 0.08);
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, t * 1.6, 24), mat));
      const blade = new THREE.BoxGeometry(r * 0.8, t * 0.5, r * 0.24);
      for (let i = 0; i < blades; i++) {
        const b = new THREE.Mesh(blade, mat);
        const a = (i / blades) * Math.PI * 2;
        b.position.set(Math.cos(a) * r * 0.58, 0, Math.sin(a) * r * 0.58);
        b.rotation.set(0, -a, 0.35);
        group.add(b);
      }
      return group;
    }
    case "extrude":
    case "plate":
    case "outline": {
      const pts = (Array.isArray(op.points) ? op.points : []).filter((p) => Array.isArray(p)).map((p) => new THREE.Vector2(num(p[0], 0), num(p[1], 0)));
      if (pts.length < 3) {
        geo = new THREE.BoxGeometry(1, 1, 0.1);
        break;
      }
      const depth = size(op.depth ?? s[0], 0.1);
      geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth, bevelEnabled: true, bevelThickness: depth * 0.2, bevelSize: depth * 0.2, bevelSegments: 2 });
      geo.translate(0, 0, -depth / 2);
      break;
    }
    case "lathe": {
      const pts = (Array.isArray(op.profile) ? op.profile : op.points || []).filter((p) => Array.isArray(p)).map((p) => new THREE.Vector2(Math.abs(num(p[0], 0)), num(p[1], 0)));
      geo = pts.length >= 2 ? new THREE.LatheGeometry(pts, 48) : new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
      if (mat.side !== undefined) mat.side = THREE.DoubleSide;
      break;
    }
    case "plane":
      geo = new THREE.PlaneGeometry(size(s[0], 1), size(s[1], 1));
      mat.side = THREE.DoubleSide;
      break;
    default: {
      const w = size(s[0], 1), h = size(s[1] ?? s[0], 1), d = size(s[2] ?? s[0], 1);
      const r = Math.min(w, h, d) * 0.12;
      geo = r > 0.004 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
    }
  }
  return new THREE.Mesh(geo, mat);
}

/** `"axis":"x|y|z"` points a round shape's axis that way without the model having to work out rotations. */
function orientAxis(shape, op) {
  const dirs = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], "-x": [-1, 0, 0], "-y": [0, -1, 0], "-z": [0, 0, -1] };
  const target = dirs[String(op.axis || "").toLowerCase().replace("+", "")];
  if (!target) return;
  const kind = String(op.shape || "").toLowerCase();
  const native = Z_AXIS.has(kind) ? [0, 0, 1] : [0, 1, 0];
  shape.quaternion.setFromUnitVectors(new THREE.Vector3(...native), new THREE.Vector3(...target));
}

function addEdges(obj, mat) {
  if (mat.transparent) return;
  obj.traverse((m) => {
    if (!m.isMesh || m.userData.edges || m.userData.noEdges) return;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(m.geometry, 32),
      new THREE.LineBasicMaterial({ color: 0x1d1f22, transparent: true, opacity: 0.28 }),
    );
    edges.userData.edges = true;
    m.add(edges);
  });
}

function shadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, "rgba(0,0,0,0.32)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class Scene3D {
  constructor(stage, op) {
    this.stage = stage;
    this.id = op.id || "s1";
    let [x0, y0, x1, y1] = stage.box(op.box, [540, 150, 980, 820]);
    // A scene should sit beside what the user is looking at, not bury it: cap it around the centre the model chose.
    const maxW = window.innerWidth * 0.45;
    const maxH = window.innerHeight * 0.62;
    if (x1 - x0 > maxW) [x0, x1] = [(x0 + x1) / 2 - maxW / 2, (x0 + x1) / 2 + maxW / 2];
    if (y1 - y0 > maxH) [y0, y1] = [(y0 + y1) / 2 - maxH / 2, (y0 + y1) / 2 + maxH / 2];
    const w = Math.max(300, x1 - x0);
    const h = Math.max(240, y1 - y0);
    this.el = document.createElement("div");
    // Scenes stand on a paper panel so they read clearly over busy pages; "float":true drops it.
    this.el.className = op.float ? "scene3d float" : "scene3d";
    this.el.dataset.interactive = "";
    if (op.title && !op.float) {
      const title = document.createElement("div");
      title.className = "scene-title";
      title.textContent = String(op.title).slice(0, 60);
      this.el.appendChild(title);
    }
    Object.assign(this.el.style, {
      left: `${Math.max(0, Math.min(x0, window.innerWidth - w))}px`,
      top: `${Math.max(0, Math.min(y0, window.innerHeight - h))}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    this.canvas = document.createElement("canvas");
    this.lines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.lines.classList.add("scene-lines");
    this.tagLayer = document.createElement("div");
    this.tagLayer.className = "scene-tags";
    this.el.append(this.canvas, this.lines, this.tagLayer);
    stage.layer.appendChild(this.el);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    pmrem.dispose();
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 8, 6);
    this.scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.5));

    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.01, 2000);
    this.camera.position.set(10, 8, 12);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.addEventListener("start", () => {
      this.userMoved = true;
      this.goal = null;
    });

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);

    this.view = ["front", "side", "top", "iso"].includes(op.view) ? op.view : "iso";
    this.spinAll = !!op.spin;
    this.parts = new Map();
    this.tags = [];
    this.flows = [];
    this.spinners = [];
    this.ghosts = []; // placeholders of objects still being sculpted
    this.splats = [];
    this.tweens = [];
    this.goal = null;
    this.userMoved = false;
    this.focused = null;
    this._box = new THREE.Box3();
    this._v = new THREE.Vector3();
    requestAnimationFrame(() => this.el.classList.add("in"));
    stage.scenes.add(this);
  }

  part(op) {
    const id = String(op.id || `part${this.parts.size}`);
    this.parts.get(id)?.group.removeFromParent();
    const mat = material(op);
    const group = new THREE.Group(); // position + rotation from the model
    const inner = new THREE.Group(); // spins; children hang here so they spin and move with it
    const shape = buildShape(op, mat);
    orientAxis(shape, op);
    inner.add(shape);
    addEdges(shape, mat);
    group.add(inner);
    const [px, py, pz] = vec3(op.pos);
    const [rx, ry, rz] = vec3(op.rot);
    group.position.set(px, py, pz);
    group.rotation.set(rx * DEG, ry * DEG, rz * DEG);
    // "pos" is always in scene coordinates, even for a part with a parent: models get parent-relative maths wrong far
    // more often than right. The parent only makes the part spin and move along with it.
    this.root.add(group);
    const parent = op.parent && this.parts.get(String(op.parent));
    if (parent) {
      this.root.updateWorldMatrix(true, true);
      parent.inner.attach(group);
    }
    this.parts.set(id, { group, inner, op });
    if (["floor", "ground"].includes(String(op.shape).toLowerCase())) group.userData.ignoreFit = true;
    group.scale.setScalar(0.001);
    this.tweens.push({ t: 0, dur: 0.32, pop: true, step: (k) => group.scale.setScalar(Math.max(0.001, easeOutBack(k))) });
    this.needsFrame = true; // refit the camera as the part grows to full size
    return sleep(70);
  }

  /**
   * A real 3D copy of an object pictured on the screen. Idol sculpts it from that part of the screenshot as a Gaussian
   * splat, which takes 10-40 s. A placeholder holds its place at once, so tags, spins and moves can target it straight
   * away, and the splat takes its place when it arrives. If sculpting fails, the placeholder's tag says why.
   */
  replica(op) {
    const id = String(op.id || `replica${this.parts.size}`);
    this.parts.get(id)?.group.removeFromParent();
    const s = size(op.size, 2);
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    // An invisible box the object's size: framing and tags measure it, since a splat has no ordinary geometry to measure.
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.y = s / 2;
    const ghost = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.45, 1), new THREE.MeshBasicMaterial({ color: 0xf5b700, wireframe: true, transparent: true, opacity: 0.6 }));
    ghost.position.y = s / 2;
    inner.add(proxy, ghost);
    const [px, py, pz] = vec3(op.pos);
    const [rx, ry, rz] = vec3(op.rot);
    group.position.set(px, py, pz);
    group.rotation.set(rx * DEG, ry * DEG, rz * DEG);
    this.root.add(group);
    const part = { group, inner, op };
    this.parts.set(id, part);
    this.ghosts.push(ghost);
    this.needsFrame = true;
    const status = this._statusTag(part, "Sculpting it in 3D…");
    const sculpting = this.stage.sculpt ? this.stage.sculpt(op) : Promise.reject(new Error("3D from pictures isn't available here."));
    sculpting
      .then((bytes) => this._placeSplat(part, bytes, s, proxy, ghost))
      .then(() => this._dropTag(status))
      .catch((err) => {
        status.el.textContent = String(err?.message || err).slice(0, 110);
        ghost.material.color.set(0x9aa0a6);
        setTimeout(() => this._dropTag(status), 9000);
      });
    return sleep(70);
  }

  /** Swaps the placeholder for the sculpted splat: upright, its largest side `s`, standing on the part's origin. */
  async _placeSplat(part, bytes, s, proxy, ghost) {
    if (!part.group.parent) return; // the scene moved on before the object arrived
    const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
    if (!this.spark) {
      this.spark = new SparkRenderer({ renderer: this.renderer });
      this.scene.add(this.spark);
    }
    const splat = new SplatMesh({ fileBytes: bytes, fileType: "ply" });
    await splat.initialized;
    splat.quaternion.set(1, 0, 0, 0); // Idol writes y-down, like most splat files
    splat.updateMatrix();
    const box = splat.getBoundingBox(true).applyMatrix4(splat.matrix);
    const dims = box.getSize(new THREE.Vector3());
    const scale = s / Math.max(dims.x, dims.y, dims.z, 1e-6);
    const holder = new THREE.Group();
    holder.add(splat);
    holder.scale.setScalar(scale);
    const centre = box.getCenter(new THREE.Vector3());
    holder.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
    // Framing and tags use the proxy, resized to the real object; the splat's own geometry is a stand-in quad.
    if (splat.geometry) splat.geometry.boundingBox = new THREE.Box3();
    proxy.scale.set(dims.x * scale / s, dims.y * scale / s, dims.z * scale / s);
    proxy.position.y = (dims.y * scale) / 2;
    this.ghosts = this.ghosts.filter((g) => g !== ghost);
    part.inner.remove(ghost);
    ghost.geometry.dispose();
    ghost.material.dispose();
    part.inner.add(holder);
    this.splats.push(splat);
    holder.scale.setScalar(scale * 0.001);
    this.tweens.push({ t: 0, dur: 0.6, pop: true, step: (k) => holder.scale.setScalar(scale * Math.max(0.001, easeOutBack(k))) });
    this.needsFrame = true;
  }

  /** A tag that reports progress on a part, outside the model's own tags; `_dropTag` removes it. */
  _statusTag(target, text) {
    const c = paletteColor("yellow");
    const el = document.createElement("div");
    el.className = "tag status";
    el.textContent = text;
    Object.assign(el.style, { background: c.fill, borderColor: c.stroke, color: c.ink });
    this.tagLayer.appendChild(el);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("r", "3.2");
    this.lines.append(line, dot);
    const tag = { el, line, dot, target, at: null, x: null, y: null, w: 0, h: 0 };
    this.tags.push(tag);
    requestAnimationFrame(() => el.classList.add("in"));
    return tag;
  }

  _dropTag(tag) {
    this.tags = this.tags.filter((t) => t !== tag);
    tag.el.remove();
    tag.line.remove();
    tag.dot.remove();
  }

  /** The scene's bounds for framing: everything except floors, which should run out past the edges of the view. */
  _fitBox(target = new THREE.Box3()) {
    target.makeEmpty();
    this.root.updateWorldMatrix(true, true);
    for (const child of this.root.children) if (!child.userData.ignoreFit) target.expandByObject(child);
    if (target.isEmpty()) target.setFromObject(this.root);
    return target;
  }

  _partBox(id) {
    const p = this.parts.get(String(id));
    if (!p) return null;
    p.group.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(p.group);
  }

  /** Points the camera at a box from this scene's view direction (or the current one once the user has turned it). */
  _aim(box, keepDirection) {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    let dir;
    if (keepDirection) dir = this.camera.position.clone().sub(this.controls.target).normalize();
    else {
      const sz = box.getSize(new THREE.Vector3());
      const dirs = { front: [0, 0.22, 1], top: [0, 1, 0.02], iso: [1, 0.72, 1.15], side: sz.x >= sz.z ? [0.02, 0.18, 1] : [1, 0.18, 0.02] };
      if (this.view === "side" && sz.x >= sz.z) dirs.side = [0.08, 0.18, 1];
      dir = new THREE.Vector3(...dirs[this.view]).normalize();
    }
    // Exact perspective fit: the closest distance at which all eight corners are inside the view, with a margin.
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tanV = Math.tan((this.camera.fov * DEG) / 2) * 0.86;
    const tanH = tanV * this.camera.aspect;
    let dist = 0;
    const { min, max } = box;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      const c = new THREE.Vector3(x, y, z).sub(center);
      const depth = c.dot(dir);
      dist = Math.max(dist, depth + Math.abs(c.dot(right)) / tanH, depth + Math.abs(c.dot(up)) / tanV);
    }
    this.goal = { target: center, dist: Math.max(dist, 0.5), dir };
  }

  frame() {
    this.root.updateWorldMatrix(true, true);
    this._fitBox(this._box);
    if (this._box.isEmpty()) return;
    this.focused = null;
    this._aim(this._box, this.userMoved);
    const sz = this._box.getSize(this._v);
    this.unit = Math.max(sz.x, sz.y, sz.z) / 10 || 1;
    const c = this._box.getCenter(new THREE.Vector3());
    this.shadow.position.set(c.x, this._box.min.y - 0.02, c.z);
    this.shadow.scale.set(sz.x * 1.5 + 0.5, sz.z * 1.5 + 0.5, 1);
  }

  focus(op) {
    const box = op.target ? this._partBox(op.target) : null;
    if (!box) {
      this.frame();
      return sleep(600);
    }
    this.focused = op.target;
    // Close enough to see the part, never so close that its surroundings (and what it plugs into) disappear.
    this.root.updateWorldMatrix(true, true);
    const whole = this._fitBox().getSize(new THREE.Vector3());
    const partSize = box.getSize(new THREE.Vector3());
    const want = Math.max(Math.max(whole.x, whole.y, whole.z) * 0.6, Math.max(partSize.x, partSize.y, partSize.z) * 1.9);
    box.setFromCenterAndSize(box.getCenter(new THREE.Vector3()), new THREE.Vector3(want, want, want));
    this._aim(box, true);
    return sleep(700);
  }

  tag(op) {
    const target = this.parts.get(String(op.target));
    if (!target && !op.at) return null;
    const c = paletteColor(op.color || ["blue", "pink", "green", "yellow", "purple"][this.tags.length % 5]);
    const el = document.createElement("div");
    el.className = "tag";
    el.textContent = String(op.text ?? op.target ?? "").slice(0, 40);
    Object.assign(el.style, { background: c.fill, borderColor: c.stroke, color: c.ink });
    this.tagLayer.appendChild(el);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("r", "3.2");
    this.lines.append(line, dot);
    const tag = { el, line, dot, target, at: op.at ? new THREE.Vector3(...vec3(op.at)) : null, x: null, y: null, w: 0, h: 0 };
    this.tags.push(tag);
    requestAnimationFrame(() => el.classList.add("in"));
    return sleep(260);
  }

  spin(op) {
    const p = this.parts.get(String(op.target));
    if (!p) {
      if (!op.target) this.controls.autoRotate = true;
      return;
    }
    // The axis is a scene axis ("spin around x" = around the scene's x), whatever the part's own rotation.
    let axis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[op.axis];
    if (!axis) {
      // No axis given: a round part spins around its own axis.
      const local = new THREE.Vector3(0, 1, 0).applyQuaternion(p.inner.children[0]?.quaternion ?? new THREE.Quaternion());
      axis = local.applyQuaternion(p.group.getWorldQuaternion(new THREE.Quaternion())).toArray();
    }
    this.spinners = this.spinners.filter((s) => s.obj !== p.inner);
    this.spinners.push({ obj: p.inner, world: new THREE.Vector3(...axis).normalize(), speed: Math.max(-12, Math.min(12, num(op.speed, 1))) });
  }

  move(op) {
    const p = this.parts.get(String(op.target));
    if (!p) return;
    const seconds = Math.max(0.2, Math.min(4, num(op.seconds, 1.4)));
    // Targets are scene coordinates, like "pos"; turn them into the parent's frame.
    const holder = p.group.parent;
    holder.updateWorldMatrix(true, false);
    const fromPos = p.group.position.clone();
    let toPos = op.to ? holder.worldToLocal(new THREE.Vector3(...vec3(op.to))) : fromPos.clone();
    if (Array.isArray(op.by)) {
      // "by" is a shift in scene coordinates from where the part is now.
      const world = p.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(...vec3(op.by)));
      toPos = holder.worldToLocal(world);
    }
    const fromQ = p.group.quaternion.clone();
    const holderQ = holder.getWorldQuaternion(new THREE.Quaternion()).invert();
    const toQ = op.rot ? holderQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...vec3(op.rot).map((d) => d * DEG)))) : fromQ.clone();
    this.tweens.push({
      t: 0,
      dur: seconds,
      refit: true, // the camera follows things that travel (a rocket lifting off, skaters rolling apart)
      step: (k) => {
        const e = easeInOut(k);
        p.group.position.lerpVectors(fromPos, toPos, e);
        p.group.quaternion.slerpQuaternions(fromQ, toQ, e);
      },
    });
    // "wait":false starts the next op straight away, so several parts can move together.
    return op.wait === false ? sleep(40) : sleep(seconds * 1000);
  }

  /** A labelled 3D arrow (force, velocity, current...) that grows from "from" to "to". */
  force(op) {
    const a = new THREE.Vector3(...vec3(op.from, [0, 0, 0]));
    const b = new THREE.Vector3(...vec3(op.to, [1, 0, 0]));
    const length = a.distanceTo(b);
    if (length < 1e-4) return;
    // Thickness follows the size of the scene, so arrows read the same in a 2 m experiment and a 10-unit machine.
    const size = this._fitBox().getSize(new THREE.Vector3());
    const D = Math.max(0.5, size.x, size.y, size.z);
    const col = paletteColor(op.color || "pink").stroke;
    // Arrows are annotations: drawn on top, so an arrow inside or behind an object (thrust through a rocket) still shows.
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, roughness: 0.4, depthTest: false, transparent: true, opacity: 0.95 });
    const head = Math.min(length * 0.4, D * 0.09);
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(mesh(new THREE.CylinderGeometry(D * 0.016, D * 0.016, length - head, 16), mat, (length - head) / 2));
    inner.add(mesh(new THREE.ConeGeometry(D * 0.04, head, 22), mat, length - head / 2));
    group.add(inner);
    group.renderOrder = 10;
    inner.traverse((o) => (o.renderOrder = 10));
    group.position.copy(a);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.root.add(group);
    const id = String(op.id || `force${this.parts.size}`);
    this.parts.get(id)?.group.removeFromParent();
    this.parts.set(id, { group, inner, op });
    inner.scale.set(1, 0.001, 1);
    this.tweens.push({ t: 0, dur: 0.55, pop: true, step: (k) => inner.scale.set(1, Math.max(0.001, easeInOut(k)), 1) });
    this.needsFrame = true; // keep the whole arrow in view as it grows
    if (op.text) this.tag({ at: a.clone().lerp(b, 0.6).toArray(), text: op.text, color: op.color || "pink" });
    return sleep(450);

    function mesh(geo, material, y) {
      const m = new THREE.Mesh(geo, material);
      m.position.y = y;
      return m;
    }
  }

  flow(op) {
    const pts = (Array.isArray(op.path) ? op.path : []).filter((p) => Array.isArray(p)).map((p) => new THREE.Vector3(...vec3(p)));
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts);
    const u = this.unit || 1;
    const col = threeColor(op.color, "#4aa3ff");
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.035 * u, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false }));
    const head = new THREE.ConeGeometry(0.12 * u, 0.34 * u, 14);
    const arrows = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(head, new THREE.MeshBasicMaterial({ color: col, transparent: true }));
      arrows.push(m);
      this.scene.add(m);
    }
    this.scene.add(tube);
    this.flows.push({ curve, arrows, tube, speed: Math.max(0.1, Math.min(3, num(op.speed, 0.6))) });
    if (op.text) this.tag({ at: curve.getPointAt(0.5).toArray(), text: op.text, color: "blue" });
    return sleep(300);
  }

  /** Called every frame by the stage. */
  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (this.lastTick ?? now)) / 1000);
    this.lastTick = now;
    this.tweens = this.tweens.filter((tw) => {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      return k < 1;
    });
    const moving = this.tweens.some((tw) => tw.refit);
    if ((this.needsFrame || moving) && !this.userMoved && !this.focused) {
      this.frame();
      if (!this.tweens.some((tw) => tw.pop)) this.needsFrame = false;
    }
    const q = new THREE.Quaternion();
    for (const s of this.spinners) {
      // Express the scene axis in the spinning group's own frame, then turn around it.
      s.obj.parent.getWorldQuaternion(q).invert();
      s.obj.rotateOnAxis(s.world.clone().applyQuaternion(q).normalize(), s.speed * dt * 2.2);
    }
    const secs = now / 1000;
    for (const g of this.ghosts) {
      g.rotation.y += dt * 1.6;
      g.material.opacity = 0.35 + 0.3 * Math.sin(secs * 3.2);
    }
    const up = new THREE.Vector3(0, 1, 0);
    for (const f of this.flows) {
      f.arrows.forEach((a, i) => {
        const t = (secs * f.speed + i / f.arrows.length) % 1;
        a.position.copy(f.curve.getPointAt(t));
        a.quaternion.setFromUnitVectors(up, f.curve.getTangentAt(t).normalize());
        a.material.opacity = Math.sin(t * Math.PI);
      });
    }
    if (this.goal) {
      const g = this.goal;
      this.controls.target.lerp(g.target, 0.12);
      const off = this.camera.position.clone().sub(this.controls.target);
      const dir = off.clone().normalize().lerp(g.dir, 0.1).normalize();
      const dist = THREE.MathUtils.lerp(off.length(), g.dist, 0.12);
      this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
      if (this.controls.target.distanceTo(g.target) < 0.002 * g.dist && Math.abs(dist - g.dist) < 0.002 * g.dist && dir.distanceTo(g.dir) < 0.002) {
        this.goal = null;
        if (this.spinAll) this.controls.autoRotate = true;
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._layoutTags();
  }

  _project(v) {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.el.clientWidth, y: ((1 - p.y) / 2) * this.el.clientHeight };
  }

  /** Tags sit in a column on each side of the object, in the order of their anchors, never on top of each other. */
  _layoutTags() {
    if (!this.tags.length) return;
    this._fitBox(this._box);
    let bx0 = Infinity, bx1 = -Infinity;
    if (!this._box.isEmpty()) {
      const { min, max } = this._box;
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        const p = this._project(new THREE.Vector3(x, y, z));
        bx0 = Math.min(bx0, p.x);
        bx1 = Math.max(bx1, p.x);
      }
    }
    const W = this.el.clientWidth, H = this.el.clientHeight;
    const mid = Number.isFinite(bx0) ? (bx0 + bx1) / 2 : W / 2;
    const rect = this.el.getBoundingClientRect();
    const sides = { left: [], right: [] };
    for (const t of this.tags) {
      const anchor = t.at ?? (t.target ? new THREE.Box3().setFromObject(t.target.group).getCenter(this._v) : null);
      if (!anchor) continue;
      t.a = this._project(anchor);
      t.w = t.el.offsetWidth;
      t.h = t.el.offsetHeight;
      // A part the camera has moved away from (or behind) loses its tag until it is back in view.
      const behind = anchor.clone().sub(this.camera.position).dot(this.camera.getWorldDirection(new THREE.Vector3())) < 0;
      const visible = !behind && t.a.x > -20 && t.a.x < W + 20 && t.a.y > -20 && t.a.y < H + 20;
      t.el.style.visibility = t.line.style.visibility = t.dot.style.visibility = visible ? "" : "hidden";
      if (!visible) continue;
      (t.a.x < mid ? sides.left : sides.right).push(t);
    }
    for (const [side, list] of Object.entries(sides)) {
      list.sort((a, b) => a.a.y - b.a.y);
      let y = -Infinity;
      for (const t of list) {
        t.ty = Math.max(t.a.y - t.h / 2, y + 6);
        y = t.ty + t.h;
      }
      const overflow = y - (H + 40);
      if (overflow > 0) list.forEach((t) => (t.ty -= overflow));
      for (const t of list) {
        const edge = side === "left" ? Math.min(bx0, t.a.x - 30) - 22 - t.w : Math.max(bx1, t.a.x + 30) + 22;
        // Keep tags on the screen even when the object fills its box.
        t.tx = Math.max(8 - rect.left, Math.min(window.innerWidth - rect.left - t.w - 8, edge));
        t.ty = Math.max(8 - rect.top, Math.min(window.innerHeight - rect.top - t.h - 8, t.ty));
        t.x = t.x == null ? t.tx : t.x + (t.tx - t.x) * 0.18;
        t.y = t.y == null ? t.ty : t.y + (t.ty - t.y) * 0.18;
        t.el.style.transform = `translate(${t.x}px, ${t.y}px)`;
        const ex = side === "left" ? t.x + t.w : t.x;
        const ey = t.y + t.h / 2;
        t.line.setAttribute("x1", ex);
        t.line.setAttribute("y1", ey);
        t.line.setAttribute("x2", t.a.x);
        t.line.setAttribute("y2", t.a.y);
        t.dot.setAttribute("cx", t.a.x);
        t.dot.setAttribute("cy", t.a.y);
      }
    }
  }

  /** Where the pen should go for a part: its centre on the page. */
  screenPoint(id) {
    const box = id ? this._partBox(id) : null;
    const rect = this.el.getBoundingClientRect();
    if (!box) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const p = this._project(box.getCenter(new THREE.Vector3()));
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  remove() {
    this.stage.scenes.delete(this);
    this.el.classList.add("out");
    setTimeout(() => {
      this.scene.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => {
          m.map?.dispose();
          m.dispose();
        });
      });
      for (const s of this.splats) s.dispose?.();
      this.spark?.dispose?.();
      this.envTex.dispose();
      this.controls.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.el.remove();
    }, 340);
  }
}
